import { NotFoundException } from '@nestjs/common';
import { SelfReviewService } from './self-review.service';

jest.mock('../generated/prisma/client', () => ({ PrismaClient: class {} }), {
  virtual: true,
});
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfEvaluationTaskType: { SELF: 'SELF' },
    PerfParticipantStatus: {
      PENDING_SELF_REVIEW: 'PENDING_SELF_REVIEW',
      SELF_SUBMITTED: 'SELF_SUBMITTED',
      RETURNED: 'RETURNED',
      REVIEWED: 'REVIEWED',
    },
    PerfRole: { EMPLOYEE: 'EMPLOYEE', HR: 'HR', ADMIN: 'ADMIN' },
    PerfSelfReviewStatus: {
      DRAFT: 'DRAFT',
      SUBMITTED: 'SUBMITTED',
      RETURNED: 'RETURNED',
    },
  }),
  { virtual: true },
);

describe('SelfReviewService 写入语义', () => {
  const prisma = {
    perfParticipant: { findFirst: jest.fn(), findUnique: jest.fn() },
    perfSelfReview: { upsert: jest.fn(), update: jest.fn() },
    perfEvaluationTask: { update: jest.fn() },
    perfDimension: { findMany: jest.fn() },
    perfEvaluationRule: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const audit = { record: jest.fn() };
  const participants = { transition: jest.fn() };
  const rbac = { hasAnyRole: jest.fn() };
  const taskAccess = {
    ensureWritable: jest.fn(),
    openIfDue: jest.fn(),
  };
  let service: SelfReviewService;

  const submittedParticipant = {
    id: 7,
    cycleId: 1,
    employeeOpenId: 'ou_employee',
    status: 'SELF_SUBMITTED',
    isPromotionEnabled: false,
    selfReview: { id: 31, status: 'SUBMITTED' },
    evaluationTasks: [{ id: 21, openedAt: null }],
    cycle: { id: 1, status: 'ACTIVE', deletedAt: null },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.perfParticipant.findFirst.mockResolvedValue(submittedParticipant);
    prisma.perfSelfReview.upsert.mockResolvedValue({ id: 31, status: 'DRAFT' });
    prisma.perfSelfReview.update.mockResolvedValue({
      id: 31,
      status: 'SUBMITTED',
    });
    prisma.perfEvaluationTask.update.mockResolvedValue({ id: 21 });
    prisma.$transaction.mockResolvedValue([]);
    service = new SelfReviewService(
      prisma as never,
      audit as never,
      participants as never,
      rbac as never,
      taskAccess as never,
    );
  });

  it('员工不在该周期时先拒绝对象鉴权，不触发任务开放副作用', async () => {
    prisma.perfParticipant.findFirst.mockResolvedValue(null);

    await expect(
      service.saveDraft('ou_intruder', { cycleId: 1 }),
    ).rejects.toThrow(NotFoundException);

    expect(taskAccess.ensureWritable).not.toHaveBeenCalled();
    expect(prisma.perfSelfReview.upsert).not.toHaveBeenCalled();
  });

  it('读取自评表单在确认员工身份后通过统一入口惰性开放', async () => {
    const openedTask = {
      id: 21,
      openedAt: new Date('2026-07-14T02:00:00.000Z'),
    };
    taskAccess.openIfDue.mockResolvedValue(openedTask);
    prisma.perfDimension.findMany.mockResolvedValue([{ id: 41 }]);
    prisma.perfEvaluationRule.findUnique.mockResolvedValue({ id: 51 });

    const result = await service.getCurrent('ou_employee', 1);

    expect(taskAccess.openIfDue).toHaveBeenCalledWith(7, 'SELF');
    expect(result.task).toBe(openedTask);
    expect(result.dimensions).toEqual([{ id: 41 }]);
  });

  it('已提交员工仍可编辑与重新提交，且不回退参与者进度', async () => {
    await expect(
      service.saveDraft('ou_employee', {
        cycleId: 1,
        summary: { results: '更新内容' },
      }),
    ).resolves.toMatchObject({ id: 31, status: 'DRAFT' });
    await expect(service.submit('ou_employee', 1)).resolves.toEqual({
      ok: true,
    });

    expect(taskAccess.ensureWritable).toHaveBeenCalledTimes(2);
    expect(participants.transition).not.toHaveBeenCalled();
    expect(prisma.perfSelfReview.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 31 } }),
    );
  });
});
