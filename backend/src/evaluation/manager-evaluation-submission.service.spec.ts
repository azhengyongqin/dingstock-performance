import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { EvaluationSubmissionService } from './evaluation-submission.service';
import { ManagerEvaluationSubmissionService } from './manager-evaluation-submission.service';

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
    PerfEvaluationTaskType: { SELF: 'SELF', PEER: 'PEER', MANAGER: 'MANAGER' },
    PerfParticipantStatus: { ACTIVE: 'ACTIVE' },
    PerfReviewStatus: { DRAFT: 'DRAFT', SUBMITTED: 'SUBMITTED' },
    PerfRatingSymbol: { S: 'S', A: 'A', B: 'B', C: 'C' },
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

const ratings = [
  { symbol: 'S', minScore: '90', maxScore: '100', mappingScore: '95' },
  { symbol: 'A', minScore: '80', maxScore: '90', mappingScore: '85' },
  { symbol: 'B', minScore: '60', maxScore: '80', mappingScore: '70' },
  { symbol: 'C', minScore: '0', maxScore: '60', mappingScore: '50' },
];

const snapshotContent = {
  subforms: [
    { key: 'subform:SELF', type: 'SELF', title: '员工自评', dimensions: [] },
    {
      key: 'subform:MANAGER',
      type: 'MANAGER',
      title: '上级评估',
      dimensions: [
        {
          key: 'manager:performance',
          type: 'SCORING',
          audience: 'LEADER',
          name: '核心业绩',
          scoringMethod: 'RATING',
          weight: '70',
          isCore: true,
          fields: [
            {
              key: 'manager:performance:comment',
              type: 'LONG_TEXT',
              title: '业绩说明',
              requiredRule: 'CONDITIONAL',
              requiredLevels: ['S', 'C'],
            },
          ],
        },
        {
          key: 'manager:values',
          type: 'SCORING',
          audience: 'LEADER',
          name: '价值观',
          scoringMethod: 'SCORE',
          weight: '30',
          isCore: false,
          fields: [],
        },
        {
          key: 'manager:summary',
          type: 'NON_SCORING',
          audience: 'LEADER',
          name: '综合建议',
          fields: [
            {
              key: 'manager:summary:text',
              type: 'MARKDOWN',
              title: '综合建议',
              requiredRule: 'ALWAYS',
              requiredLevels: [],
            },
          ],
        },
      ],
    },
    {
      key: 'subform:PROMOTION',
      type: 'PROMOTION',
      title: '旧晋升评估',
      dimensions: [],
    },
  ],
};

const participant = {
  id: 7,
  cycleId: 1,
  employeeOpenId: 'ou_employee',
  leaderOpenIdSnapshot: 'ou_leader',
  isPromotionEnabled: true,
  formSnapshotId: 88,
  formSnapshot: { id: 88, content: snapshotContent },
  cycle: {
    id: 1,
    name: '2026 上半年绩效',
    status: 'ACTIVE',
    deletedAt: null,
    currentConfigVersion: { id: 3, ratings },
  },
};

const completeDimensions = (level: 'S' | 'A' = 'A') => [
  {
    subformKey: 'subform:MANAGER',
    dimensionKey: 'manager:performance',
    rawLevel: level,
    fields:
      level === 'S'
        ? [{ fieldKey: 'manager:performance:comment', value: '显著超出预期' }]
        : [],
  },
  {
    subformKey: 'subform:MANAGER',
    dimensionKey: 'manager:values',
    rawScore: 88,
    fields: [],
  },
  {
    subformKey: 'subform:MANAGER',
    dimensionKey: 'manager:summary',
    fields: [
      { fieldKey: 'manager:summary:text', value: '建议继续承担复杂项目' },
    ],
  },
];

describe('ManagerEvaluationSubmissionService 新版上级评估公开流程', () => {
  const tx = {
    perfEvaluationSubmission: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    perfEvaluationDimensionAnswer: { deleteMany: jest.fn(), create: jest.fn() },
    perfEvaluationTask: { update: jest.fn() },
    perfParticipant: { updateMany: jest.fn() },
  };
  const prisma = {
    perfParticipant: { findUnique: jest.fn() },
    perfEvaluationSubmission: { findMany: jest.fn() },
    perfResultVersion: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const taskAccess = { openIfDue: jest.fn(), ensureWritable: jest.fn() };
  const audit = { record: jest.fn() };
  const peerStageResult = { recalculate: jest.fn() };
  const managerStageResult = { recalculate: jest.fn(), getCurrent: jest.fn() };
  const aiReport = { refreshForParticipant: jest.fn() };
  const participantEvaluationLock = { lockHumanWrite: jest.fn() };
  const employeeProfile = {
    getDetailed: jest.fn(),
    getPeerSafeMany: jest.fn(),
  };
  let service: ManagerEvaluationSubmissionService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.perfParticipant.findUnique.mockResolvedValue(participant);
    prisma.perfEvaluationSubmission.findMany.mockResolvedValue([
      {
        id: 90,
        stage: 'SELF',
        reviewerOpenId: 'ou_employee',
        status: 'SUBMITTED',
        dimensionAnswers: [
          {
            id: 1,
            dimensionKey: 'self:overall',
            rawLevel: 'A',
            fields: [],
          },
        ],
      },
    ]);
    prisma.perfResultVersion.findMany.mockResolvedValue([]);
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
    tx.perfParticipant.updateMany.mockResolvedValue({ count: 1 });
    taskAccess.openIfDue.mockResolvedValue({ id: 21, openedAt: new Date() });
    taskAccess.ensureWritable.mockResolvedValue({
      id: 21,
      openedAt: new Date(),
    });
    employeeProfile.getDetailed.mockResolvedValue({
      open_id: 'ou_employee',
      name: '员工甲',
    });
    peerStageResult.recalculate.mockResolvedValue({
      status: 'READY',
      stageLevel: 'A',
      dimensions: [],
      analysis: { reviewers: [] },
    });
    employeeProfile.getPeerSafeMany.mockResolvedValue([]);
    managerStageResult.recalculate.mockResolvedValue({
      status: 'READY',
      mode: 'WEIGHTED_SCORE',
      compositeScore: '85.90',
      initialLevel: 'A',
      stageLevel: 'A',
      constraintReasons: [],
      dimensions: [],
    });
    managerStageResult.getCurrent.mockResolvedValue({
      status: 'READY',
      stageLevel: 'A',
    });
    const submissionPolicy = new EvaluationSubmissionService(
      prisma as never,
      audit as never,
      taskAccess as never,
      aiReport as never,
      {} as never,
      {} as never,
    );
    service = new ManagerEvaluationSubmissionService(
      prisma as never,
      audit as never,
      taskAccess as never,
      submissionPolicy,
      peerStageResult as never,
      managerStageResult as never,
      aiReport as never,
      participantEvaluationLock as never,
      employeeProfile as never,
    );
  });

  it('当前 Leader 只读取 MANAGER 新版维度表单与维度作答参考，不下发旧晋升表单', async () => {
    const context = await service.getManagerContext('ou_leader', 7);

    expect(context.form?.subforms.map((item) => item.type)).toEqual([
      'MANAGER',
    ]);
    expect(context.form?.subforms[0].dimensions[0]).toMatchObject({
      type: 'SCORING',
      scoringMethod: 'RATING',
      fields: [expect.objectContaining({ key: 'manager:performance:comment' })],
    });
    expect(context.selfEvaluation?.dimensionAnswers).toHaveLength(1);

    prisma.perfParticipant.findUnique.mockResolvedValueOnce({
      ...participant,
      leaderOpenIdSnapshot: 'ou_other_leader',
    });
    await expect(service.getManagerContext('ou_leader', 7)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('草稿允许缺少计分维度与必填字段，并按维度回答整体替换', async () => {
    await service.saveManagerDraft('ou_leader', {
      participantId: 7,
      dimensions: [
        {
          subformKey: 'subform:MANAGER',
          dimensionKey: 'manager:performance',
          rawLevel: 'S',
          fields: [],
        },
      ],
    });

    expect(tx.perfEvaluationDimensionAnswer.deleteMany).toHaveBeenCalledWith({
      where: { submissionId: 101 },
    });
    expect(tx.perfEvaluationDimensionAnswer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        submissionId: 101,
        dimensionKey: 'manager:performance',
        rawLevel: 'S',
        calculationScore: null,
        derivedLevel: null,
      }),
    });
    expect(managerStageResult.recalculate).not.toHaveBeenCalled();
  });

  it('正式提交混合计分维度后写入计算分与派生等级并原子刷新权威结果', async () => {
    const result = await service.submitManager('ou_leader', {
      participantId: 7,
      dimensions: completeDimensions('S'),
    });

    expect(tx.perfEvaluationDimensionAnswer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dimensionKey: 'manager:performance',
        calculationScore: '95',
        derivedLevel: 'S',
        fields: {
          create: [
            expect.objectContaining({
              fieldKey: 'manager:performance:comment',
            }),
          ],
        },
      }),
    });
    expect(tx.perfEvaluationDimensionAnswer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dimensionKey: 'manager:values',
        calculationScore: '88',
        derivedLevel: 'A',
      }),
    });
    expect(managerStageResult.recalculate).toHaveBeenCalledWith(7, tx);
    expect(aiReport.refreshForParticipant).toHaveBeenCalledWith(7, tx);
    expect(result).toMatchObject({
      ok: true,
      result: { compositeScore: '85.90', stageLevel: 'A' },
    });
  });

  it('正式提交按计分维度派生等级校验条件必填，并校验始终必填字段', async () => {
    await expect(
      service.submitManager('ou_leader', {
        participantId: 7,
        dimensions: [
          {
            subformKey: 'subform:MANAGER',
            dimensionKey: 'manager:performance',
            rawLevel: 'S',
            fields: [],
          },
          ...completeDimensions('A').slice(1),
        ],
      }),
    ).rejects.toThrow('必填表单字段「业绩说明」尚未填写');

    await expect(
      service.submitManager('ou_leader', {
        participantId: 7,
        dimensions: completeDimensions('A').slice(0, 2),
      }),
    ).rejects.toThrow('必填表单字段「综合建议」尚未填写');
    expect(tx.perfEvaluationSubmission.create).not.toHaveBeenCalled();
  });

  it('未知字段与不匹配的维度计分载荷在服务端被拒绝', async () => {
    await expect(
      service.saveManagerDraft('ou_leader', {
        participantId: 7,
        dimensions: [
          {
            subformKey: 'subform:MANAGER',
            dimensionKey: 'manager:performance',
            rawScore: 88,
            fields: [{ fieldKey: 'forged:key', value: '伪造' }],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('职责转移与旧 Leader 提交并发时，事务内权限认领失败并拒绝写入', async () => {
    tx.perfParticipant.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.submitManager('ou_leader', {
        participantId: 7,
        dimensions: completeDimensions('A'),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.perfEvaluationSubmission.create).not.toHaveBeenCalled();
  });

  it('校准事务已锁定参与者时不能继续提交', async () => {
    participantEvaluationLock.lockHumanWrite.mockRejectedValueOnce(
      new ConflictException({ code: 'EVALUATION_PARTICIPANT_LOCKED' }),
    );

    await expect(
      service.submitManager('ou_leader', {
        participantId: 7,
        dimensions: completeDimensions('A'),
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'EVALUATION_PARTICIPANT_LOCKED',
      }),
    });
  });
});
