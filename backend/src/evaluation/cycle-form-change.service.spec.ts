import { ConflictException } from '@nestjs/common';
import { CycleFormChangeService } from './cycle-form-change.service';

jest.mock('../generated/prisma/client', () => ({
  PrismaClient: class {},
  Prisma: {},
}));
jest.mock('../generated/prisma/enums', () => ({
  PerfAssignmentStatus: { PENDING: 'PENDING', SUBMITTED: 'SUBMITTED' },
  PerfCycleStatus: {
    DRAFT: 'DRAFT',
    SCHEDULED: 'SCHEDULED',
    ACTIVE: 'ACTIVE',
    ARCHIVED: 'ARCHIVED',
  },
  PerfEvaluationTaskType: {
    SELF: 'SELF',
    PEER: 'PEER',
    MANAGER: 'MANAGER',
  },
  PerfReviewStatus: {
    DRAFT: 'DRAFT',
    SUBMITTED: 'SUBMITTED',
    INVALIDATED: 'INVALIDATED',
  },
}));
jest.mock('../shared/database/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('../rbac/rbac.service', () => ({ RbacService: class {} }));
jest.mock('../form-template/publication-validator', () => ({
  validateFormTemplatePublication: jest.fn(() => []),
}));
jest.mock('./manager-stage-result.service', () => ({
  ManagerStageResultService: class {},
}));
jest.mock('./peer-stage-result.service', () => ({
  PeerStageResultService: class {},
}));

const selfForm: any = {
  schemaVersion: 1,
  name: 'D 表单',
  jobLevelPrefix: 'D',
  subforms: [
    {
      key: 'subform:SELF',
      type: 'SELF',
      title: '员工自评',
      dimensions: [
        {
          key: 'dimension:self',
          audience: 'EMPLOYEE',
          name: '自评',
          items: [
            {
              key: 'item:self-level',
              type: 'RATING',
              title: '自评等级',
              required: true,
            },
            {
              key: 'item:self-comment',
              type: 'TEXTAREA',
              title: '工作总结',
              required: true,
            },
          ],
        },
      ],
    },
    {
      key: 'subform:PEER',
      type: 'PEER',
      title: '360°评估',
      dimensions: [
        {
          key: 'dimension:peer',
          audience: 'REVIEWER',
          name: '协作表现',
          weight: '100',
          isCore: true,
          items: [
            {
              key: 'item:peer-rating',
              type: 'RATING',
              title: '协作评级',
              required: true,
            },
          ],
        },
      ],
    },
    {
      key: 'subform:MANAGER',
      type: 'MANAGER',
      title: '上级评估',
      dimensions: [
        {
          key: 'dimension:manager',
          audience: 'LEADER',
          name: '上级评分',
          weight: '100',
          isCore: true,
          items: [
            {
              key: 'item:manager-score',
              type: 'SCORE',
              title: '评分',
              required: true,
            },
          ],
        },
      ],
    },
  ],
};

function item(id: number, key: string, type: string, value: object = {}) {
  return {
    id,
    itemKey: key,
    itemType: type,
    subformKey: 'subform:SELF',
    dimensionKey: 'dimension:self',
    rawLevel: null,
    rawScore: null,
    calculationScore: null,
    value,
  };
}

function cycleFixture(status = 'DRAFT') {
  return {
    id: 8,
    name: '2026 年中绩效评定',
    status,
    updatedAt: new Date('2026-07-15T00:00:00Z'),
    currentConfigVersionId: 31,
    currentConfigVersion: {
      id: 31,
      cycleId: 8,
      version: 2,
      sourceConfigTemplateVersionId: 11,
      selfStageMode: 'DIRECT_RATING',
      peerStageMode: 'WEIGHTED_RATING',
      managerStageMode: 'WEIGHTED_SCORE',
      aiStageMode: 'DIRECT_RATING',
      ratings: [],
      constraintProfiles: {},
      orgOwnerWeight: '30',
      projectOwnerWeight: '30',
      peerWeight: '25',
      crossDeptWeight: '15',
      schedulePreset: {},
      notificationRules: {},
      formSnapshots: [
        {
          id: 41,
          cycleId: 8,
          cycleConfigVersionId: 31,
          jobLevelPrefix: 'D',
          sourceFormTemplateVersionId: 21,
          updatedAt: new Date('2026-07-15T00:00:00Z'),
          content: selfForm,
        },
      ],
    },
    participants: [
      {
        id: 51,
        employeeOpenId: 'ou_employee',
        departmentIdSnapshot: 'od_scope',
        jobLevelPrefixSnapshot: 'D',
        formSnapshotId: 41,
        evaluationSubmissions: [
          {
            id: 61,
            cycleId: 8,
            participantId: 51,
            stage: 'SELF',
            status: 'SUBMITTED',
            reviewerOpenId: 'ou_employee',
            reviewerAssignmentId: null,
            updatedAt: new Date('2026-07-15T00:01:00Z'),
            items: [
              { ...item(71, 'item:self-level', 'RATING'), rawLevel: 'A' },
              item(72, 'item:self-comment', 'TEXTAREA', {
                text: '已提交总结',
              }),
            ],
          },
          {
            id: 62,
            cycleId: 8,
            participantId: 51,
            stage: 'SELF',
            status: 'DRAFT',
            reviewerOpenId: 'ou_employee',
            reviewerAssignmentId: null,
            updatedAt: new Date('2026-07-15T00:02:00Z'),
            items: [
              item(73, 'item:self-comment', 'TEXTAREA', {
                text: '草稿更新总结',
              }),
            ],
          },
          {
            id: 63,
            cycleId: 8,
            participantId: 51,
            stage: 'MANAGER',
            status: 'SUBMITTED',
            reviewerOpenId: 'ou_leader',
            reviewerAssignmentId: null,
            updatedAt: new Date('2026-07-15T00:03:00Z'),
            items: [
              {
                ...item(74, 'item:manager-score', 'SCORE'),
                subformKey: 'subform:MANAGER',
                dimensionKey: 'dimension:manager',
                rawScore: '85',
                calculationScore: '85',
              },
            ],
          },
          {
            id: 64,
            cycleId: 8,
            participantId: 51,
            stage: 'PEER',
            status: 'SUBMITTED',
            reviewerOpenId: 'ou_peer',
            reviewerAssignmentId: 91,
            updatedAt: new Date('2026-07-15T00:04:00Z'),
            items: [
              {
                ...item(75, 'item:peer-rating', 'RATING'),
                subformKey: 'subform:PEER',
                dimensionKey: 'dimension:peer',
                rawLevel: 'B',
                calculationScore: '70',
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('CycleFormChangeService 公开契约', () => {
  const tx = {
    $queryRaw: jest.fn(),
    perfCycle: { findFirst: jest.fn(), update: jest.fn() },
    perfCycleConfigVersion: { create: jest.fn() },
    perfCycleFormSnapshot: { update: jest.fn() },
    perfParticipant: { updateMany: jest.fn() },
    perfEvaluationSubmission: {
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    perfEvaluationItemResult: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    perfEvaluationTask: { updateMany: jest.fn() },
    perfReviewerAssignment: { updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    perfCycle: { findFirst: jest.fn() },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      Promise.resolve(callback(tx)),
    ),
  };
  const rbac = {
    isAdmin: jest.fn(),
    getOrgScope: jest.fn(),
  };
  const peer = { recalculate: jest.fn() };
  const manager = { recalculate: jest.fn() };
  let service: CycleFormChangeService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.perfCycle.findFirst.mockResolvedValue(cycleFixture());
    tx.perfCycle.findFirst.mockResolvedValue(cycleFixture());
    tx.perfCycleConfigVersion.create.mockResolvedValue({
      id: 32,
      version: 3,
      formSnapshots: [{ id: 42, jobLevelPrefix: 'D' }],
    });
    tx.perfEvaluationSubmission.create.mockResolvedValue({ id: 65 });
    rbac.isAdmin.mockResolvedValue(true);
    service = new CycleFormChangeService(
      prisma as never,
      rbac as never,
      peer as never,
      manager as never,
    );
  });

  it('畸形嵌套 content 返回业务校验错误而不是遍历时抛出 500', async () => {
    await expect(
      service.preview('ou_admin', 8, {
        expectedConfigVersionId: 31,
        formSnapshots: [
          {
            jobLevelPrefix: 'D',
            content: {
              schemaVersion: 1,
              name: '坏表单',
              jobLevelPrefix: 'D',
              subforms: [{ key: 'subform:SELF', dimensions: null }],
            },
          },
        ],
      } as never),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('影响预览精确返回受影响提交、兼容预填和未受影响保护范围', async () => {
    const next = structuredClone(selfForm);
    next.subforms[0].dimensions[0].items.push({
      key: 'item:new-required',
      type: 'TEXTAREA',
      title: '新增必填',
      required: true,
    });

    const preview = await service.preview('ou_admin', 8, {
      expectedConfigVersionId: 31,
      formSnapshots: [{ jobLevelPrefix: 'D', content: next }],
    });

    expect(preview).toMatchObject({
      category: 'STRUCTURAL',
      canApply: true,
      affectedStages: ['SELF'],
      summary: {
        affectedParticipantCount: 1,
        affectedEffectiveSubmissionCount: 1,
        affectedEvaluatorCount: 1,
        compatibleAnswerCount: 2,
        incompatibleAnswerCount: 0,
        unaffectedEffectiveSubmissionCount: 2,
      },
    });
    expect(preview.impactRevision).toMatch(/^[a-f0-9]{64}$/);
  });

  it('已有正式提交但周期未退回 DRAFT 时拒绝结构变更', async () => {
    prisma.perfCycle.findFirst.mockResolvedValue(cycleFixture('ACTIVE'));
    tx.perfCycle.findFirst.mockResolvedValue(cycleFixture('ACTIVE'));
    const next = structuredClone(selfForm);
    next.subforms[0].dimensions[0].items[1].required = false;
    const input: any = {
      expectedConfigVersionId: 31,
      formSnapshots: [{ jobLevelPrefix: 'D', content: next }],
    };

    await expect(
      service.apply('ou_admin', 8, {
        ...input,
        reason: '新增结构前重新确认',
        confirmed: true,
        impactRevision: (await service.preview('ou_admin', 8, input))
          .impactRevision,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('同一表单前缀已有其他阶段正式提交时也必须先整体退回 DRAFT', async () => {
    const active = cycleFixture('ACTIVE');
    active.participants[0].evaluationSubmissions =
      active.participants[0].evaluationSubmissions.filter(
        (submission) => submission.stage === 'MANAGER',
      );
    prisma.perfCycle.findFirst.mockResolvedValue(active);
    const next = structuredClone(selfForm);
    next.subforms[0].dimensions[0].items[1].required = false;

    const preview = await service.preview('ou_admin', 8, {
      expectedConfigVersionId: 31,
      formSnapshots: [{ jobLevelPrefix: 'D', content: next }],
    } as never);

    expect(preview).toMatchObject({
      category: 'STRUCTURAL',
      canApply: false,
      summary: { affectedEffectiveSubmissionCount: 0 },
      blockedReason: expect.stringContaining('DRAFT'),
    });
  });

  it('应用结构变更时生成新快照、合并兼容答案为草稿并保持 MANAGER 提交有效', async () => {
    const next = structuredClone(selfForm);
    next.subforms[0].dimensions[0].items.push({
      key: 'item:new-required',
      type: 'TEXTAREA',
      title: '新增必填',
      required: true,
    });
    const input: any = {
      expectedConfigVersionId: 31,
      formSnapshots: [{ jobLevelPrefix: 'D', content: next }],
    };
    const preview = await service.preview('ou_admin', 8, input);

    const result = await service.apply('ou_admin', 8, {
      ...input,
      reason: '补充本周期必填总结',
      confirmed: true,
      impactRevision: preview.impactRevision,
    });

    expect(result).toMatchObject({ configVersionId: 32, version: 3 });
    expect(tx.perfCycleConfigVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cycleId: 8,
          version: 3,
          formSnapshots: {
            create: [expect.objectContaining({ content: next })],
          },
        }),
      }),
    );
    expect(tx.perfEvaluationSubmission.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [61, 62] } },
      data: { status: 'INVALIDATED' },
    });
    expect(tx.perfEvaluationSubmission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        formSnapshotId: 42,
        status: 'DRAFT',
        participantId: 51,
        reviewerOpenId: 'ou_employee',
      }),
    });
    expect(tx.perfEvaluationItemResult.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          submissionId: 65,
          itemKey: 'item:self-level',
          rawLevel: 'A',
        }),
        expect.objectContaining({
          submissionId: 65,
          itemKey: 'item:self-comment',
          value: { text: '草稿更新总结' },
        }),
      ]),
    });
    // 未受影响 MANAGER/PEER 提交继续指向原快照，不改写历史依据。
    expect(tx.perfEvaluationSubmission.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [63] } } }),
    );
    expect(tx.perfEvaluationTask.updateMany).toHaveBeenCalledWith({
      where: { participantId: 51, type: { in: ['SELF'] } },
      data: { completedAt: null },
    });
    expect(manager.recalculate).toHaveBeenCalledWith(51, tx);
    expect(peer.recalculate).toHaveBeenCalledWith(51, tx);
  });

  it('纯文案变更原地更新快照且不改变任何提交状态', async () => {
    const next = structuredClone(selfForm);
    next.subforms[0].title = '员工本周期自评';
    const input: any = {
      expectedConfigVersionId: 31,
      formSnapshots: [{ jobLevelPrefix: 'D', content: next }],
    };
    const preview = await service.preview('ou_admin', 8, input);

    const result = await service.apply('ou_admin', 8, {
      ...input,
      reason: '优化填写提示',
      confirmed: true,
      impactRevision: preview.impactRevision,
    });

    expect(result).toMatchObject({
      category: 'COPY_ONLY',
      configVersionId: 31,
    });
    expect(tx.perfCycleConfigVersion.create).not.toHaveBeenCalled();
    expect(tx.perfEvaluationSubmission.updateMany).not.toHaveBeenCalled();
    expect(tx.perfCycleFormSnapshot.update).toHaveBeenCalledWith({
      where: { id: 41 },
      data: { content: next },
    });
  });

  it('非结构性计算变更明确路由到周期配置版本与重算流程', async () => {
    const next = structuredClone(selfForm);
    next.subforms[2].dimensions[0].weight = '90';
    const input: any = {
      expectedConfigVersionId: 31,
      formSnapshots: [{ jobLevelPrefix: 'D', content: next }],
    };
    const preview = await service.preview('ou_admin', 8, input);
    expect(preview).toMatchObject({
      category: 'CALCULATION',
      canApply: false,
      affectedStages: ['MANAGER'],
    });

    await expect(
      service.apply('ou_admin', 8, {
        ...input,
        reason: '调整维度权重',
        confirmed: true,
        impactRevision: preview.impactRevision,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'CYCLE_FORM_CALCULATION_CHANGE_REQUIRES_CONFIG_FLOW',
      }),
    });
    expect(tx.perfCycleConfigVersion.create).not.toHaveBeenCalled();
  });

  it('受影响 PEER 提交转为草稿时同步恢复评审指派与任务待办', async () => {
    const next = structuredClone(selfForm);
    next.subforms[1].dimensions[0].items[0].required = false;
    const input: any = {
      expectedConfigVersionId: 31,
      formSnapshots: [{ jobLevelPrefix: 'D', content: next }],
    };
    const preview = await service.preview('ou_admin', 8, input);

    await service.apply('ou_admin', 8, {
      ...input,
      reason: '调整 360°必填结构',
      confirmed: true,
      impactRevision: preview.impactRevision,
    });

    expect(tx.perfEvaluationSubmission.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [64] } },
      data: { status: 'INVALIDATED' },
    });
    expect(tx.perfEvaluationSubmission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'DRAFT',
        formSnapshotId: 42,
        reviewerAssignmentId: 91,
      }),
    });
    expect(tx.perfReviewerAssignment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [91] }, status: 'SUBMITTED' },
      data: { status: 'PENDING' },
    });
    expect(tx.perfEvaluationTask.updateMany).toHaveBeenCalledWith({
      where: { participantId: 51, type: { in: ['PEER'] } },
      data: { completedAt: null },
    });
    expect(peer.recalculate).not.toHaveBeenCalled();
    expect(manager.recalculate).toHaveBeenCalledWith(51, tx);
  });

  it('多前缀混合修改只让结构受影响答卷重交，计算前缀保持有效并重算', async () => {
    const mixed = cycleFixture();
    const mForm = structuredClone(selfForm);
    mForm.name = 'M 表单';
    mForm.jobLevelPrefix = 'M';
    mixed.currentConfigVersion.formSnapshots.push({
      ...mixed.currentConfigVersion.formSnapshots[0],
      id: 43,
      jobLevelPrefix: 'M',
      sourceFormTemplateVersionId: 22,
      content: mForm,
    });
    mixed.participants.push({
      ...mixed.participants[0],
      id: 52,
      employeeOpenId: 'ou_manager_employee',
      jobLevelPrefixSnapshot: 'M',
      formSnapshotId: 43,
      evaluationSubmissions: [
        {
          ...mixed.participants[0].evaluationSubmissions.find(
            (submission) => submission.stage === 'MANAGER',
          )!,
          id: 80,
          participantId: 52,
          reviewerOpenId: 'ou_manager_leader',
        },
      ],
    });
    prisma.perfCycle.findFirst.mockResolvedValue(mixed);
    tx.perfCycle.findFirst.mockResolvedValue(mixed);
    tx.perfCycleConfigVersion.create.mockResolvedValueOnce({
      id: 32,
      version: 3,
      formSnapshots: [
        { id: 42, jobLevelPrefix: 'D' },
        { id: 44, jobLevelPrefix: 'M' },
      ],
    });
    const nextD = structuredClone(selfForm);
    nextD.subforms[0].dimensions[0].items[1].required = false;
    const nextM = structuredClone(mForm);
    nextM.subforms[2].dimensions[0].weight = '90';
    const input: any = {
      expectedConfigVersionId: 31,
      formSnapshots: [
        { jobLevelPrefix: 'D', content: nextD },
        { jobLevelPrefix: 'M', content: nextM },
      ],
    };
    const preview = await service.preview('ou_admin', 8, input);

    await service.apply('ou_admin', 8, {
      ...input,
      reason: 'D 表单结构调整并同步 M 权重',
      confirmed: true,
      impactRevision: preview.impactRevision,
    });

    expect(preview).toMatchObject({
      category: 'STRUCTURAL',
      affectedStages: ['SELF', 'MANAGER'],
      classifications: expect.arrayContaining([
        expect.objectContaining({
          jobLevelPrefix: 'M',
          category: 'CALCULATION',
          affectedStages: ['MANAGER'],
        }),
      ]),
    });
    expect(tx.perfEvaluationSubmission.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [80] } } }),
    );
    expect(manager.recalculate).toHaveBeenCalledWith(52, tx);
  });
});
