import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ActiveCycleConfigChangeService } from './active-cycle-config-change.service';

jest.mock('../generated/prisma/client', () => ({
  PrismaClient: class {},
  Prisma: {},
}));
jest.mock('../generated/prisma/enums', () => ({
  PerfCycleStatus: { ACTIVE: 'ACTIVE' },
  PerfEvaluationTaskType: {
    SELF: 'SELF',
    PEER: 'PEER',
    MANAGER: 'MANAGER',
    AI: 'AI',
  },
  PerfReviewStatus: { DRAFT: 'DRAFT', SUBMITTED: 'SUBMITTED' },
  PerfAssignmentStatus: { SUBMITTED: 'SUBMITTED' },
  PerfRole: { HR: 'HR', ADMIN: 'ADMIN' },
}));
jest.mock('../shared/database/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('../rbac/rbac.service', () => ({ RbacService: class {} }));
jest.mock('./manager-stage-result.service', () => ({
  ManagerStageResultService: class {},
}));
jest.mock('./peer-stage-result.service', () => ({
  PeerStageResultService: class {},
}));

const ratings = [
  {
    symbol: 'S',
    name: '卓越',
    minScore: '90',
    maxScore: '100',
    mappingScore: '95',
  },
  {
    symbol: 'A',
    name: '优秀',
    minScore: '80',
    maxScore: '90',
    mappingScore: '85',
  },
  {
    symbol: 'B',
    name: '良好',
    minScore: '60',
    maxScore: '80',
    mappingScore: '70',
  },
  {
    symbol: 'C',
    name: '待改进',
    minScore: '0',
    maxScore: '60',
    mappingScore: '50',
  },
];

const configInput = {
  dimensionOverrides: [],
  ratings,
  reviewerRelationWeights: {
    ORG_OWNER: '30',
    PROJECT_OWNER: '30',
    PEER: '25',
    CROSS_DEPT: '15',
  },
};

const formContent = {
  schemaVersion: 2,
  name: 'D 表单',
  jobLevelPrefix: 'D',
  subforms: [
    {
      key: 'subform:MANAGER',
      type: 'MANAGER',
      title: '上级评估',
      dimensions: [
        {
          key: 'dimension:delivery',
          type: 'SCORING',
          audience: 'LEADER',
          name: '核心业绩',
          scoringMethod: 'SCORE',
          weight: '100',
          isCore: true,
          fields: [],
        },
      ],
    },
  ],
};

function cycleFixture() {
  return {
    id: 8,
    status: 'ACTIVE',
    deletedAt: null,
    ownerOpenId: 'ou_owner',
    currentConfigVersionId: 31,
    currentConfigVersion: {
      id: 31,
      cycleId: 8,
      version: 2,
      sourceConfigTemplateVersionId: 11,
      ratings,
      orgOwnerWeight: { toString: () => '30' },
      projectOwnerWeight: { toString: () => '30' },
      peerWeight: { toString: () => '25' },
      crossDeptWeight: { toString: () => '15' },
      schedulePreset: { allowStageOverlap: true, stages: [] },
      notificationRules: { stages: [] },
      formSnapshots: [
        {
          id: 41,
          cycleConfigVersionId: 31,
          cycleId: 8,
          jobLevelPrefix: 'D',
          sourceFormTemplateVersionId: 21,
          content: formContent,
        },
      ],
    },
    participants: [
      {
        id: 51,
        employeeOpenId: 'ou_employee',
        updatedAt: new Date('2026-07-01T00:00:00Z'),
        cycleId: 8,
        departmentIdSnapshot: 'od_scope',
        jobLevelPrefixSnapshot: 'D',
        formSnapshotId: 41,
        evaluationLockedAt: new Date('2026-07-01T00:00:00Z'),
        formSnapshot: { id: 41, content: formContent },
        evaluationSubmissions: [
          {
            id: 61,
            stage: 'MANAGER',
            status: 'SUBMITTED',
            reviewerOpenId: 'ou_leader',
            reviewerAssignment: null,
            dimensionAnswers: [
              {
                subformKey: 'subform:MANAGER',
                dimensionKey: 'dimension:delivery',
                scoringMethod: 'SCORE',
                rawLevel: null,
                rawScore: { toString: () => '70' },
                calculationScore: { toString: () => '70' },
                derivedLevel: 'B',
                fields: [],
              },
            ],
          },
          {
            id: 62,
            stage: 'SELF',
            status: 'DRAFT',
            reviewerOpenId: 'ou_employee',
            reviewerAssignment: null,
            dimensionAnswers: [
              {
                subformKey: 'subform:SELF',
                dimensionKey: 'dimension:delivery',
                scoringMethod: 'RATING',
                rawLevel: 'A',
                rawScore: null,
                calculationScore: { toString: () => '85' },
                derivedLevel: 'A',
                fields: [],
              },
            ],
          },
        ],
        stageResults: [
          {
            id: 71,
            cycleConfigVersionId: 31,
            stage: 'MANAGER',
            status: 'READY',
            compositeScore: { toString: () => '70' },
            stageLevel: 'B',
            constraintReasons: [
              {
                id: 'core-b-cap',
                type: 'CORE_B_CAP',
                dimensionIds: ['dimension:delivery'],
                parameters: { targetLevel: 'B' },
                beforeLevel: 'B',
                afterLevel: 'B',
                changed: false,
              },
            ],
            dimensions: [
              {
                dimensionKey: 'dimension:delivery',
                name: '核心业绩',
                weight: { toString: () => '100' },
                isCore: true,
                score: { toString: () => '70' },
                level: 'B',
              },
            ],
          },
        ],
        calibrations: [{ id: 81 }],
        resultVersions: [
          {
            id: 91,
            supersededAt: null,
            confirmedAt: new Date('2026-07-05T00:00:00Z'),
          },
        ],
        redLineFindings: [],
      },
    ],
  };
}

describe('ActiveCycleConfigChangeService 公开契约', () => {
  const tx = {
    $queryRaw: jest.fn(),
    perfCycle: { findFirst: jest.fn(), update: jest.fn() },
    perfCycleConfigVersion: { create: jest.fn() },
    perfParticipant: { updateMany: jest.fn(), update: jest.fn() },
    perfEvaluationSubmission: { updateMany: jest.fn() },
    perfEvaluationDimensionAnswer: { updateMany: jest.fn() },
    perfStageResult: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
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
  let service: ActiveCycleConfigChangeService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.perfCycle.findFirst.mockResolvedValue(cycleFixture());
    tx.perfCycle.findFirst.mockResolvedValue(cycleFixture());
    tx.perfCycleConfigVersion.create.mockResolvedValue({
      id: 32,
      version: 3,
      formSnapshots: [{ id: 42, jobLevelPrefix: 'D' }],
    });
    rbac.isAdmin.mockResolvedValue(false);
    rbac.getOrgScope.mockResolvedValue(['od_scope']);
    manager.recalculate.mockResolvedValue({ stageLevel: 'B' });
    service = new ActiveCycleConfigChangeService(
      prisma as never,
      rbac as never,
      peer as never,
      manager as never,
    );
  });

  it('影响预览返回阶段变化并区分已校准、已发布与已确认保护范围', async () => {
    const preview = await service.preview('ou_hr', 8, {
      ...configInput,
      ratings: configInput.ratings.map((rating) =>
        rating.symbol === 'A'
          ? { ...rating, minScore: '70' }
          : rating.symbol === 'B'
            ? { ...rating, maxScore: '70', mappingScore: '65' }
            : rating,
      ),
      expectedConfigVersionId: 31,
    } as never);

    expect(preview.summary).toEqual({
      affectedParticipantCount: 1,
      affectedStageResultCount: 1,
      changedStageResultCount: 1,
      calibratedParticipantCount: 1,
      publishedParticipantCount: 1,
      confirmedParticipantCount: 1,
      automaticRecalibrationParticipantCount: 0,
      affectedCalculationDimensionCount: 1,
      changedCalculationDimensionCount: 0,
    });
    expect(preview.stageChanges[0]).toMatchObject({
      participantId: 51,
      employeeOpenId: 'ou_employee',
      stage: 'MANAGER',
      before: { compositeScore: '70', stageLevel: 'B' },
      after: { compositeScore: '70.00', stageLevel: 'A' },
      finalResultProtected: true,
    });
  });

  it('组织范围不覆盖全部受影响参与者时拒绝预览', async () => {
    rbac.getOrgScope.mockResolvedValue(['od_other']);

    await expect(
      service.preview('ou_hr', 8, {
        ...configInput,
        expectedConfigVersionId: 31,
      } as never),
    ).rejects.toThrow(ForbiddenException);
  });

  it('拒绝未知或重复的维度稳定 key', async () => {
    await expect(
      service.preview('ou_hr', 8, {
        ...configInput,
        expectedConfigVersionId: 31,
        dimensionOverrides: [
          {
            jobLevelPrefix: 'D',
            dimensionKey: 'dimension:missing',
            weight: '100',
            isCore: true,
          },
        ],
      } as never),
    ).rejects.toThrow('未唯一命中');

    const duplicate = {
      jobLevelPrefix: 'D',
      dimensionKey: 'dimension:delivery',
      weight: '100',
      isCore: true,
    };
    await expect(
      service.preview('ou_hr', 8, {
        ...configInput,
        expectedConfigVersionId: 31,
        dimensionOverrides: [duplicate, duplicate],
      } as never),
    ).rejects.toThrow('重复');
  });

  it('只存在十进制展示格式差异时不误报阶段结果变化', async () => {
    const preview = await service.preview('ou_hr', 8, {
      ...configInput,
      expectedConfigVersionId: 31,
    } as never);

    expect(preview.stageChanges[0]).toMatchObject({
      before: { compositeScore: '70', stageLevel: 'B' },
      after: { compositeScore: '70.00', stageLevel: 'B' },
      changed: false,
    });
    expect(preview.summary.changedStageResultCount).toBe(0);
  });

  it('确认修改必须带非空原因和显式确认', async () => {
    await expect(
      service.apply('ou_hr', 8, {
        ...configInput,
        expectedConfigVersionId: 31,
        reason: '   ',
        confirmed: true,
      } as never),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.apply('ou_hr', 8, {
        ...configInput,
        expectedConfigVersionId: 31,
        reason: '修正规则',
        confirmed: false,
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('配置版本已被并发修改时拒绝静默覆盖', async () => {
    await expect(
      service.apply('ou_hr', 8, {
        ...configInput,
        expectedConfigVersionId: 30,
        reason: '修正规则',
        confirmed: true,
      } as never),
    ).rejects.toThrow(ConflictException);

    expect(tx.perfCycleConfigVersion.create).not.toHaveBeenCalled();
  });

  it('配置版本未变但预览后的答卷或人工结果变化时拒绝旧确认', async () => {
    const preview = await service.preview('ou_hr', 8, {
      ...configInput,
      expectedConfigVersionId: 31,
    } as never);
    const changed = cycleFixture();
    changed.participants[0].updatedAt = new Date('2026-07-02T00:00:00Z');
    tx.perfCycle.findFirst.mockResolvedValue(changed);

    await expect(
      service.apply('ou_hr', 8, {
        ...configInput,
        expectedConfigVersionId: 31,
        impactRevision: preview.impactRevision,
        reason: '修正规则',
        confirmed: true,
      } as never),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ACTIVE_CONFIG_IMPACT_STALE' }),
    });
    expect(tx.perfCycleConfigVersion.create).not.toHaveBeenCalled();
  });

  it('预览纳入 SELF 草稿的评级映射重算范围', async () => {
    const preview = await service.preview('ou_hr', 8, {
      ...configInput,
      ratings: configInput.ratings.map((rating) =>
        rating.symbol === 'A' ? { ...rating, mappingScore: '88' } : rating,
      ),
      expectedConfigVersionId: 31,
    } as never);

    expect(preview.summary).toMatchObject({
      affectedCalculationDimensionCount: 1,
      changedCalculationDimensionCount: 1,
    });
    expect(preview.calculationDimensionChanges[0]).toMatchObject({
      stage: 'SELF',
      status: 'DRAFT',
      dimensionKey: 'dimension:delivery',
      before: '85',
      after: '88',
      changed: true,
    });
  });

  it('确认后在同一事务追加配置版本、换绑并重算，但不覆盖校准与结果版本', async () => {
    tx.perfCycle.findFirst.mockResolvedValue(cycleFixture());
    const preview = await service.preview('ou_hr', 8, {
      ...configInput,
      expectedConfigVersionId: 31,
    } as never);

    const result = await service.apply('ou_hr', 8, {
      ...configInput,
      expectedConfigVersionId: 31,
      impactRevision: preview.impactRevision,
      reason: '修正评级区间',
      confirmed: true,
    } as never);

    expect(tx.perfCycleConfigVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cycleId: 8,
        version: 3,
        ratings: configInput.ratings,
        formSnapshots: {
          create: [expect.objectContaining({ content: formContent })],
        },
      }),
      include: { formSnapshots: true },
    });
    expect(tx.perfCycle.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: { currentConfigVersionId: 32 },
    });
    expect(manager.recalculate).toHaveBeenCalledWith(51, tx);
    expect(tx.perfEvaluationDimensionAnswer.updateMany).toHaveBeenCalledTimes(
      4,
    );
    expect(tx.perfEvaluationDimensionAnswer.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        submission: { participantId: { in: [51] } },
        scoringMethod: 'RATING',
      }),
      data: expect.any(Object),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'cycle.active_config.recalculate',
        reason: '修正评级区间',
      }),
    });
    expect(tx).not.toHaveProperty('perfCalibration');
    expect(tx).not.toHaveProperty('perfResultVersion');
    expect(result).toMatchObject({ configVersionId: 32, version: 3 });
  });

  it('任一阶段重算失败时向事务抛错且不写审计成功记录', async () => {
    const preview = await service.preview('ou_hr', 8, {
      ...configInput,
      expectedConfigVersionId: 31,
    } as never);
    manager.recalculate.mockRejectedValueOnce(new Error('阶段重算失败'));

    await expect(
      service.apply('ou_hr', 8, {
        ...configInput,
        expectedConfigVersionId: 31,
        impactRevision: preview.impactRevision,
        reason: '修正规则',
        confirmed: true,
      } as never),
    ).rejects.toThrow('阶段重算失败');
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
