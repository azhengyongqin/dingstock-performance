import { ConflictException, ForbiddenException } from '@nestjs/common';
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
      ACTIVE: 'ACTIVE',
    },
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
  status: 'ACTIVE',
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
    perfParticipant: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    perfAiReport: { upsert: jest.fn() },
    perfStageResult: { upsert: jest.fn() },
  };
  const prisma = {
    perfParticipant: { findUnique: jest.fn() },
    perfEvaluationSubmission: { findMany: jest.fn() },
    larkUser: { findUnique: jest.fn() },
    perfResultVersion: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const taskAccess = { openIfDue: jest.fn(), ensureWritable: jest.fn() };
  const audit = { record: jest.fn() };
  const peerStageResult = { recalculate: jest.fn() };
  const managerStageResult = {
    recalculate: jest.fn(),
    getCurrent: jest.fn(),
  };
  const aiReport = { refreshForParticipant: jest.fn() };
  const participantEvaluationLock = { lockHumanWrite: jest.fn() };
  const employeeProfile = {
    getDetailed: jest.fn(),
    getPeerSafe: jest.fn(),
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
        items: [{ itemKey: 'item:self:summary', value: '本期总结' }],
      },
    ]);
    employeeProfile.getDetailed.mockResolvedValue({
      open_id: 'ou_employee',
      name: '员工甲',
      departmentPath: '集团 / 研发部',
      jobTitle: '工程师',
      jobLevel: 'D5',
      effectiveDate: '2022-05-06',
    });
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
    tx.perfReviewerAssignment.count.mockResolvedValue(0);
    tx.perfParticipant.findUnique.mockResolvedValue({
      status: 'ACTIVE',
    });
    tx.perfParticipant.updateMany.mockResolvedValue({ count: 1 });
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
      analysis: {
        assignedReviewerCount: 2,
        submittedReviewerCount: 2,
        relationCounts: [{ relation: 'PEER', reviewerCount: 2 }],
        dimensions: [],
        reviewers: [
          {
            submissionId: 201,
            reviewerOpenId: 'ou_peer_1',
            relation: 'PEER',
            dimensions: [],
          },
          {
            submissionId: 202,
            reviewerOpenId: 'ou_peer_2',
            relation: 'PEER',
            dimensions: [],
          },
        ],
      },
    });
    employeeProfile.getPeerSafeMany.mockResolvedValue([
      {
        open_id: 'ou_peer_1',
        name: '评审员甲',
        avatar: null,
        departmentPath: null,
        jobTitle: null,
      },
      {
        open_id: 'ou_peer_2',
        name: '评审员乙',
        avatar: null,
        departmentPath: null,
        jobTitle: null,
      },
    ]);
    managerStageResult.recalculate.mockResolvedValue({
      status: 'READY',
      mode: 'WEIGHTED_SCORE',
      compositeScore: '88.00',
      initialLevel: 'A',
      stageLevel: 'A',
      constraintReasons: [],
      dimensions: [],
    });
    managerStageResult.getCurrent.mockResolvedValue({
      status: 'READY',
      compositeScore: '88.00',
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
      analysis: {
        reviewers: [
          {
            reviewerOpenId: 'ou_peer_1',
            reviewer: {
              open_id: 'ou_peer_1',
              name: '评审员甲',
            },
          },
          {
            reviewerOpenId: 'ou_peer_2',
            reviewer: {
              open_id: 'ou_peer_2',
              name: '评审员乙',
            },
          },
        ],
      },
    });
    expect(employeeProfile.getPeerSafeMany).toHaveBeenCalledWith([
      'ou_peer_1',
      'ou_peer_2',
    ]);

    prisma.perfParticipant.findUnique.mockResolvedValueOnce({
      ...participant,
      leaderOpenIdSnapshot: 'ou_other_leader',
    });
    await expect(service.getManagerContext('ou_leader', 7)).rejects.toThrow(
      ForbiddenException,
    );
    expect(taskAccess.openIfDue).toHaveBeenCalledTimes(1);
  });

  it('查看归档历史只读取持久化权威结果，不触发重算写入', async () => {
    prisma.perfParticipant.findUnique.mockResolvedValueOnce({
      ...participant,
      cycle: { ...participant.cycle, status: 'ARCHIVED' },
    });

    await expect(
      service.getManagerResult('ou_leader', 7),
    ).resolves.toMatchObject({ status: 'READY', stageLevel: 'A' });
    expect(managerStageResult.getCurrent).toHaveBeenCalledWith(7);
    expect(managerStageResult.recalculate).not.toHaveBeenCalled();
  });

  it('校准事务已锁定参与者时，旧上级评估页面不能继续提交', async () => {
    participantEvaluationLock.lockHumanWrite.mockRejectedValueOnce(
      new ConflictException({ code: 'EVALUATION_PARTICIPANT_LOCKED' }),
    );

    await expect(
      service.submitManager('ou_leader', {
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
            value: '表现稳定',
          },
          {
            subformKey: 'subform:PROMOTION',
            dimensionKey: 'dimension:promotion:leader',
            itemKey: 'item:promotion:conclusion',
            value: '建议晋升',
          },
        ],
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'EVALUATION_PARTICIPANT_LOCKED',
      }),
    });
    expect(tx.perfEvaluationSubmission.create).not.toHaveBeenCalled();
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
    expect(aiReport.refreshForParticipant).toHaveBeenCalledWith(7, tx);
    expect(tx.perfEvaluationSubmission.deleteMany).toHaveBeenCalledWith({
      where: {
        participantId: 7,
        stage: 'MANAGER',
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
    expect(result.result).not.toHaveProperty('mode');
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
        reviewerOpenId: 'ou_leader',
        formSnapshotId: 88,
        submittedAt: expect.any(Date),
        submittedByOpenId: 'ou_leader',
      },
    });
    expect(tx.perfEvaluationSubmission.create).not.toHaveBeenCalled();
    expect(managerStageResult.recalculate).toHaveBeenCalledTimes(1);
  });

  it('职责转移后仍展示旧 Leader 生效答卷，但只展示新 Leader 自己的更新草稿', async () => {
    prisma.perfParticipant.findUnique.mockResolvedValueOnce({
      ...participant,
      leaderOpenIdSnapshot: 'ou_new_leader',
    });
    prisma.perfEvaluationSubmission.findMany.mockResolvedValueOnce([
      {
        id: 300,
        stage: 'MANAGER',
        reviewerOpenId: 'ou_old_leader',
        status: 'SUBMITTED',
        items: [],
      },
      {
        id: 301,
        stage: 'MANAGER',
        reviewerOpenId: 'ou_old_leader',
        status: 'DRAFT',
        items: [],
      },
      {
        id: 302,
        stage: 'MANAGER',
        reviewerOpenId: 'ou_new_leader',
        status: 'DRAFT',
        items: [],
      },
    ]);

    const context = await service.getManagerContext('ou_new_leader', 7);

    expect(context.submitted).toMatchObject({ id: 300 });
    expect(context.draft).toMatchObject({ id: 302 });
  });

  it('新 Leader 正式重交时原子接管同一份生效答卷，不能并存两份 MANAGER 生效提交', async () => {
    prisma.perfParticipant.findUnique.mockResolvedValueOnce({
      ...participant,
      leaderOpenIdSnapshot: 'ou_new_leader',
    });
    tx.perfEvaluationSubmission.findFirst.mockResolvedValueOnce({
      id: 201,
      reviewerOpenId: 'ou_old_leader',
      status: 'SUBMITTED',
    });

    await service.submitManager('ou_new_leader', {
      participantId: 7,
      items: [
        {
          subformKey: 'subform:MANAGER',
          dimensionKey: 'dimension:performance',
          itemKey: 'item:performance:score',
          rawScore: 91,
        },
        {
          subformKey: 'subform:MANAGER',
          dimensionKey: 'dimension:performance',
          itemKey: 'item:performance:comment',
          value: '新 Leader 基于事实重新评估',
        },
        {
          subformKey: 'subform:PROMOTION',
          dimensionKey: 'dimension:promotion:leader',
          itemKey: 'item:promotion:conclusion',
          value: '建议晋升',
        },
      ],
    });

    expect(tx.perfEvaluationSubmission.update).toHaveBeenCalledWith({
      where: { id: 201 },
      data: {
        reviewerOpenId: 'ou_new_leader',
        formSnapshotId: 88,
        submittedAt: expect.any(Date),
        submittedByOpenId: 'ou_new_leader',
      },
    });
    expect(tx.perfEvaluationSubmission.create).not.toHaveBeenCalled();
  });

  it('职责转移与旧 Leader 提交并发时，事务内权限认领失败并拒绝旧提交', async () => {
    tx.perfParticipant.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.submitManager('ou_leader', {
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
            value: '并发提交',
          },
          {
            subformKey: 'subform:PROMOTION',
            dimensionKey: 'dimension:promotion:leader',
            itemKey: 'item:promotion:conclusion',
            value: '建议晋升',
          },
        ],
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(tx.perfEvaluationSubmission.create).not.toHaveBeenCalled();
    expect(tx.perfEvaluationSubmission.update).not.toHaveBeenCalled();
  });
});
