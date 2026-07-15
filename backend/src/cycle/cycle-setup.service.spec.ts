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

  describe('reapplyPublishedConfig 重新套用配置模板', () => {
    // 当前快照的日程预设/通知规则与来源模板的刻意构造为不同值，
    // 用来断言重套后写入新快照的是「沿用当前快照」而不是「复制来源模板」（PRD Out of Scope 排除时间窗/通知复制）。
    const currentSchedulePreset = {
      allowStageOverlap: true,
      stages: [
        {
          stage: 'SELF',
          startOffsetMinutes: 10,
          reminderDeadlineOffsetMinutes: 70,
        },
        {
          stage: 'PEER',
          startOffsetMinutes: 70,
          reminderDeadlineOffsetMinutes: 130,
        },
        {
          stage: 'MANAGER',
          startOffsetMinutes: 130,
          reminderDeadlineOffsetMinutes: 190,
        },
      ],
    };
    const currentNotificationRules = {
      stages: ['SELF', 'PEER', 'MANAGER'].map((stage) => ({
        stage,
        taskOpened: {
          enabled: true,
          recipient: 'ASSIGNEE',
          ccLeader: true,
          ccHr: false,
        },
        reminder: {
          enabled: false,
          recipient: 'ASSIGNEE',
          ccLeader: false,
          ccHr: false,
          frequency: { type: 'ONCE_AT_DEADLINE' },
        },
      })),
    };

    const reapplyCycleRow = (overrides: Record<string, unknown> = {}) => ({
      id: 9,
      status: 'DRAFT',
      plannedStartAt: new Date('2026-07-14T01:00:00.000Z'),
      currentConfigVersionId: 19,
      currentConfigVersion: {
        id: 19,
        version: 2,
        sourceConfigTemplateVersionId: 25,
        schedulePreset: currentSchedulePreset,
        notificationRules: currentNotificationRules,
        formSnapshots: [],
      },
      participants: [
        {
          id: 71,
          employeeOpenId: 'ou_d',
          leaderOpenIdSnapshot: 'ou_old_leader',
          departmentIdSnapshot: 'od_old',
          jobLevelSnapshot: { code: 'D5' },
        },
      ],
      ...overrides,
    });

    const finalSnapshotRow = {
      id: 9,
      status: 'DRAFT',
      currentConfigVersion: {
        id: 20,
        cycleId: 9,
        sourceConfigTemplateVersionId: 30,
        sourceConfigVersion: {
          id: 30,
          templateId: 3,
          name: '标准配置',
          version: 2,
        },
        version: 3,
        selfStageMode: 'DIRECT_RATING',
        peerStageMode: 'WEIGHTED_RATING',
        managerStageMode: 'WEIGHTED_SCORE',
        aiStageMode: 'DIRECT_RATING',
        ratings: source.ratings,
        constraintProfiles: source.constraintProfiles,
        orgOwnerWeight: 30,
        projectOwnerWeight: 30,
        peerWeight: 25,
        crossDeptWeight: 15,
        // 重套后新快照沿用当前快照的日程与通知规则，与来源模板值不同。
        schedulePreset: currentSchedulePreset,
        notificationRules: currentNotificationRules,
        createdAt: new Date('2026-07-14T02:00:00.000Z'),
        updatedAt: new Date('2026-07-14T02:00:00.000Z'),
        formSnapshots: [
          {
            id: 91,
            jobLevelPrefix: 'D',
            sourceFormTemplateVersionId: 100,
            content: {},
          },
          {
            id: 92,
            jobLevelPrefix: 'M',
            sourceFormTemplateVersionId: 101,
            content: {},
          },
        ],
      },
      participants: [],
    };

    beforeEach(() => {
      tx.perfCycleConfigVersion.create.mockResolvedValue({
        id: 20,
        version: 3,
        sourceConfigTemplateVersionId: 30,
        formSnapshots: [
          { id: 91, jobLevelPrefix: 'D' },
          { id: 92, jobLevelPrefix: 'M' },
        ],
      });
      prisma.perfCycle.findFirst.mockResolvedValue(finalSnapshotRow);
    });

    it('草稿周期重新套用配置模板：生成 version+1 新快照、覆盖复制来源版本内容、切换当前快照、重绑参与人并写一条审计', async () => {
      tx.perfCycle.findFirst.mockResolvedValue(reapplyCycleRow());

      const result = await service.reapplyPublishedConfig('ou_hr', 9, {
        configTemplateVersionId: 30,
      });

      const snapshotData =
        tx.perfCycleConfigVersion.create.mock.calls[0][0].data;
      expect(snapshotData).toMatchObject({
        cycleId: 9,
        version: 3,
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
        createdByOpenId: 'ou_hr',
      });
      // 日程预设与通知规则必须沿用「当前快照」的值，而不是被替换为来源模板的值——
      // PRD Out of Scope 明确排除时间窗/通知复制，重套不得静默重置 HR 在计划步骤的调整。
      expect(snapshotData.schedulePreset).toEqual(currentSchedulePreset);
      expect(snapshotData.notificationRules).toEqual(currentNotificationRules);
      expect(snapshotData.schedulePreset).not.toEqual(source.schedulePreset);
      expect(snapshotData.notificationRules).not.toEqual(
        source.notificationRules,
      );
      expect(snapshotData.formSnapshots.create).toHaveLength(2);
      expect(snapshotData.formSnapshots.create[0]).toMatchObject({
        jobLevelPrefix: 'D',
        sourceFormTemplateVersionId: 100,
      });

      // currentConfigVersionId 必须切换到新快照，旧版本不删除、不再引用。
      expect(tx.perfCycle.update).toHaveBeenCalledWith({
        where: { id: 9 },
        data: { currentConfigVersionId: 20 },
      });

      // 参与人按新快照的 D/M 表单重新匹配。
      expect(tx.perfParticipant.update).toHaveBeenCalledWith({
        where: { id: 71 },
        data: expect.objectContaining({
          jobLevelPrefixSnapshot: 'D',
          formSnapshotId: 91,
        }),
      });

      // 恰好一条审计，action 精确等于 legacy 的 cycle.template.apply，且体现整套覆盖范围。
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith({
        operatorOpenId: 'ou_hr',
        action: 'cycle.template.apply',
        targetType: 'perf_cycle',
        targetId: '9',
        before: { sourceConfigTemplateVersionId: 25, version: 2 },
        after: {
          sourceConfigTemplateVersionId: 30,
          version: 3,
          coverage: ['evaluation_rule', 'dimensions'],
        },
      });

      expect(result.version).toBe(3);
      expect(result.sourceConfigTemplateVersionId).toBe(30);
    });

    it('待启动（SCHEDULED）周期允许重新套用配置模板', async () => {
      tx.perfCycle.findFirst.mockResolvedValue(
        reapplyCycleRow({ status: 'SCHEDULED', participants: [] }),
      );

      await expect(
        service.reapplyPublishedConfig('ou_hr', 9, {
          configTemplateVersionId: 30,
        }),
      ).resolves.toBeDefined();
      expect(tx.perfCycleConfigVersion.create).toHaveBeenCalled();
    });

    it.each(['ACTIVE', 'ARCHIVED'])(
      '%s 状态周期拒绝重新套用配置模板，并给出业务可读中文错误',
      async (status) => {
        tx.perfCycle.findFirst.mockResolvedValue(
          reapplyCycleRow({ status, participants: [] }),
        );

        await expect(
          service.reapplyPublishedConfig('ou_hr', 9, {
            configTemplateVersionId: 30,
          }),
        ).rejects.toThrow('只有草稿或待启动周期允许重新套用配置模板');
        expect(tx.perfCycleConfigVersion.create).not.toHaveBeenCalled();
        expect(audit.record).not.toHaveBeenCalled();
      },
    );

    it.each(['DRAFT', 'ARCHIVED'])(
      '目标配置模板版本状态为 %s（未发布）时拒绝重新套用',
      async (templateStatus) => {
        tx.perfCycle.findFirst.mockResolvedValue(
          reapplyCycleRow({ participants: [] }),
        );
        tx.perfConfigTemplateVersion.findUnique.mockResolvedValue({
          ...structuredClone(source),
          status: templateStatus,
        });

        await expect(
          service.reapplyPublishedConfig('ou_hr', 9, {
            configTemplateVersionId: 30,
          }),
        ).rejects.toThrow('配置模板版本未发布或已不可用');
        expect(tx.perfCycleConfigVersion.create).not.toHaveBeenCalled();
        expect(audit.record).not.toHaveBeenCalled();
      },
    );

    it('周期尚无配置快照时拒绝重新套用，并提示先初始化', async () => {
      tx.perfCycle.findFirst.mockResolvedValue(
        reapplyCycleRow({
          currentConfigVersionId: null,
          currentConfigVersion: null,
          participants: [],
        }),
      );

      await expect(
        service.reapplyPublishedConfig('ou_hr', 9, {
          configTemplateVersionId: 30,
        }),
      ).rejects.toThrow('周期尚无配置快照，请先初始化配置快照');
      expect(tx.perfConfigTemplateVersion.findUnique).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('周期缺少计划启动时间时拒绝重新套用，给出业务可读错误', async () => {
      tx.perfCycle.findFirst.mockResolvedValue(
        reapplyCycleRow({ plannedStartAt: null, participants: [] }),
      );

      await expect(
        service.reapplyPublishedConfig('ou_hr', 9, {
          configTemplateVersionId: 30,
        }),
      ).rejects.toThrow('周期缺少计划启动时间，无法重新套用配置模板');
      expect(tx.perfCycleConfigVersion.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('getConfigSnapshot 暴露 manuallyModified', () => {
    const baseSnapshot = {
      id: 19,
      cycleId: 9,
      sourceConfigTemplateVersionId: 30,
      sourceConfigVersion: { id: 30, templateId: 3, name: '标准配置' },
      version: 1,
      selfStageMode: 'DIRECT_RATING',
      peerStageMode: 'WEIGHTED_RATING',
      managerStageMode: 'WEIGHTED_SCORE',
      aiStageMode: 'DIRECT_RATING',
      ratings: source.ratings,
      constraintProfiles: source.constraintProfiles,
      orgOwnerWeight: 30,
      projectOwnerWeight: 30,
      peerWeight: 25,
      crossDeptWeight: 15,
      schedulePreset: source.schedulePreset,
      notificationRules: source.notificationRules,
      formSnapshots: [],
    };

    it('createdAt 等于 updatedAt 时 manuallyModified 为 false（未手动改动过）', async () => {
      const stamp = new Date('2026-07-14T02:00:00.000Z');
      prisma.perfCycle.findFirst.mockResolvedValue({
        id: 9,
        status: 'DRAFT',
        currentConfigVersion: {
          ...baseSnapshot,
          createdAt: stamp,
          updatedAt: stamp,
        },
        participants: [],
      });

      const result = await service.getConfigSnapshot(9);

      expect(result.manuallyModified).toBe(false);
    });

    it('updatedAt 晚于 createdAt 时 manuallyModified 为 true（已手动改动过）', async () => {
      prisma.perfCycle.findFirst.mockResolvedValue({
        id: 9,
        status: 'DRAFT',
        currentConfigVersion: {
          ...baseSnapshot,
          createdAt: new Date('2026-07-14T02:00:00.000Z'),
          updatedAt: new Date('2026-07-14T03:00:00.000Z'),
        },
        participants: [],
      });

      const result = await service.getConfigSnapshot(9);

      expect(result.manuallyModified).toBe(true);
    });
  });
});
