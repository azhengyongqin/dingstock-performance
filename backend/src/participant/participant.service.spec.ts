import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import { PrismaService } from '../shared/database/prisma.service';
import { NotificationEventService } from '../notification/notification-event.service';
import { ParticipantService } from './participant.service';

// 生成的 Prisma client 是 ESM 产物，单测中统一 mock，避免依赖真实数据库。
jest.mock(
  '../generated/prisma/client',
  () => ({
    PrismaClient: class {
      $connect = jest.fn();
      $disconnect = jest.fn();
    },
  }),
  { virtual: true },
);
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfCycleStatus: {
      DRAFT: 'DRAFT',
      SCHEDULED: 'SCHEDULED',
      ACTIVE: 'ACTIVE',
      ARCHIVED: 'ARCHIVED',
    },
    PerfParticipantStatus: {
      ACTIVE: 'ACTIVE',
      WITHDRAWN: 'WITHDRAWN',
    },
    PerfEvaluationTaskType: {
      SELF: 'SELF',
      PEER: 'PEER',
      MANAGER: 'MANAGER',
      AI: 'AI',
    },
    PerfAssignmentStatus: {
      REPLACED: 'REPLACED',
    },
  }),
  { virtual: true },
);
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation((options: unknown) => options),
}));
jest.mock('../audit/audit.service', () => ({
  AuditService: class {},
}));

describe('ParticipantService', () => {
  const txMock = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    perfCycle: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    perfParticipant: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    perfEvaluationTask: {
      createMany: jest.fn(),
      findMany: jest.fn(),
    },
    larkUser: { findMany: jest.fn() },
    larkCorehrEmployee: { findMany: jest.fn() },
  };

  const prismaMock = {
    $transaction: jest.fn((callback: (tx: typeof txMock) => unknown) =>
      Promise.resolve(callback(txMock)),
    ),
    perfCycle: { findFirst: jest.fn(), findUnique: jest.fn() },
    perfParticipant: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      createMany: jest.fn(),
      delete: jest.fn(),
    },
    larkUser: { findMany: jest.fn() },
    larkCorehrEmployee: { findMany: jest.fn() },
    perfResultVersion: { count: jest.fn().mockResolvedValue(0) },
    perfCalibration: { count: jest.fn().mockResolvedValue(0) },
    perfAiReport: { count: jest.fn().mockResolvedValue(0) },
    perfAppeal: { count: jest.fn().mockResolvedValue(0) },
    perfInterview: { count: jest.fn().mockResolvedValue(0) },
    perfEvaluationSubmission: { count: jest.fn().mockResolvedValue(0) },
  };
  const auditMock = { record: jest.fn() };
  const rbacMock = { isAdmin: jest.fn().mockResolvedValue(false) };
  const notificationEventMock = { enqueueTaskOpenedEvents: jest.fn() };

  let service: ParticipantService;

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(
      (callback: (tx: typeof txMock) => unknown) =>
        Promise.resolve(callback(txMock)),
    );
    rbacMock.isAdmin.mockResolvedValue(false);
    for (const model of [
      prismaMock.perfResultVersion,
      prismaMock.perfCalibration,
      prismaMock.perfAiReport,
      prismaMock.perfAppeal,
      prismaMock.perfInterview,
      prismaMock.perfEvaluationSubmission,
    ]) {
      model.count.mockResolvedValue(0);
    }

    const moduleRef = await Test.createTestingModule({
      providers: [
        ParticipantService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditService, useValue: auditMock },
        { provide: RbacService, useValue: rbacMock },
        {
          provide: NotificationEventService,
          useValue: notificationEventMock,
        },
      ],
    }).compile();

    service = moduleRef.get(ParticipantService);
  });

  it('归档周期在周期行锁内拒绝修改参与者信息', async () => {
    txMock.$queryRaw.mockResolvedValueOnce([
      { participant_id: 7, cycle_id: 100, cycle_status: 'ARCHIVED' },
    ]);

    await expect(service.update('ou_admin', 100, 7, true)).rejects.toThrow(
      ConflictException,
    );
    expect(txMock.perfParticipant.update).not.toHaveBeenCalled();
  });

  it('HR/Admin 均不可向 ARCHIVED 周期新增考核人员', async () => {
    txMock.perfCycle.findFirst.mockResolvedValue({
      id: 100,
      status: 'ARCHIVED',
    });

    await expect(
      service.addByOpenIds('ou_hr', 100, ['ou_new']),
    ).rejects.toThrow(ConflictException);
  });

  it('HR 向 ACTIVE 周期补加参与人时同事务生成四类任务并开放已到时任务', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-14T03:00:00.000Z'));
    txMock.perfCycle.findFirst.mockResolvedValue({
      id: 100,
      name: '2026 半年度绩效',
      ownerOpenId: 'ou_hr',
      status: 'ACTIVE',
      plannedStartAt: new Date('2026-07-14T01:00:00.000Z'),
    });
    txMock.larkUser.findMany
      .mockResolvedValueOnce([{ open_id: 'ou_new' }]) // 校验有效 open_id
      .mockResolvedValueOnce([
        {
          open_id: 'ou_new',
          leader_user_id: 'ou_leader',
          department_ids: ['d1'],
        },
      ]); // 快照回填
    txMock.perfParticipant.findMany
      .mockResolvedValueOnce([]) // 新增前已存在者
      .mockResolvedValueOnce([{ id: 9, employeeOpenId: 'ou_new' }]); // 待快照的新参与者
    txMock.larkCorehrEmployee.findMany.mockResolvedValue([
      {
        open_id: 'ou_new',
        direct_manager_id: 'ou_leader',
        department_id: 'd1',
        job_level: { code: 'D3' },
      },
    ]);
    txMock.perfCycle.findUnique.mockResolvedValue({
      name: '2026 半年度绩效',
      ownerOpenId: 'ou_hr',
      plannedStartAt: new Date('2026-07-14T01:00:00.000Z'),
      currentConfigVersion: {
        formSnapshots: [{ id: 88, jobLevelPrefix: 'D' }],
        schedulePreset: {
          allowStageOverlap: true,
          stages: [
            {
              stage: 'SELF',
              startOffsetMinutes: 0,
              reminderDeadlineOffsetMinutes: 60,
            },
            {
              stage: 'PEER',
              startOffsetMinutes: 180,
              reminderDeadlineOffsetMinutes: 240,
            },
            {
              stage: 'MANAGER',
              startOffsetMinutes: -60,
              reminderDeadlineOffsetMinutes: 120,
            },
          ],
        },
        notificationRules: {
          stages: [
            {
              stage: 'SELF',
              taskOpened: { enabled: true, ccLeader: false, ccHr: false },
            },
          ],
        },
      },
    });
    txMock.perfParticipant.createMany.mockResolvedValue({ count: 1 });
    txMock.perfEvaluationTask.createMany.mockResolvedValue({ count: 4 });
    txMock.perfEvaluationTask.findMany.mockResolvedValue([
      {
        id: 201,
        cycleId: 100,
        type: 'SELF',
        assigneeOpenId: 'ou_new',
        openedAt: new Date('2026-07-14T03:00:00.000Z'),
        reminderDeadlineAt: new Date('2026-07-14T02:00:00.000Z'),
        participant: {
          leaderOpenIdSnapshot: 'ou_leader',
          reviewerAssignments: [],
        },
      },
    ]);

    try {
      await service.addByOpenIds('ou_hr', 100, ['ou_new']);
    } finally {
      jest.useRealTimers();
    }

    expect(txMock.perfParticipant.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: expect.objectContaining({
        leaderOpenIdSnapshot: 'ou_leader',
        departmentIdSnapshot: 'd1',
        jobLevelPrefixSnapshot: 'D',
        formSnapshotId: 88,
        status: 'ACTIVE',
      }),
    });
    expect(txMock.perfEvaluationTask.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          participantId: 9,
          type: 'SELF',
          assigneeOpenId: 'ou_new',
          openedAt: new Date('2026-07-14T03:00:00.000Z'),
        }),
        expect.objectContaining({
          participantId: 9,
          type: 'PEER',
          assigneeOpenId: null,
          openedAt: null,
        }),
        expect.objectContaining({
          participantId: 9,
          type: 'MANAGER',
          assigneeOpenId: 'ou_leader',
          openedAt: new Date('2026-07-14T03:00:00.000Z'),
        }),
        expect.objectContaining({
          participantId: 9,
          type: 'AI',
          startAt: null,
          reminderDeadlineAt: null,
          openedAt: null,
        }),
      ]),
      skipDuplicates: true,
    });
    expect(notificationEventMock.enqueueTaskOpenedEvents).toHaveBeenCalledWith(
      expect.objectContaining({ id: 201, type: 'SELF' }),
      txMock,
    );
    expect(auditMock.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'participant.add',
        reason: 'HR/Admin 进行中补加参与人',
      }),
    );
  });

  it('ACTIVE 补加参与人的组织或表单快照不完整时整笔拒绝且不建任务', async () => {
    txMock.perfCycle.findFirst.mockResolvedValue({
      id: 100,
      status: 'ACTIVE',
    });
    txMock.larkUser.findMany
      .mockResolvedValueOnce([{ open_id: 'ou_invalid' }])
      .mockResolvedValueOnce([{ open_id: 'ou_invalid', department_ids: [] }]);
    txMock.perfParticipant.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 10, employeeOpenId: 'ou_invalid' }]);
    txMock.larkCorehrEmployee.findMany.mockResolvedValue([]);
    txMock.perfCycle.findUnique.mockResolvedValue({
      name: '2026 半年度绩效',
      ownerOpenId: 'ou_hr',
      plannedStartAt: new Date('2026-07-14T01:00:00.000Z'),
      currentConfigVersion: {
        formSnapshots: [],
        schedulePreset: { allowStageOverlap: true, stages: [] },
        notificationRules: { stages: [] },
      },
    });
    txMock.perfParticipant.createMany.mockResolvedValue({ count: 1 });

    await expect(
      service.addByOpenIds('ou_hr', 100, ['ou_invalid']),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'ACTIVE_PARTICIPANT_SNAPSHOT_INVALID',
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'PARTICIPANT_JOB_LEVEL_MISSING' }),
          expect.objectContaining({ code: 'PARTICIPANT_LEADER_MISSING' }),
          expect.objectContaining({ code: 'PARTICIPANT_DEPARTMENT_MISSING' }),
        ]),
      }),
    });
    expect(txMock.perfParticipant.update).not.toHaveBeenCalled();
    expect(txMock.perfEvaluationTask.createMany).not.toHaveBeenCalled();
    expect(
      notificationEventMock.enqueueTaskOpenedEvents,
    ).not.toHaveBeenCalled();
  });

  it('SCHEDULED 增员在同一事务内完成 D/M 表单绑定', async () => {
    txMock.perfCycle.findFirst.mockResolvedValue({
      id: 100,
      status: 'SCHEDULED',
    });
    txMock.larkUser.findMany
      .mockResolvedValueOnce([{ open_id: 'ou_new' }])
      .mockResolvedValueOnce([{ open_id: 'ou_new', department_ids: ['d1'] }]);
    txMock.perfParticipant.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 9, employeeOpenId: 'ou_new' }]);
    txMock.larkCorehrEmployee.findMany.mockResolvedValue([
      {
        open_id: 'ou_new',
        department_id: 'd1',
        direct_manager_id: 'ou_leader',
        job_level: { code: 'D3' },
      },
    ]);
    txMock.perfCycle.findUnique.mockResolvedValue({
      currentConfigVersion: {
        formSnapshots: [{ id: 88, jobLevelPrefix: 'D' }],
      },
    });
    txMock.perfParticipant.createMany.mockResolvedValue({ count: 1 });

    await service.addByOpenIds('ou_hr', 100, ['ou_new']);

    expect(txMock.perfParticipant.createMany).toHaveBeenCalled();
    expect(txMock.perfParticipant.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: expect.objectContaining({
        jobLevelPrefixSnapshot: 'D',
        formSnapshotId: 88,
      }),
    });
    expect(txMock.perfEvaluationTask.createMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('ADMIN 移除已产生结果数据的考核人员被拒绝', async () => {
    rbacMock.isAdmin.mockResolvedValue(true);
    prismaMock.perfCycle.findFirst.mockResolvedValue({
      id: 100,
      status: 'ACTIVE',
    });
    prismaMock.perfParticipant.findFirst.mockResolvedValue({
      id: 9,
      cycleId: 100,
    });
    prismaMock.perfResultVersion.count.mockResolvedValue(1);

    await expect(service.remove('ou_admin', 100, 9)).rejects.toThrow(
      ConflictException,
    );
    expect(prismaMock.perfParticipant.delete).not.toHaveBeenCalled();
  });

  it('HR 在 ACTIVE 周期仍不可移除考核人员', async () => {
    prismaMock.perfCycle.findFirst.mockResolvedValue({
      id: 100,
      status: 'ACTIVE',
    });

    await expect(service.remove('ou_hr', 100, 9)).rejects.toThrow(
      ConflictException,
    );
    expect(prismaMock.perfParticipant.delete).not.toHaveBeenCalled();
  });

  it('ADMIN 移除已有统一评估提交的考核人员时要求二次确认', async () => {
    rbacMock.isAdmin.mockResolvedValue(true);
    prismaMock.perfCycle.findFirst.mockResolvedValue({
      id: 100,
      status: 'ACTIVE',
    });
    prismaMock.perfParticipant.findFirst.mockResolvedValue({
      id: 9,
      cycleId: 100,
    });
    prismaMock.perfEvaluationSubmission.count.mockResolvedValue(1);

    await expect(service.remove('ou_admin', 100, 9)).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DESTRUCTIVE_EDIT_REQUIRES_CONFIRM',
      }),
    });
    expect(prismaMock.perfParticipant.delete).not.toHaveBeenCalled();
  });

  it('ADMIN 带 confirm 时可移除已有统一评估提交的考核人员', async () => {
    rbacMock.isAdmin.mockResolvedValue(true);
    prismaMock.perfCycle.findFirst.mockResolvedValue({
      id: 100,
      status: 'ACTIVE',
    });
    prismaMock.perfParticipant.findFirst.mockResolvedValue({
      id: 9,
      cycleId: 100,
    });
    prismaMock.perfEvaluationSubmission.count.mockResolvedValue(1);
    txMock.$queryRaw.mockResolvedValueOnce([
      { participant_id: 9, cycle_id: 100, cycle_status: 'ACTIVE' },
    ]);
    txMock.perfParticipant.delete.mockResolvedValue({ id: 9 });

    await service.remove('ou_admin', 100, 9, true);

    expect(txMock.perfParticipant.delete).toHaveBeenCalledWith({
      where: { id: 9 },
    });
  });
});
