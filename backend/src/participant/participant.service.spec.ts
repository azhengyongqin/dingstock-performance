import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import { PrismaService } from '../shared/database/prisma.service';
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
      PENDING_SELF_REVIEW: 'PENDING_SELF_REVIEW',
      ARCHIVED: 'ARCHIVED',
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
      findMany: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
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
    perfResult: { count: jest.fn().mockResolvedValue(0) },
    perfCalibration: { count: jest.fn().mockResolvedValue(0) },
    perfAiReport: { count: jest.fn().mockResolvedValue(0) },
    perfAppeal: { count: jest.fn().mockResolvedValue(0) },
    perfInterview: { count: jest.fn().mockResolvedValue(0) },
    perfSelfReview: { count: jest.fn().mockResolvedValue(0) },
    perfReview: { count: jest.fn().mockResolvedValue(0) },
    perfManagerReview: { count: jest.fn().mockResolvedValue(0) },
  };
  const auditMock = { record: jest.fn() };
  const rbacMock = { isAdmin: jest.fn().mockResolvedValue(false) };

  let service: ParticipantService;

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(
      (callback: (tx: typeof txMock) => unknown) =>
        Promise.resolve(callback(txMock)),
    );
    rbacMock.isAdmin.mockResolvedValue(false);
    for (const model of [
      prismaMock.perfResult,
      prismaMock.perfCalibration,
      prismaMock.perfAiReport,
      prismaMock.perfAppeal,
      prismaMock.perfInterview,
      prismaMock.perfSelfReview,
      prismaMock.perfReview,
      prismaMock.perfManagerReview,
    ]) {
      model.count.mockResolvedValue(0);
    }

    const moduleRef = await Test.createTestingModule({
      providers: [
        ParticipantService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditService, useValue: auditMock },
        { provide: RbacService, useValue: rbacMock },
      ],
    }).compile();

    service = moduleRef.get(ParticipantService);
  });

  it('HR 在周期启动后不可增删考核人员', async () => {
    txMock.perfCycle.findFirst.mockResolvedValue({
      id: 100,
      status: 'ACTIVE',
    });

    await expect(
      service.addByOpenIds('ou_hr', 100, ['ou_new']),
    ).rejects.toThrow(ConflictException);
  });

  it('ADMIN 进行中新增考核人员时回填 Leader/部门快照并置自评待办', async () => {
    rbacMock.isAdmin.mockResolvedValue(true);
    txMock.perfCycle.findFirst.mockResolvedValue({
      id: 100,
      status: 'ACTIVE',
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
    txMock.larkCorehrEmployee.findMany.mockResolvedValue([]);
    txMock.perfCycle.findUnique.mockResolvedValue({
      currentConfigVersion: { formSnapshots: [] },
    });
    txMock.perfParticipant.createMany.mockResolvedValue({ count: 1 });

    await service.addByOpenIds('ou_admin', 100, ['ou_new']);

    expect(txMock.perfParticipant.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: expect.objectContaining({
        leaderOpenIdSnapshot: 'ou_leader',
        departmentIdSnapshot: 'd1',
        status: 'PENDING_SELF_REVIEW',
      }),
    });
    expect(auditMock.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'participant.add',
        reason: '管理员进行中编辑',
      }),
    );
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
    prismaMock.perfResult.count.mockResolvedValue(1);

    await expect(service.remove('ou_admin', 100, 9)).rejects.toThrow(
      ConflictException,
    );
    expect(prismaMock.perfParticipant.delete).not.toHaveBeenCalled();
  });

  it('ADMIN 移除仅有自评数据的考核人员时要求二次确认', async () => {
    rbacMock.isAdmin.mockResolvedValue(true);
    prismaMock.perfCycle.findFirst.mockResolvedValue({
      id: 100,
      status: 'ACTIVE',
    });
    prismaMock.perfParticipant.findFirst.mockResolvedValue({
      id: 9,
      cycleId: 100,
    });
    prismaMock.perfSelfReview.count.mockResolvedValue(1);

    await expect(service.remove('ou_admin', 100, 9)).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DESTRUCTIVE_EDIT_REQUIRES_CONFIRM',
      }),
    });
    expect(prismaMock.perfParticipant.delete).not.toHaveBeenCalled();
  });

  it('ADMIN 带 confirm 时可移除仅有自评数据的考核人员', async () => {
    rbacMock.isAdmin.mockResolvedValue(true);
    prismaMock.perfCycle.findFirst.mockResolvedValue({
      id: 100,
      status: 'ACTIVE',
    });
    prismaMock.perfParticipant.findFirst.mockResolvedValue({
      id: 9,
      cycleId: 100,
    });
    prismaMock.perfSelfReview.count.mockResolvedValue(1);
    prismaMock.perfParticipant.delete.mockResolvedValue({ id: 9 });

    await service.remove('ou_admin', 100, 9, true);

    expect(prismaMock.perfParticipant.delete).toHaveBeenCalledWith({
      where: { id: 9 },
    });
  });
});
