import { BadRequestException } from '@nestjs/common';
import { CycleSetupService } from './cycle-setup.service';

// 生成的 Prisma client 是 ESM 产物，单测只验证服务编排，统一隔离真实客户端。
jest.mock(
  '../generated/prisma/client',
  () => ({
    PrismaClient: class {
      $connect = jest.fn();
      $disconnect = jest.fn();
    },
  }),
  { virtual: true },
);
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfCycleStatus: {
      DRAFT: 'DRAFT',
      SCHEDULED: 'SCHEDULED',
      ACTIVE: 'ACTIVE',
      ARCHIVED: 'ARCHIVED',
    },
    PerfRole: { HR: 'HR', ADMIN: 'ADMIN' },
  }),
  { virtual: true },
);
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation((options: unknown) => options),
}));
jest.mock('../audit/audit.service', () => ({ AuditService: class {} }));
jest.mock('../rbac/rbac.service', () => ({ RbacService: class {} }));
jest.mock('../shared/database/prisma.service', () => ({
  PrismaService: class {},
}));

describe('CycleSetupService', () => {
  const source = {
    id: 30,
    templateId: 3,
    status: 'PUBLISHED',
    name: '标准配置',
    version: 2,
    selfStageMode: 'DIRECT_RATING',
    peerStageMode: 'WEIGHTED_RATING',
    managerStageMode: 'WEIGHTED_SCORE',
    aiStageMode: 'DIRECT_RATING',
    ratings: [{ symbol: 'S', mappingScore: '95' }],
    constraintProfiles: {},
    orgOwnerWeight: 30,
    projectOwnerWeight: 30,
    peerWeight: 25,
    crossDeptWeight: 15,
    schedulePreset: {
      allowStageOverlap: false,
      stages: [
        {
          stage: 'SELF',
          startOffsetMinutes: 0,
          reminderDeadlineOffsetMinutes: 60,
        },
        {
          stage: 'PEER',
          startOffsetMinutes: 60,
          reminderDeadlineOffsetMinutes: 120,
        },
        {
          stage: 'MANAGER',
          startOffsetMinutes: 120,
          reminderDeadlineOffsetMinutes: 180,
        },
      ],
    },
    notificationRules: {
      stages: ['SELF', 'PEER', 'MANAGER'].map((stage) => ({
        stage,
        taskOpened: {
          enabled: true,
          recipient: 'ASSIGNEE',
          ccLeader: false,
          ccHr: true,
        },
        reminder: {
          enabled: true,
          recipient: 'ASSIGNEE',
          ccLeader: true,
          ccHr: true,
          frequency: { type: 'ONCE_AT_DEADLINE' },
        },
      })),
    },
    template: { id: 3 },
    formBindings: ['D', 'M'].map((jobLevelPrefix, index) => ({
      formTemplateVersionId: 100 + index,
      jobLevelPrefix,
      formTemplateVersion: {
        id: 100 + index,
        status: 'ARCHIVED',
        name: `${jobLevelPrefix} 表单`,
        description: null,
        jobLevelPrefix,
        subforms: [
          {
            type: 'SELF',
            title: '自评',
            description: null,
            sortOrder: 0,
            dimensions: [
              {
                audience: 'EMPLOYEE',
                kind: 'REGULAR',
                name: '业绩',
                description: null,
                weight: 100,
                isCore: true,
                sortOrder: 0,
                items: [
                  {
                    type: 'RATING',
                    title: '评级',
                    description: null,
                    placeholder: null,
                    required: true,
                    sortOrder: 0,
                    config: null,
                  },
                ],
              },
            ],
          },
        ],
      },
    })),
  };

  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    perfConfigTemplateVersion: { findUnique: jest.fn() },
    perfCycle: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
    perfCycleConfigVersion: { create: jest.fn(), update: jest.fn() },
    perfParticipant: { update: jest.fn() },
    larkUser: { findMany: jest.fn() },
    larkCorehrEmployee: { findMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      Promise.resolve(callback(tx)),
    ),
    perfCycle: { findFirst: jest.fn() },
  };
  const audit = { record: jest.fn() };
  const rbac = { hasAnyRole: jest.fn().mockResolvedValue(true) };
  let service: CycleSetupService;

  beforeEach(() => {
    jest.clearAllMocks();
    tx.perfConfigTemplateVersion.findUnique.mockResolvedValue(
      structuredClone(source),
    );
    tx.perfCycle.create.mockResolvedValue({ id: 9 });
    tx.perfCycleConfigVersion.create.mockResolvedValue({ id: 19 });
    tx.larkUser.findMany.mockResolvedValue([]);
    tx.larkCorehrEmployee.findMany.mockResolvedValue([]);
    prisma.perfCycle.findFirst.mockResolvedValue({
      id: 9,
      status: 'DRAFT',
      currentConfigVersion: { formSnapshots: [] },
      participants: [],
    });
    service = new CycleSetupService(
      prisma as never,
      audit as never,
      rbac as never,
    );
  });

  it('创建周期时原子复制配置、D/M 完整表单与来源版本（来源表单后来归档仍可用）', async () => {
    await service.createFromPublishedConfig('ou_hr', {
      name: '2026 上半年绩效评定',
      configTemplateVersionId: 30,
      plannedStartAt: '2026-07-14T09:00:00+08:00',
    });

    expect(tx.perfCycle.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: '2026 上半年绩效评定',
        status: 'DRAFT',
      }),
    });
    expect(tx.perfCycle.create.mock.calls[0][0].data).not.toHaveProperty(
      'startDate',
    );
    expect(tx.perfCycle.create.mock.calls[0][0].data).not.toHaveProperty(
      'endDate',
    );
    const snapshotData = tx.perfCycleConfigVersion.create.mock.calls[0][0].data;
    // 阶段模式、评级、约束、四个关系权重、日程预设、通知规则均须与来源模板版本一致地复制到周期快照。
    expect(snapshotData).toMatchObject({
      cycleId: 9,
      sourceConfigTemplateVersionId: 30,
      selfStageMode: 'DIRECT_RATING',
      peerStageMode: 'WEIGHTED_RATING',
      managerStageMode: 'WEIGHTED_SCORE',
      aiStageMode: 'DIRECT_RATING',
      ratings: [{ symbol: 'S', mappingScore: '95' }],
      constraintProfiles: {},
      orgOwnerWeight: 30,
      projectOwnerWeight: 30,
      peerWeight: 25,
      crossDeptWeight: 15,
      schedulePreset: source.schedulePreset,
      notificationRules: source.notificationRules,
    });
    expect(snapshotData.formSnapshots.create).toHaveLength(2);
    expect(snapshotData.formSnapshots.create[0]).toMatchObject({
      jobLevelPrefix: 'D',
      sourceFormTemplateVersionId: 100,
      content: {
        schemaVersion: 1,
        name: 'D 表单',
        jobLevelPrefix: 'D',
        subforms: [
          expect.objectContaining({
            type: 'SELF',
            title: '自评',
            dimensions: [
              expect.objectContaining({
                kind: 'REGULAR',
                audience: 'EMPLOYEE',
                name: '业绩',
                weight: '100',
                isCore: true,
                items: [
                  expect.objectContaining({
                    type: 'RATING',
                    title: '评级',
                    required: true,
                  }),
                ],
              }),
            ],
          }),
        ],
      },
    });
    expect(snapshotData.formSnapshots.create[1]).toMatchObject({
      jobLevelPrefix: 'M',
      sourceFormTemplateVersionId: 101,
      content: expect.objectContaining({
        jobLevelPrefix: 'M',
        name: 'M 表单',
      }),
    });
    expect(tx.perfCycle.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { currentConfigVersionId: 19 },
    });
  });

  it('未发布配置版本不能创建周期', async () => {
    tx.perfConfigTemplateVersion.findUnique.mockResolvedValue({
      ...structuredClone(source),
      status: 'ARCHIVED',
    });

    await expect(
      service.createFromPublishedConfig('ou_hr', {
        name: '2026 上半年绩效评定',
        configTemplateVersionId: 30,
        plannedStartAt: '2026-07-14T09:00:00+08:00',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(tx.perfCycle.create).not.toHaveBeenCalled();
  });

  it('草稿状态配置版本同样不能创建周期，并返回可读中文错误', async () => {
    tx.perfConfigTemplateVersion.findUnique.mockResolvedValue({
      ...structuredClone(source),
      status: 'DRAFT',
    });

    await expect(
      service.createFromPublishedConfig('ou_hr', {
        name: '2026 上半年绩效评定',
        configTemplateVersionId: 30,
        plannedStartAt: '2026-07-14T09:00:00+08:00',
      }),
    ).rejects.toThrow('配置模板版本未发布或已不可用');
    expect(tx.perfCycle.create).not.toHaveBeenCalled();
  });

  it('创建周期后修改来源模板版本的评级与表单内容，不影响已写入事务的周期快照', async () => {
    // 独立可变的来源对象：模拟运营在创建周期之后继续编辑同一份模板版本。
    const mutableSource = structuredClone(source);
    tx.perfConfigTemplateVersion.findUnique.mockResolvedValue(mutableSource);

    await service.createFromPublishedConfig('ou_hr', {
      name: '2026 上半年绩效评定',
      configTemplateVersionId: 30,
      plannedStartAt: '2026-07-14T09:00:00+08:00',
    });

    const snapshotData = tx.perfCycleConfigVersion.create.mock.calls[0][0].data;
    const capturedRatingScore = snapshotData.ratings[0].mappingScore;
    const capturedDimensionName =
      snapshotData.formSnapshots.create[0].content.subforms[0].dimensions[0]
        .name;

    // 创建周期之后再修改来源模板版本对象（评级与 D 表单维度名称）。
    mutableSource.ratings[0].mappingScore = '10';
    mutableSource.formBindings[0].formTemplateVersion.subforms[0].dimensions[0].name =
      '篡改后的维度';

    // 事务中已写入的快照数据必须仍等于创建时刻的值，证明是值复制而非共享引用。
    expect(snapshotData.ratings[0].mappingScore).toBe(capturedRatingScore);
    expect(snapshotData.ratings[0].mappingScore).toBe('95');
    expect(
      snapshotData.formSnapshots.create[0].content.subforms[0].dimensions[0]
        .name,
    ).toBe(capturedDimensionName);
    expect(
      snapshotData.formSnapshots.create[0].content.subforms[0].dimensions[0]
        .name,
    ).toBe('业绩');
  });

  it('迁移后的旧草稿可原子补齐基础信息、配置与 D/M 表单快照', async () => {
    tx.perfCycle.findFirst.mockResolvedValue({
      id: 9,
      status: 'DRAFT',
      currentConfigVersionId: null,
      currentConfigVersion: null,
      participants: [],
    });

    await service.initializeLegacyDraft('ou_hr', 9, {
      name: '迁移后的周期',
      configTemplateVersionId: 30,
      plannedStartAt: '2026-08-01T09:00:00+08:00',
    });

    expect(tx.perfCycleConfigVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cycleId: 9,
          sourceConfigTemplateVersionId: 30,
          formSnapshots: {
            create: expect.arrayContaining([
              expect.objectContaining({ jobLevelPrefix: 'D' }),
              expect.objectContaining({ jobLevelPrefix: 'M' }),
            ]),
          },
        }),
      }),
    );
    expect(tx.perfCycle.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: {
        name: '迁移后的周期',
        plannedStartAt: new Date('2026-08-01T01:00:00.000Z'),
        currentConfigVersionId: 19,
      },
    });
  });

  it('旧草稿初始化时会为已有参与人固化 CoreHR 职级与 D/M 表单绑定', async () => {
    tx.perfCycle.findFirst.mockResolvedValue({
      id: 9,
      status: 'DRAFT',
      currentConfigVersionId: null,
      currentConfigVersion: null,
      participants: [
        {
          id: 71,
          employeeOpenId: 'ou_d',
          leaderOpenIdSnapshot: null,
          departmentIdSnapshot: null,
          jobLevelSnapshot: null,
        },
      ],
    });
    tx.perfCycleConfigVersion.create.mockResolvedValue({
      id: 19,
      formSnapshots: [
        { id: 81, jobLevelPrefix: 'D' },
        { id: 82, jobLevelPrefix: 'M' },
      ],
    });
    tx.larkUser.findMany.mockResolvedValue([
      {
        open_id: 'ou_d',
        leader_user_id: 'ou_leader_fallback',
        department_ids: ['od_fallback'],
      },
    ]);
    tx.larkCorehrEmployee.findMany.mockResolvedValue([
      {
        open_id: 'ou_d',
        direct_manager_id: 'ou_leader',
        department_id: 'od_corehr',
        job_level: { code: 'D5', name: [{ value: '资深工程师' }] },
      },
    ]);

    await service.initializeLegacyDraft('ou_hr', 9, {
      name: '迁移后的周期',
      configTemplateVersionId: 30,
      plannedStartAt: '2026-08-01T09:00:00+08:00',
    });

    expect(tx.perfParticipant.update).toHaveBeenCalledWith({
      where: { id: 71 },
      data: expect.objectContaining({
        leaderOpenIdSnapshot: 'ou_leader',
        departmentIdSnapshot: 'od_corehr',
        jobLevelSnapshot: { code: 'D5', name: [{ value: '资深工程师' }] },
        jobLevelPrefixSnapshot: 'D',
        formSnapshotId: 81,
      }),
    });
  });

  it('设为待启动只更新周期状态，不生成任务或通知', async () => {
    tx.perfCycle.findFirst.mockResolvedValue({
      id: 9,
      status: 'DRAFT',
      currentConfigVersionId: 19,
      plannedStartAt: new Date('2026-07-14T01:00:00.000Z'),
      currentConfigVersion: { formSnapshots: [] },
      participants: [],
    });
    jest
      .spyOn(service, 'startCheck')
      .mockResolvedValue({ items: [], ok: true });

    const result = await service.schedule('ou_hr', 9);

    expect(tx.perfCycle.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { status: 'SCHEDULED' },
    });
    expect(result.changed).toBe(true);
    expect(tx).not.toHaveProperty('perfTask');
    expect(tx).not.toHaveProperty('perfNotification');
  });

  it('启动检查会复用发布校验并报告空评级与空表单内容', async () => {
    const formSnapshots = [
      {
        id: 81,
        jobLevelPrefix: 'D',
        sourceFormTemplateVersionId: 101,
        content: { schemaVersion: 1, name: 'D 表单', subforms: [] },
      },
      {
        id: 82,
        jobLevelPrefix: 'M',
        sourceFormTemplateVersionId: 102,
        content: { schemaVersion: 1, name: 'M 表单', subforms: [] },
      },
    ];
    prisma.perfCycle.findFirst.mockResolvedValue({
      id: 9,
      status: 'DRAFT',
      plannedStartAt: new Date('2026-07-14T01:00:00.000Z'),
      currentConfigVersion: {
        id: 19,
        cycleId: 9,
        selfStageMode: 'DIRECT_RATING',
        peerStageMode: 'WEIGHTED_RATING',
        managerStageMode: 'WEIGHTED_SCORE',
        aiStageMode: 'DIRECT_RATING',
        ratings: [],
        constraintProfiles: { WEIGHTED_RATING: [], WEIGHTED_SCORE: [] },
        orgOwnerWeight: 30,
        projectOwnerWeight: 30,
        peerWeight: 25,
        crossDeptWeight: 15,
        schedulePreset: source.schedulePreset,
        notificationRules: source.notificationRules,
        formSnapshots,
      },
      participants: [
        {
          id: 1,
          employeeOpenId: 'ou_1',
          jobLevelSnapshot: { code: 'D3' },
        },
      ],
    });

    const check = await service.startCheck(9);

    expect(check.ok).toBe(false);
    expect(
      check.items
        .find((item) => item.key === 'config_snapshot')
        ?.issues.map((issue) => issue.code),
    ).toEqual(
      expect.arrayContaining([
        'RATING_SCALE_INVALID',
        'BOUND_SUBFORM_REQUIRED',
      ]),
    );
  });
});
