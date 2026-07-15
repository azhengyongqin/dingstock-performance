import { ForbiddenException } from '@nestjs/common';
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
    PerfEvaluationTaskType: {
      SELF: 'SELF',
      PEER: 'PEER',
      MANAGER: 'MANAGER',
    },
    PerfParticipantStatus: {
      SELF_SUBMITTED: 'SELF_SUBMITTED',
      REVIEWED: 'REVIEWED',
    },
    PerfReviewStatus: { DRAFT: 'DRAFT', SUBMITTED: 'SUBMITTED' },
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
    PerfAssignmentStatus: {
      PENDING: 'PENDING',
      SUBMITTED: 'SUBMITTED',
      REPLACED: 'REPLACED',
    },
  }),
  { virtual: true },
);

const snapshotContent = {
  subforms: [
    {
      key: 'subform:SELF',
      type: 'SELF',
      title: '员工自评',
      dimensions: [],
    },
    {
      key: 'subform:MANAGER',
      type: 'MANAGER',
      title: '上级评估',
      dimensions: [
        {
          key: 'dimension:performance',
          kind: 'REGULAR',
          audience: 'LEADER',
          name: '核心业绩',
          weight: '100',
          isCore: true,
          items: [
            {
              key: 'item:performance:score',
              type: 'SCORE',
              title: '业绩分数',
              required: true,
            },
            {
              key: 'item:performance:comment',
              type: 'LONG_TEXT',
              title: '业绩评语',
              required: true,
            },
          ],
        },
      ],
    },
    {
      key: 'subform:PROMOTION',
      type: 'PROMOTION',
      title: '晋升评估',
      dimensions: [
        {
          key: 'dimension:promotion:employee',
          audience: 'EMPLOYEE',
          name: '员工晋升材料',
          items: [
            {
              key: 'item:promotion:material',
              type: 'MARKDOWN',
              title: '晋升材料',
              required: true,
            },
          ],
        },
        {
          key: 'dimension:promotion:leader',
          audience: 'LEADER',
          name: 'Leader 晋升结论',
          items: [
            {
              key: 'item:promotion:conclusion',
              type: 'SINGLE_SELECT',
              title: '晋升建议',
              required: true,
            },
          ],
        },
      ],
    },
  ],
};

const participant = {
  id: 7,
  cycleId: 1,
  employeeOpenId: 'ou_employee',
  leaderOpenIdSnapshot: 'ou_leader',
  status: 'SELF_SUBMITTED',
  isPromotionEnabled: true,
  formSnapshotId: 88,
  formSnapshot: { id: 88, content: snapshotContent },
  cycle: {
    id: 1,
    name: '2026 上半年绩效',
    status: 'ACTIVE',
    deletedAt: null,
    currentConfigVersion: {
      ratings: [
        { symbol: 'A', mappingScore: '85' },
        { symbol: 'B', mappingScore: '70' },
      ],
    },
  },
};

describe('ManagerEvaluationSubmissionService 上级评估公开流程', () => {
  const tx = {
    perfEvaluationSubmission: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    perfEvaluationItemResult: { deleteMany: jest.fn(), createMany: jest.fn() },
    perfEvaluationTask: { update: jest.fn() },
    perfReviewerAssignment: { count: jest.fn() },
    perfParticipant: { findUnique: jest.fn(), update: jest.fn() },
    perfAiReport: { upsert: jest.fn() },
    perfStageResult: { upsert: jest.fn() },
  };
  const prisma = {
    perfParticipant: { findUnique: jest.fn() },
    perfEvaluationSubmission: { findMany: jest.fn() },
    larkUser: { findUnique: jest.fn() },
    perfResult: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const taskAccess = { openIfDue: jest.fn(), ensureWritable: jest.fn() };
  const audit = { record: jest.fn() };
  const peerStageResult = { recalculate: jest.fn() };
  const managerStageResult = { recalculate: jest.fn() };
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
        items: [{ itemKey: 'item:self:summary', value: '本期总结' }],
      },
    ]);
    prisma.larkUser.findUnique.mockResolvedValue({
      open_id: 'ou_employee',
      name: '员工甲',
    });
    prisma.perfResult.findMany.mockResolvedValue([]);
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
    tx.perfReviewerAssignment.count.mockResolvedValue(0);
    tx.perfParticipant.findUnique.mockResolvedValue({
      status: 'SELF_SUBMITTED',
    });
    taskAccess.openIfDue.mockResolvedValue({ id: 21, openedAt: new Date() });
    taskAccess.ensureWritable.mockResolvedValue({
      id: 21,
      openedAt: new Date(),
    });
    peerStageResult.recalculate.mockResolvedValue({
      status: 'READY',
      stageLevel: 'A',
      dimensions: [],
      inputSummary: { submittedReviewerCount: 2 },
    });
    managerStageResult.recalculate.mockResolvedValue({
      status: 'READY',
      compositeScore: '88.00',
      initialLevel: 'A',
      stageLevel: 'A',
      constraintReasons: [],
      dimensions: [],
    });
    const submissionPolicy = new EvaluationSubmissionService(
      prisma as never,
      audit as never,
      {} as never,
      taskAccess as never,
    );
    service = new ManagerEvaluationSubmissionService(
      prisma as never,
      audit as never,
      taskAccess as never,
      submissionPolicy,
      peerStageResult as never,
      managerStageResult as never,
    );
  });

  it('当前 Leader 读取 MANAGER 表单、自己的晋升区段及允许的自评/360°汇总', async () => {
    const context = await service.getManagerContext('ou_leader', 7);

    expect(context.form?.subforms.map((item) => item.type)).toEqual([
      'MANAGER',
      'PROMOTION',
    ]);
    expect(context.form?.subforms[1].dimensions).toHaveLength(1);
    expect(context.form?.subforms[1].dimensions[0].audience).toBe('LEADER');
    expect(context.selfEvaluation?.id).toBe(90);
    expect(context.peerResult).toMatchObject({
      status: 'READY',
      stageLevel: 'A',
    });

    prisma.perfParticipant.findUnique.mockResolvedValueOnce({
      ...participant,
      leaderOpenIdSnapshot: 'ou_other_leader',
    });
    await expect(service.getManagerContext('ou_leader', 7)).rejects.toThrow(
      ForbiddenException,
    );
    expect(taskAccess.openIfDue).toHaveBeenCalledTimes(1);
  });

  it('正式提交完整动态表单后原子替换生效答卷、计算权威等级并删除更新草稿', async () => {
    const input = {
      participantId: 7,
      items: [
        {
          subformKey: 'subform:MANAGER',
          dimensionKey: 'dimension:performance',
          itemKey: 'item:performance:score',
          rawScore: 88,
        },
        {
          subformKey: 'subform:MANAGER',
          dimensionKey: 'dimension:performance',
          itemKey: 'item:performance:comment',
          value: '结果达成稳定',
        },
        {
          subformKey: 'subform:PROMOTION',
          dimensionKey: 'dimension:promotion:leader',
          itemKey: 'item:promotion:conclusion',
          value: '建议晋升',
        },
      ],
    };

    const result = await service.submitManager('ou_leader', input);

    expect(managerStageResult.recalculate).toHaveBeenCalledWith(7, tx);
    expect(tx.perfEvaluationSubmission.deleteMany).toHaveBeenCalledWith({
      where: {
        participantId: 7,
        stage: 'MANAGER',
        reviewerOpenId: 'ou_leader',
        status: 'DRAFT',
      },
    });
    expect(tx.perfEvaluationTask.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { completedAt: expect.any(Date) } }),
    );
    expect(result).toMatchObject({
      ok: true,
      result: { compositeScore: '88.00', stageLevel: 'A' },
    });
    expect(input).not.toHaveProperty('initialLevel');
  });

  it('已有生效答卷时保存独立草稿，重新提交才原子更新原生效行', async () => {
    const input = {
      participantId: 7,
      items: [
        {
          subformKey: 'subform:MANAGER',
          dimensionKey: 'dimension:performance',
          itemKey: 'item:performance:score',
          rawScore: 90,
        },
        {
          subformKey: 'subform:MANAGER',
          dimensionKey: 'dimension:performance',
          itemKey: 'item:performance:comment',
          value: '重新评估后的事实说明',
        },
        {
          subformKey: 'subform:PROMOTION',
          dimensionKey: 'dimension:promotion:leader',
          itemKey: 'item:promotion:conclusion',
          value: '建议晋升',
        },
      ],
    };
    tx.perfEvaluationSubmission.findFirst
      .mockResolvedValueOnce({ id: 202, status: 'DRAFT' })
      .mockResolvedValueOnce({ id: 201, status: 'SUBMITTED' });

    await service.saveManagerDraft('ou_leader', input);
    await service.submitManager('ou_leader', input);

    expect(tx.perfEvaluationSubmission.update).toHaveBeenCalledWith({
      where: { id: 201 },
      data: {
        submittedAt: expect.any(Date),
        submittedByOpenId: 'ou_leader',
      },
    });
    expect(tx.perfEvaluationSubmission.create).not.toHaveBeenCalled();
    expect(managerStageResult.recalculate).toHaveBeenCalledTimes(1);
  });
});
