import { ConflictException, ForbiddenException } from '@nestjs/common';
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
    PerfEvaluationTaskType: { SELF: 'SELF', PEER: 'PEER' },
    PerfReviewStatus: { DRAFT: 'DRAFT', SUBMITTED: 'SUBMITTED' },
    PerfRatingSymbol: { S: 'S', A: 'A', B: 'B', C: 'C' },
    PerfAssignmentStatus: {
      PENDING: 'PENDING',
      SUBMITTED: 'SUBMITTED',
      REPLACED: 'REPLACED',
    },
    PerfFormItemType: {},
  }),
  { virtual: true },
);

const ratings = [
  { symbol: 'S', minScore: '90', maxScore: '100', mappingScore: '95' },
  { symbol: 'A', minScore: '80', maxScore: '90', mappingScore: '85' },
  { symbol: 'B', minScore: '60', maxScore: '80', mappingScore: '70' },
  { symbol: 'C', minScore: '0', maxScore: '60', mappingScore: '50' },
];

const snapshotContent = {
  schemaVersion: 2,
  subforms: [
    {
      key: 'subform:peer',
      type: 'PEER',
      title: '360°评估',
      dimensions: [
        {
          key: 'dimension:collaboration',
          type: 'SCORING',
          audience: 'REVIEWER',
          name: '协作沟通',
          scoringMethod: 'RATING',
          weight: '60',
          isCore: true,
          fields: [
            {
              key: 'field:comment',
              type: 'LONG_TEXT',
              title: '评价说明',
              requiredRule: 'CONDITIONAL',
              requiredLevels: ['S', 'C'],
            },
          ],
        },
        {
          key: 'dimension:growth',
          type: 'SCORING',
          audience: 'REVIEWER',
          name: '学习成长',
          scoringMethod: 'SCORE',
          weight: '40',
          isCore: false,
          fields: [],
        },
        {
          key: 'dimension:guide',
          type: 'NON_SCORING',
          audience: 'REVIEWER',
          name: '补充反馈',
          fields: [
            {
              key: 'field:suggestion',
              type: 'MARKDOWN',
              title: '建议',
              requiredRule: 'OPTIONAL',
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
      currentConfigVersion: { id: 9, ratings },
    },
  },
};

describe('PeerEvaluationSubmissionService 新版 360°维度回答链路', () => {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 7, status: 'ACTIVE' }]),
    perfEvaluationSubmission: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    perfEvaluationDimensionAnswer: {
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
    perfReviewerAssignment: { updateMany: jest.fn(), count: jest.fn() },
    perfEvaluationTask: { update: jest.fn() },
  };
  const prisma = {
    perfReviewerAssignment: { findFirst: jest.fn() },
    perfEvaluationSubmission: { findMany: jest.fn(), findFirst: jest.fn() },
    $transaction: jest.fn(),
  };
  const taskAccess = { openIfDue: jest.fn(), ensureWritable: jest.fn() };
  const audit = { record: jest.fn() };
  const peerStageResult = { recalculate: jest.fn() };
  const aiReport = { refreshForParticipant: jest.fn() };
  const participantEvaluationLock = { lockHumanWrite: jest.fn() };
  const employeeProfile = { getPeerSafe: jest.fn() };
  let service: PeerEvaluationSubmissionService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.perfReviewerAssignment.findFirst.mockResolvedValue(assignment);
    prisma.perfEvaluationSubmission.findMany.mockResolvedValue([]);
    prisma.perfEvaluationSubmission.findFirst.mockResolvedValue(null);
    employeeProfile.getPeerSafe.mockResolvedValue({
      open_id: 'ou_employee',
      name: '员工甲',
      departmentPath: '集团 / 研发部',
      jobTitle: '工程师',
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
    taskAccess.ensureWritable.mockResolvedValue({ id: 21, openedAt: new Date() });
    const submissionPolicy = new EvaluationSubmissionService(
      prisma as never,
      audit as never,
      taskAccess as never,
      aiReport as never,
      {} as never,
      {} as never,
    );
    service = new PeerEvaluationSubmissionService(
      prisma as never,
      audit as never,
      taskAccess as never,
      submissionPolicy,
      peerStageResult as never,
      participantEvaluationLock as never,
      employeeProfile as never,
    );
  });

  it('上下文只下发 PEER 子表单和新版维度/字段作答，且先鉴权再产生开放副作用', async () => {
    prisma.perfEvaluationSubmission.findMany.mockResolvedValue([
      { id: 100, status: 'SUBMITTED', dimensionAnswers: [] },
    ]);

    const context = await service.getPeerContext('ou_reviewer', 11);

    expect(context.form?.subforms.map((subform) => subform.type)).toEqual(['PEER']);
    expect(prisma.perfEvaluationSubmission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          dimensionAnswers: expect.objectContaining({ include: { fields: true } }),
        }),
      }),
    );
    expect(prisma.perfEvaluationSubmission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          dimensionAnswers: expect.objectContaining({ include: { fields: true } }),
        }),
      }),
    );

    prisma.perfReviewerAssignment.findFirst.mockResolvedValueOnce(null);
    await expect(service.getPeerContext('ou_other', 11)).rejects.toThrow(
      ForbiddenException,
    );
    expect(taskAccess.openIfDue).toHaveBeenCalledTimes(1);
  });

  it('草稿允许计分维度不完整，只写新版维度与字段回答', async () => {
    await service.savePeerDraft('ou_reviewer', {
      assignmentId: 11,
      dimensions: [
        {
          subformKey: 'subform:peer',
          dimensionKey: 'dimension:guide',
          fields: [{ fieldKey: 'field:suggestion', value: '继续保持跨组同步' }],
        },
      ],
    });

    expect(tx.perfEvaluationDimensionAnswer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        submissionId: 101,
        dimensionKey: 'dimension:guide',
        calculationScore: null,
        fields: {
          create: [
            expect.objectContaining({
              fieldKey: 'field:suggestion',
              fieldType: 'MARKDOWN',
            }),
          ],
        },
      }),
    });
    expect(tx).not.toHaveProperty('perfEvaluationItemResult');
  });

  it('正式提交按维度派生等级执行条件必填', async () => {
    await expect(
      service.submitPeer('ou_reviewer', {
        assignmentId: 11,
        dimensions: [
          {
            subformKey: 'subform:peer',
            dimensionKey: 'dimension:collaboration',
            rawLevel: 'S',
            fields: [],
          },
          {
            subformKey: 'subform:peer',
            dimensionKey: 'dimension:growth',
            rawScore: 88.5,
            fields: [],
          },
        ],
      }),
    ).rejects.toThrow('评价说明');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('混合评级与分数正式提交时原子写入计算分和派生等级，再重算阶段结果', async () => {
    await service.submitPeer('ou_reviewer', {
      assignmentId: 11,
      dimensions: [
        {
          subformKey: 'subform:peer',
          dimensionKey: 'dimension:collaboration',
          rawLevel: 'S',
          fields: [{ fieldKey: 'field:comment', value: '跨团队协作显著超出预期' }],
        },
        {
          subformKey: 'subform:peer',
          dimensionKey: 'dimension:growth',
          rawScore: 88.5,
          fields: [],
        },
      ],
    });

    expect(tx.perfEvaluationDimensionAnswer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        submissionId: 101,
        dimensionKey: 'dimension:collaboration',
        rawLevel: 'S',
        calculationScore: '95',
        derivedLevel: 'S',
      }),
    });
    expect(tx.perfEvaluationDimensionAnswer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        submissionId: 101,
        dimensionKey: 'dimension:growth',
        rawScore: 88.5,
        calculationScore: '88.5',
        derivedLevel: 'A',
      }),
    });
    expect(peerStageResult.recalculate).toHaveBeenCalledWith(7, tx);
  });

  it('校准锁定与失效指派继续阻止写入', async () => {
    participantEvaluationLock.lockHumanWrite.mockRejectedValueOnce(
      new ConflictException({ code: 'EVALUATION_PARTICIPANT_LOCKED' }),
    );
    await expect(
      service.savePeerDraft('ou_reviewer', { assignmentId: 11, dimensions: [] }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'EVALUATION_PARTICIPANT_LOCKED' }),
    });

    participantEvaluationLock.lockHumanWrite.mockResolvedValueOnce(undefined);
    tx.perfReviewerAssignment.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.savePeerDraft('ou_reviewer', { assignmentId: 11, dimensions: [] }),
    ).rejects.toThrow('评审关系已被替换');
  });
});
