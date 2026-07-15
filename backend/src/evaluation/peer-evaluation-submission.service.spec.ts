import { ForbiddenException } from '@nestjs/common';
import { EvaluationSubmissionService } from './evaluation-submission.service';
import { PeerEvaluationSubmissionService } from './peer-evaluation-submission.service';

jest.mock(
  '../generated/prisma/client',
  () => ({
    PrismaClient: class {},
    Prisma: { PrismaClientKnownRequestError: class extends Error {} },
  }),
  { virtual: true },
);
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfEvaluationTaskType: {
      SELF: 'SELF',
      PEER: 'PEER',
      MANAGER: 'MANAGER',
      AI: 'AI',
    },
    PerfParticipantStatus: {
      PENDING_SELF_REVIEW: 'PENDING_SELF_REVIEW',
      RETURNED: 'RETURNED',
    },
    PerfReviewStatus: { DRAFT: 'DRAFT', SUBMITTED: 'SUBMITTED' },
    PerfRatingSymbol: { S: 'S', A: 'A', B: 'B', C: 'C' },
    PerfAssignmentStatus: {
      PENDING: 'PENDING',
      SUBMITTED: 'SUBMITTED',
      REPLACED: 'REPLACED',
    },
    PerfFormItemType: {
      RATING: 'RATING',
      SCORE: 'SCORE',
      SHORT_TEXT: 'SHORT_TEXT',
      LONG_TEXT: 'LONG_TEXT',
      MARKDOWN: 'MARKDOWN',
      SINGLE_SELECT: 'SINGLE_SELECT',
      MULTI_SELECT: 'MULTI_SELECT',
      ATTACHMENT: 'ATTACHMENT',
      LINK: 'LINK',
    },
  }),
  { virtual: true },
);

const snapshotContent = {
  subforms: [
    {
      key: 'subform:PEER',
      type: 'PEER',
      title: '360°评估',
      sortOrder: 1,
      dimensions: [
        {
          key: 'dimension:PEER:REVIEWER:0',
          audience: 'REVIEWER',
          name: '协作',
          sortOrder: 0,
          items: [
            {
              key: 'item:peer:rating',
              type: 'RATING',
              title: '协作评级',
              required: true,
              sortOrder: 0,
            },
          ],
        },
      ],
    },
    {
      key: 'subform:PROMOTION',
      type: 'PROMOTION',
      title: '晋升评估',
      sortOrder: 2,
      dimensions: [
        {
          key: 'dimension:PROMOTION:EMPLOYEE:0',
          audience: 'EMPLOYEE',
          name: '晋升',
          sortOrder: 0,
          items: [
            {
              key: 'item:promotion',
              type: 'MARKDOWN',
              title: '晋升材料',
              required: true,
              sortOrder: 0,
            },
          ],
        },
      ],
    },
  ],
};

const assignment = {
  id: 11,
  participantId: 7,
  reviewerOpenId: 'ou_reviewer',
  relation: 'PEER',
  status: 'PENDING',
  participant: {
    id: 7,
    cycleId: 1,
    employeeOpenId: 'ou_employee',
    formSnapshotId: 88,
    formSnapshot: { id: 88, content: snapshotContent },
    cycle: {
      id: 1,
      name: '2026 上半年绩效',
      status: 'ACTIVE',
      deletedAt: null,
      currentConfigVersion: { ratings: [{ symbol: 'A', mappingScore: '85' }] },
    },
  },
};

describe('PeerEvaluationSubmissionService 360°动态评估', () => {
  const tx = {
    perfEvaluationSubmission: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    perfEvaluationItemResult: { deleteMany: jest.fn(), createMany: jest.fn() },
    perfReviewerAssignment: { updateMany: jest.fn(), count: jest.fn() },
    perfEvaluationTask: { update: jest.fn() },
  };
  const prisma = {
    perfParticipant: { findFirst: jest.fn() },
    perfReviewerAssignment: { findFirst: jest.fn() },
    perfEvaluationSubmission: { findMany: jest.fn() },
    larkUser: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const taskAccess = { openIfDue: jest.fn(), ensureWritable: jest.fn() };
  const audit = { record: jest.fn() };
  const peerStageResult = { recalculate: jest.fn() };
  const aiReport = { refreshForParticipant: jest.fn() };
  let service: PeerEvaluationSubmissionService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.perfReviewerAssignment.findFirst.mockResolvedValue(assignment);
    prisma.perfEvaluationSubmission.findMany.mockResolvedValue([]);
    prisma.larkUser.findUnique.mockResolvedValue({
      open_id: 'ou_employee',
      name: '员工甲',
    });
    prisma.$transaction.mockImplementation(
      (fn: (client: typeof tx) => unknown) => fn(tx),
    );
    tx.perfEvaluationSubmission.findFirst.mockResolvedValue(null);
    tx.perfEvaluationSubmission.create.mockImplementation(
      ({ data }: { data: object }) => ({ id: 101, ...data }),
    );
    tx.perfEvaluationSubmission.update.mockImplementation(
      ({ data }: { data: object }) => ({ id: 100, ...data }),
    );
    tx.perfReviewerAssignment.updateMany.mockResolvedValue({ count: 1 });
    tx.perfReviewerAssignment.count.mockResolvedValue(0);
    taskAccess.openIfDue.mockResolvedValue({ id: 21, openedAt: new Date() });
    taskAccess.ensureWritable.mockResolvedValue({
      id: 21,
      openedAt: new Date(),
    });
    const submissionPolicy = new EvaluationSubmissionService(
      prisma as never,
      audit as never,
      {} as never,
      taskAccess as never,
      aiReport as never,
      {} as never,
    );
    service = new PeerEvaluationSubmissionService(
      prisma as never,
      audit as never,
      taskAccess as never,
      submissionPolicy,
      peerStageResult as never,
      aiReport as never,
    );
  });

  it('只有有效指派的评审员能读取，且上下文只下发 PEER 子表单，不暴露晋升内容', async () => {
    const context = await service.getPeerContext('ou_reviewer', 11);

    expect(
      context.form?.subforms.map((subform: { type: string }) => subform.type),
    ).toEqual(['PEER']);
    expect(context.employee).toEqual({
      open_id: 'ou_employee',
      name: '员工甲',
    });

    prisma.perfReviewerAssignment.findFirst.mockResolvedValueOnce(null);
    await expect(service.getPeerContext('ou_old_reviewer', 11)).rejects.toThrow(
      ForbiddenException,
    );
    expect(taskAccess.openIfDue).toHaveBeenCalledTimes(1);
  });

  it('已有生效提交时保存更新草稿，不修改生效行', async () => {
    tx.perfEvaluationSubmission.findFirst.mockResolvedValue({
      id: 102,
      status: 'DRAFT',
    });

    await service.savePeerDraft('ou_reviewer', {
      assignmentId: 11,
      items: [
        {
          subformKey: 'subform:PEER',
          dimensionKey: 'dimension:PEER:REVIEWER:0',
          itemKey: 'item:peer:rating',
          rawLevel: 'A',
        },
      ],
    });

    expect(tx.perfEvaluationSubmission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          stage: 'PEER',
          status: 'DRAFT',
        }),
      }),
    );
    expect(tx.perfEvaluationSubmission.update).toHaveBeenCalledWith({
      where: { id: 102 },
      data: { reviewerAssignmentId: 11 },
    });
    expect(tx.perfReviewerAssignment.updateMany).toHaveBeenCalledWith({
      where: {
        id: 11,
        reviewerOpenId: 'ou_reviewer',
        status: { not: 'REPLACED' },
      },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it('替换事务已撤销指派时，在途草稿保存不能再写入', async () => {
    tx.perfReviewerAssignment.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.savePeerDraft('ou_reviewer', {
        assignmentId: 11,
        items: [],
      }),
    ).rejects.toThrow('评审关系已被替换');

    expect(tx.perfEvaluationSubmission.findFirst).not.toHaveBeenCalled();
    expect(tx.perfEvaluationSubmission.create).not.toHaveBeenCalled();
  });

  it('完整重新提交时原子替换当前生效明细、删除更新草稿并保持旧提交 ID', async () => {
    tx.perfEvaluationSubmission.findFirst.mockResolvedValue({
      id: 100,
      status: 'SUBMITTED',
    });

    await service.submitPeer('ou_reviewer', {
      assignmentId: 11,
      items: [
        {
          subformKey: 'subform:PEER',
          dimensionKey: 'dimension:PEER:REVIEWER:0',
          itemKey: 'item:peer:rating',
          rawLevel: 'A',
        },
      ],
    });

    expect(tx.perfEvaluationSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 100 },
        data: expect.objectContaining({ reviewerAssignmentId: 11 }),
      }),
    );
    expect(tx.perfEvaluationItemResult.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          submissionId: 100,
          itemKey: 'item:peer:rating',
          calculationScore: '85',
        }),
      ],
    });
    expect(tx.perfEvaluationSubmission.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        stage: 'PEER',
        status: 'DRAFT',
        reviewerOpenId: 'ou_reviewer',
      }),
    });
    expect(tx.perfReviewerAssignment.updateMany).toHaveBeenCalledWith({
      where: {
        id: 11,
        reviewerOpenId: 'ou_reviewer',
        status: { not: 'REPLACED' },
      },
      data: { status: 'SUBMITTED' },
    });
    expect(peerStageResult.recalculate).toHaveBeenCalledWith(7, tx);
    expect(aiReport.refreshForParticipant).toHaveBeenCalledWith(7, tx);
  });

  it('替换事务已抢先撤销旧指派时，旧评审员的在途提交不能恢复权限或写入答卷', async () => {
    tx.perfReviewerAssignment.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.submitPeer('ou_reviewer', {
        assignmentId: 11,
        items: [
          {
            subformKey: 'subform:PEER',
            dimensionKey: 'dimension:PEER:REVIEWER:0',
            itemKey: 'item:peer:rating',
            rawLevel: 'A',
          },
        ],
      }),
    ).rejects.toThrow('评审关系已被替换');

    expect(tx.perfEvaluationSubmission.findFirst).not.toHaveBeenCalled();
    expect(tx.perfEvaluationItemResult.deleteMany).not.toHaveBeenCalled();
  });
});
