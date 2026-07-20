import { BadRequestException, ConflictException } from '@nestjs/common';
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
  PerfEvaluationTaskType: { SELF: 'SELF', PEER: 'PEER', MANAGER: 'MANAGER' },
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

const field = (key: string, type = 'LONG_TEXT') => ({
  key,
  type,
  title: key,
  requiredRule: 'OPTIONAL',
  requiredLevels: [],
  sortOrder: 0,
  config: null,
});

const form: any = {
  schemaVersion: 2,
  name: 'D 表单',
  jobLevelPrefix: 'D',
  subforms: [
    {
      key: 'subform:SELF',
      type: 'SELF',
      title: '员工自评',
      sortOrder: 0,
      dimensions: [
        {
          key: 'dimension:self',
          type: 'SCORING',
          audience: 'EMPLOYEE',
          name: '自评等级',
          scoringMethod: 'RATING',
          weight: '100',
          isCore: true,
          sortOrder: 0,
          fields: [field('field:self-comment')],
        },
      ],
    },
    {
      key: 'subform:PEER',
      type: 'PEER',
      title: '360°评估',
      sortOrder: 1,
      dimensions: [
        {
          key: 'dimension:peer',
          type: 'SCORING',
          audience: 'REVIEWER',
          name: '协作表现',
          scoringMethod: 'RATING',
          weight: '100',
          isCore: true,
          sortOrder: 0,
          fields: [],
        },
      ],
    },
    {
      key: 'subform:MANAGER',
      type: 'MANAGER',
      title: '上级评估',
      sortOrder: 2,
      dimensions: [
        {
          key: 'dimension:manager',
          type: 'SCORING',
          audience: 'LEADER',
          name: '上级评分',
          scoringMethod: 'SCORE',
          weight: '100',
          isCore: true,
          sortOrder: 0,
          fields: [],
        },
      ],
    },
  ],
};

const answer = (
  id: number,
  dimensionKey: string,
  scoringMethod: string | null,
  values: Record<string, unknown> = {},
) => ({
  id,
  subformKey: 'subform:SELF',
  dimensionKey,
  scoringMethod,
  rawLevel: values.rawLevel ?? null,
  rawScore: values.rawScore ?? null,
  calculationScore: values.calculationScore ?? null,
  derivedLevel: values.derivedLevel ?? null,
  fields: values.fields ?? [],
});

function cycleFixture(status = 'DRAFT') {
  const historicalForm = structuredClone(form);
  historicalForm.subforms[0].dimensions.push({
    key: 'dimension:deleted-history',
    type: 'NON_SCORING',
    audience: 'EMPLOYEE',
    name: '已删除历史维度',
    scoringMethod: null,
    weight: null,
    isCore: false,
    sortOrder: 1,
    fields: [field('field:deleted-history')],
  });
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
      ratings: [],
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
          content: form,
        },
      ],
    },
    configVersions: [
      {
        id: 30,
        formSnapshots: [
          {
            id: 40,
            jobLevelPrefix: 'D',
            content: historicalForm,
          },
        ],
      },
      {
        id: 31,
        formSnapshots: [
          {
            id: 41,
            jobLevelPrefix: 'D',
            content: form,
          },
        ],
      },
    ],
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
            dimensionAnswers: [
              answer(71, 'dimension:self', 'RATING', {
                rawLevel: 'A',
                calculationScore: '85',
                derivedLevel: 'A',
                fields: [
                  {
                    id: 711,
                    fieldKey: 'field:self-comment',
                    fieldType: 'LONG_TEXT',
                    value: '已提交总结',
                  },
                ],
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
            dimensionAnswers: [
              answer(72, 'dimension:self', 'RATING', {
                rawLevel: 'A',
                fields: [
                  {
                    id: 721,
                    fieldKey: 'field:self-comment',
                    fieldType: 'LONG_TEXT',
                    value: '草稿更新总结',
                  },
                ],
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
            dimensionAnswers: [
              {
                ...answer(73, 'dimension:manager', 'SCORE', {
                  rawScore: '85',
                  calculationScore: '85',
                  derivedLevel: 'A',
                }),
                subformKey: 'subform:MANAGER',
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('CycleFormChangeService 新版维度/字段公开契约', () => {
  const tx = {
    $queryRaw: jest.fn(),
    perfCycle: { findFirst: jest.fn(), update: jest.fn() },
    perfCycleConfigVersion: { create: jest.fn() },
    perfCycleFormSnapshot: { update: jest.fn() },
    perfParticipant: { updateMany: jest.fn() },
    perfEvaluationSubmission: { create: jest.fn(), updateMany: jest.fn() },
    perfEvaluationDimensionAnswer: { create: jest.fn() },
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
  const rbac = { isAdmin: jest.fn(), getOrgScope: jest.fn() };
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

  it('影响预览返回维度/字段变化、兼容预填和失效数量', async () => {
    const next = structuredClone(form);
    next.subforms[0].dimensions[0].fields.push({
      ...field('field:new-required'),
      requiredRule: 'ALWAYS',
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
        affectedDraftCount: 1,
        compatibleAnswerCount: 2,
        incompatibleAnswerCount: 0,
        unaffectedEffectiveSubmissionCount: 1,
      },
      classifications: [
        expect.objectContaining({
          changes: expect.arrayContaining([
            expect.objectContaining({
              kind: 'FIELD_ADDED',
              fieldKey: 'field:new-required',
            }),
          ]),
        }),
      ],
    });
  });

  it('结构变更后按稳定 key 合并草稿，并在字段跨维度移动后改挂新父维度', async () => {
    const next = structuredClone(form);
    const moved = next.subforms[0].dimensions[0].fields.shift();
    next.subforms[0].dimensions.push({
      key: 'dimension:summary',
      type: 'NON_SCORING',
      audience: 'EMPLOYEE',
      name: '总结补充',
      scoringMethod: null,
      weight: null,
      isCore: false,
      sortOrder: 1,
      fields: [moved],
    });
    const input: any = {
      expectedConfigVersionId: 31,
      formSnapshots: [{ jobLevelPrefix: 'D', content: next }],
    };
    const preview = await service.preview('ou_admin', 8, input);
    await service.apply('ou_admin', 8, {
      ...input,
      reason: '将总结字段归入补充维度',
      confirmed: true,
      impactRevision: preview.impactRevision,
    });

    expect(tx.perfEvaluationSubmission.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [61, 62] } },
      data: { status: 'INVALIDATED' },
    });
    expect(tx.perfEvaluationDimensionAnswer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        submissionId: 65,
        dimensionKey: 'dimension:self',
        scoringMethod: 'RATING',
        rawLevel: 'A',
        calculationScore: null,
      }),
    });
    expect(tx.perfEvaluationDimensionAnswer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        submissionId: 65,
        scoringMethod: null,
        fields: {
          create: [
            expect.objectContaining({
              fieldKey: 'field:self-comment',
              value: '草稿更新总结',
            }),
          ],
        },
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'cycle.form.change',
        after: expect.objectContaining({
          changes: expect.arrayContaining([
            expect.objectContaining({
              kind: 'FIELD_MOVED',
              dimensionKey: 'dimension:self',
              fieldKey: 'field:self-comment',
              message: expect.stringContaining('表单字段'),
            }),
          ]),
        }),
      }),
    });
  });

  it('计分方式和字段类型变更保留 key，但旧值明确失效且不误配', async () => {
    const next = structuredClone(form);
    next.subforms[0].dimensions[0].scoringMethod = 'SCORE';
    next.subforms[0].dimensions[0].fields[0].type = 'MARKDOWN';
    const preview = await service.preview('ou_admin', 8, {
      expectedConfigVersionId: 31,
      formSnapshots: [{ jobLevelPrefix: 'D', content: next }],
    });

    expect(preview.summary).toMatchObject({
      compatibleAnswerCount: 0,
      incompatibleAnswerCount: 2,
    });
    expect(preview.classifications[0].changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'DIMENSION_SCORING_METHOD_CHANGED',
          dimensionKey: 'dimension:self',
        }),
        expect.objectContaining({
          kind: 'FIELD_TYPE_CHANGED',
          fieldKey: 'field:self-comment',
        }),
      ]),
    );
  });

  it('固定子表单 key 必须来自当前快照，且禁止伪造 PROMOTION 子表单', async () => {
    const forged = structuredClone(form);
    forged.subforms[0].key = 'client-forged-self';
    await expect(
      service.preview('ou_admin', 8, {
        expectedConfigVersionId: 31,
        formSnapshots: [{ jobLevelPrefix: 'D', content: forged }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const promotion = structuredClone(form);
    promotion.subforms.push({
      key: 'subform:PROMOTION',
      type: 'PROMOTION',
      title: '伪造晋升',
      sortOrder: 3,
      dimensions: [],
    });
    await expect(
      service.preview('ou_admin', 8, {
        expectedConfigVersionId: 31,
        formSnapshots: [{ jobLevelPrefix: 'D', content: promotion }],
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('历史快照是墓碑注册表，已删除 key 不得复用且禁止维度与字段身份串用', async () => {
    const reused = structuredClone(form);
    reused.subforms[0].dimensions.push({
      key: 'dimension:deleted-history',
      type: 'NON_SCORING',
      audience: 'EMPLOYEE',
      name: '冒用已删除维度',
      scoringMethod: null,
      weight: null,
      isCore: false,
      sortOrder: 1,
      fields: [],
    });
    await expect(
      service.preview('ou_admin', 8, {
        expectedConfigVersionId: 31,
        formSnapshots: [{ jobLevelPrefix: 'D', content: reused }],
      }),
    ).rejects.toThrow('已删除');

    const swapped = structuredClone(form);
    swapped.subforms[0].dimensions[0].key = 'field:self-comment';
    swapped.subforms[0].dimensions[0].fields = [];
    await expect(
      service.preview('ou_admin', 8, {
        expectedConfigVersionId: 31,
        formSnapshots: [{ jobLevelPrefix: 'D', content: swapped }],
      }),
    ).rejects.toThrow('身份类型');
  });

  it('预览允许临时 key，应用时由服务端生成全新 key 并保持字段嵌套关系', async () => {
    const next = structuredClone(form);
    next.subforms[0].dimensions.push({
      key: 'client-temp-dimension',
      type: 'NON_SCORING',
      audience: 'EMPLOYEE',
      name: '新增补充维度',
      scoringMethod: null,
      weight: null,
      isCore: false,
      sortOrder: 1,
      fields: [field('client-temp-field')],
    });
    const input = {
      expectedConfigVersionId: 31,
      formSnapshots: [{ jobLevelPrefix: 'D' as const, content: next }],
    };
    const preview = await service.preview('ou_admin', 8, input);
    expect(preview.classifications[0].changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'DIMENSION_ADDED',
          dimensionKey: 'client-temp-dimension',
        }),
      ]),
    );

    const result = await service.apply('ou_admin', 8, {
      ...input,
      reason: '新增补充维度',
      confirmed: true,
      impactRevision: preview.impactRevision,
    });
    const createInput = tx.perfCycleConfigVersion.create.mock.calls[0][0];
    const persisted = createInput.data.formSnapshots.create[0].content;
    const added = persisted.subforms[0].dimensions.at(-1);
    expect(added.key).not.toBe('client-temp-dimension');
    expect(added.fields[0].key).not.toBe('client-temp-field');
    expect(added.fields).toHaveLength(1);
    expect(result.materializedIdentities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'DIMENSION',
          clientKey: 'client-temp-dimension',
          serverKey: added.key,
        }),
        expect.objectContaining({
          kind: 'FIELD',
          clientKey: 'client-temp-field',
          serverKey: added.fields[0].key,
        }),
      ]),
    );
  });

  it('有正式提交的 ACTIVE 周期必须先整体退回 DRAFT', async () => {
    prisma.perfCycle.findFirst.mockResolvedValue(cycleFixture('ACTIVE'));
    const next = structuredClone(form);
    next.subforms[0].dimensions[0].fields[0].requiredRule = 'ALWAYS';
    const preview = await service.preview('ou_admin', 8, {
      expectedConfigVersionId: 31,
      formSnapshots: [{ jobLevelPrefix: 'D', content: next }],
    });

    expect(preview.canApply).toBe(false);
    await expect(
      service.apply('ou_admin', 8, {
        expectedConfigVersionId: 31,
        formSnapshots: [{ jobLevelPrefix: 'D', content: next }],
        reason: '调整必填规则',
        confirmed: true,
        impactRevision: preview.impactRevision,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
