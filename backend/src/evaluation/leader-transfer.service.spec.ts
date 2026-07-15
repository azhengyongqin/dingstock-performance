import { ConflictException, ForbiddenException } from '@nestjs/common';
import { LeaderTransferService } from './leader-transfer.service';

jest.mock('../shared/database/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('../rbac/rbac.service', () => ({ RbacService: class {} }));

jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfAssignmentStatus: {
      PENDING: 'PENDING',
      SUBMITTED: 'SUBMITTED',
      REPLACED: 'REPLACED',
    },
    PerfCycleStatus: { ACTIVE: 'ACTIVE', ARCHIVED: 'ARCHIVED' },
    PerfEvaluationTaskType: { MANAGER: 'MANAGER' },
    PerfNotificationChannel: { BOT_DM: 'BOT_DM' },
    PerfReviewStatus: { DRAFT: 'DRAFT', SUBMITTED: 'SUBMITTED' },
    PerfRole: { HR: 'HR', ADMIN: 'ADMIN' },
  }),
  { virtual: true },
);

describe('LeaderTransferService 直属 Leader 职责转移', () => {
  const participant = {
    id: 7,
    cycleId: 1,
    employeeOpenId: 'ou_employee',
    leaderOpenIdSnapshot: 'ou_old_leader',
    departmentIdSnapshot: 'od_product',
    cycle: {
      id: 1,
      name: '2026 上半年绩效',
      status: 'ACTIVE',
      deletedAt: null,
    },
  };
  const tx = {
    perfParticipant: { updateMany: jest.fn() },
    perfCalibration: { findFirst: jest.fn() },
    perfEvaluationSubmission: {
      findFirst: jest.fn(),
      deleteMany: jest.fn(),
    },
    perfEvaluationTask: { updateMany: jest.fn() },
    perfReviewerAssignment: { updateMany: jest.fn() },
    perfNotification: { createMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    perfParticipant: { findUnique: jest.fn() },
    larkUser: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const rbac = {
    hasAnyRole: jest.fn(),
    getOrgScope: jest.fn(),
  };
  let service: LeaderTransferService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.perfParticipant.findUnique.mockResolvedValue(participant);
    prisma.larkUser.findUnique.mockResolvedValue({
      open_id: 'ou_new_leader',
      name: '新 Leader',
    });
    prisma.$transaction.mockImplementation(
      (fn: (client: typeof tx) => unknown) => fn(tx),
    );
    rbac.hasAnyRole.mockResolvedValue(true);
    rbac.getOrgScope.mockResolvedValue(null);
    tx.perfParticipant.updateMany.mockResolvedValue({ count: 1 });
    tx.perfCalibration.findFirst.mockResolvedValue(null);
    tx.perfEvaluationSubmission.findFirst.mockResolvedValue({
      id: 91,
      reviewerOpenId: 'ou_old_leader',
      submittedAt: new Date('2026-07-15T02:00:00.000Z'),
    });
    tx.perfEvaluationSubmission.deleteMany.mockResolvedValue({ count: 1 });
    tx.perfEvaluationTask.updateMany.mockResolvedValue({ count: 1 });
    tx.perfReviewerAssignment.updateMany.mockResolvedValue({ count: 1 });
    service = new LeaderTransferService(prisma as never, rbac as never);
  });

  it('校准前原子转移职责，并保留旧 Leader 的当前生效提交直到新 Leader 正式重交', async () => {
    const result = await service.transfer('ou_hr', {
      participantId: 7,
      expectedLeaderOpenId: 'ou_old_leader',
      newLeaderOpenId: 'ou_new_leader',
      reason: '原 Leader 已转岗',
    });

    expect(tx.perfParticipant.updateMany).toHaveBeenCalledWith({
      where: { id: 7, leaderOpenIdSnapshot: 'ou_old_leader' },
      data: { leaderOpenIdSnapshot: 'ou_new_leader' },
    });
    expect(tx.perfEvaluationSubmission.findFirst).toHaveBeenCalledWith({
      where: { participantId: 7, stage: 'MANAGER', status: 'SUBMITTED' },
      select: { id: true, reviewerOpenId: true, submittedAt: true },
    });
    expect(tx.perfEvaluationSubmission.deleteMany).toHaveBeenCalledWith({
      where: { participantId: 7, stage: 'MANAGER', status: 'DRAFT' },
    });
    expect(tx.perfEvaluationTask.updateMany).toHaveBeenCalledWith({
      where: { participantId: 7, type: 'MANAGER' },
      data: { assigneeOpenId: 'ou_new_leader' },
    });
    expect(tx.perfReviewerAssignment.updateMany).toHaveBeenCalledWith({
      where: {
        participantId: 7,
        reviewerOpenId: 'ou_new_leader',
        status: 'PENDING',
      },
      data: { status: 'REPLACED' },
    });
    expect(tx.perfNotification.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          receiverOpenId: 'ou_new_leader',
          template: 'manager_responsibility_transferred_in',
        }),
        expect.objectContaining({
          receiverOpenId: 'ou_old_leader',
          template: 'manager_responsibility_transferred_out',
        }),
      ]),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operatorOpenId: 'ou_hr',
        action: 'participant.leader.transfer',
        targetType: 'perf_participant',
        targetId: '7',
        before: { leaderOpenId: 'ou_old_leader' },
        after: expect.objectContaining({
          leaderOpenId: 'ou_new_leader',
          effectiveManagerSubmissionId: 91,
          effectiveManagerSubmissionOwnerOpenId: 'ou_old_leader',
          postCalibration: false,
        }),
        reason: '原 Leader 已转岗',
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        participantId: 7,
        oldLeaderOpenId: 'ou_old_leader',
        newLeaderOpenId: 'ou_new_leader',
        postCalibration: false,
        effectiveManagerSubmission: expect.objectContaining({ id: 91 }),
      }),
    );
  });

  it('首次校准后只转移未来权限，不改写有效评估和校准记录', async () => {
    tx.perfCalibration.findFirst.mockResolvedValue({ id: 301 });

    const result = await service.transfer('ou_admin', {
      participantId: 7,
      expectedLeaderOpenId: 'ou_old_leader',
      newLeaderOpenId: 'ou_new_leader',
      reason: '组织调整',
    });

    expect(result.postCalibration).toBe(true);
    expect(tx.perfEvaluationSubmission.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.perfEvaluationSubmission).not.toHaveProperty('update');
    expect(tx.perfCalibration).not.toHaveProperty('update');
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        after: expect.objectContaining({ postCalibration: true }),
      }),
    });
  });

  it('HR 只能转移授权组织内参与者，非 HR/Admin 也不能调用', async () => {
    rbac.hasAnyRole.mockResolvedValue(false);
    await expect(
      service.transfer('ou_employee', {
        participantId: 7,
        expectedLeaderOpenId: 'ou_old_leader',
        newLeaderOpenId: 'ou_new_leader',
        reason: '越权',
      }),
    ).rejects.toThrow(ForbiddenException);

    rbac.hasAnyRole.mockResolvedValue(true);
    rbac.getOrgScope.mockResolvedValue(['od_sales']);
    await expect(
      service.transfer('ou_hr', {
        participantId: 7,
        expectedLeaderOpenId: 'ou_old_leader',
        newLeaderOpenId: 'ou_new_leader',
        reason: '越权组织',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('并发更换只有一个请求能认领旧 Leader 快照', async () => {
    tx.perfParticipant.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.transfer('ou_hr', {
        participantId: 7,
        expectedLeaderOpenId: 'ou_old_leader',
        newLeaderOpenId: 'ou_new_leader',
        reason: '并发更换',
      }),
    ).rejects.toThrow(ConflictException);
    expect(tx.perfEvaluationTask.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
