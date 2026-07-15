import { ForbiddenException } from '@nestjs/common';
import { ReviewService } from './review.service';

jest.mock('../generated/prisma/client', () => ({ PrismaClient: class {} }), {
  virtual: true,
});
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfAssignmentStatus: {
      PENDING: 'PENDING',
      SUBMITTED: 'SUBMITTED',
      REPLACED: 'REPLACED',
    },
    PerfEvaluationTaskType: { PEER: 'PEER', MANAGER: 'MANAGER' },
    PerfParticipantStatus: {
      SELF_SUBMITTED: 'SELF_SUBMITTED',
      REVIEWED: 'REVIEWED',
    },
    PerfReviewStatus: { DRAFT: 'DRAFT', SUBMITTED: 'SUBMITTED' },
    PerfRatingSymbol: { S: 'S', A: 'A', B: 'B', C: 'C' },
    PerfRole: { LEADER: 'LEADER', REVIEWER: 'REVIEWER' },
    PerfSelfReviewStatus: { SUBMITTED: 'SUBMITTED' },
  }),
  { virtual: true },
);

describe('ReviewService 写入语义', () => {
  const tx = {
    perfReview: { update: jest.fn() },
    perfReviewerAssignment: { update: jest.fn(), count: jest.fn() },
    perfEvaluationTask: { update: jest.fn() },
  };
  const prisma = {
    perfParticipant: { findUnique: jest.fn() },
    perfReviewerAssignment: { findFirst: jest.fn(), count: jest.fn() },
    perfReview: { upsert: jest.fn(), findUnique: jest.fn() },
    perfManagerReview: { upsert: jest.fn(), findUnique: jest.fn() },
    perfDimension: { findMany: jest.fn() },
    larkUser: { findUnique: jest.fn(), findMany: jest.fn() },
    perfResult: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const audit = { record: jest.fn() };
  const participants = { transition: jest.fn() };
  const taskAccess = {
    ensureWritable: jest.fn(),
    openIfDue: jest.fn(),
  };
  const aiReport = { refreshForParticipant: jest.fn() };
  let service: ReviewService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      (callback: (client: typeof tx) => unknown) => callback(tx),
    );
    tx.perfReviewerAssignment.count.mockResolvedValue(0);
    prisma.perfReviewerAssignment.count.mockResolvedValue(0);
    prisma.perfManagerReview.findUnique.mockResolvedValue({
      status: 'SUBMITTED',
    });
    prisma.perfParticipant.findUnique.mockResolvedValue({
      id: 7,
      status: 'REVIEWED',
      leaderOpenIdSnapshot: 'ou_leader',
      cycle: { deletedAt: null, evaluationRule: null },
    });
    service = new ReviewService(
      prisma as never,
      audit as never,
      participants as never,
      taskAccess as never,
      aiReport as never,
    );
  });

  it('无有效 360° 指派时先拒绝鉴权，不触发任务开放副作用', async () => {
    prisma.perfReviewerAssignment.findFirst.mockResolvedValue(null);

    await expect(
      service.saveReviewDraft('ou_intruder', {
        participantId: 7,
        comments: '越权请求',
      }),
    ).rejects.toThrow(ForbiddenException);

    expect(taskAccess.ensureWritable).not.toHaveBeenCalled();
    expect(prisma.perfReview.upsert).not.toHaveBeenCalled();
  });

  it('无有效 360° 指派时不能通过读取上下文旁路获知任务状态', async () => {
    prisma.perfParticipant.findUnique.mockResolvedValue({
      id: 7,
      cycle: { deletedAt: null },
      selfReview: null,
    });
    prisma.perfReviewerAssignment.findFirst.mockResolvedValue(null);

    await expect(
      service.getContext('ou_intruder', 7, 'REVIEW'),
    ).rejects.toThrow(ForbiddenException);

    expect(taskAccess.openIfDue).not.toHaveBeenCalled();
  });

  it('非当前 Leader 时先拒绝鉴权，不触发任务开放副作用', async () => {
    prisma.perfParticipant.findUnique.mockResolvedValue({
      id: 7,
      leaderOpenIdSnapshot: 'ou_real_leader',
      cycle: { deletedAt: null, evaluationRule: null },
    });

    await expect(
      service.saveManagerReviewDraft('ou_intruder', {
        participantId: 7,
        overallComment: '越权请求',
      }),
    ).rejects.toThrow(ForbiddenException);

    expect(taskAccess.ensureWritable).not.toHaveBeenCalled();
    expect(prisma.perfManagerReview.upsert).not.toHaveBeenCalled();
  });

  it('读取上下文在对象鉴权后通过统一入口惰性开放', async () => {
    prisma.perfReviewerAssignment.findFirst.mockResolvedValue({
      id: 11,
      status: 'PENDING',
    });
    prisma.perfParticipant.findUnique.mockResolvedValue({
      id: 7,
      cycleId: 1,
      employeeOpenId: 'ou_employee',
      isPromotionEnabled: false,
      leaderOpenIdSnapshot: 'ou_leader',
      cycle: {
        id: 1,
        name: '周期',
        status: 'ACTIVE',
        deletedAt: null,
        evaluationRule: null,
      },
      selfReview: null,
    });
    taskAccess.openIfDue.mockResolvedValue({
      id: 21,
      openedAt: new Date('2026-07-14T02:00:00.000Z'),
    });
    prisma.perfReview.findUnique.mockResolvedValue(null);
    prisma.perfDimension.findMany.mockResolvedValue([]);
    prisma.larkUser.findUnique.mockResolvedValue(null);

    const result = await service.getContext('ou_reviewer', 7, 'REVIEW');

    expect(taskAccess.openIfDue).toHaveBeenCalledWith(7, 'PEER');
    expect(result.task).toMatchObject({ id: 21 });
  });

  it('已提交的原评审员仍可编辑并重新提交', async () => {
    const assignment = { id: 11, status: 'SUBMITTED' };
    prisma.perfReviewerAssignment.findFirst.mockResolvedValue(assignment);
    prisma.perfReview.upsert.mockResolvedValue({ id: 31, status: 'DRAFT' });
    prisma.perfReview.findUnique.mockResolvedValue({
      id: 31,
      status: 'SUBMITTED',
    });

    await expect(
      service.saveReviewDraft('ou_reviewer', {
        participantId: 7,
        comments: '更新后的评价',
      }),
    ).resolves.toMatchObject({ id: 31 });
    await expect(service.submitReview('ou_reviewer', 7)).resolves.toEqual({
      ok: true,
    });

    expect(taskAccess.ensureWritable).toHaveBeenCalledTimes(2);
    expect(tx.perfReview.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 31 } }),
    );
  });
});
