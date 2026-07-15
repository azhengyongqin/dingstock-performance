import { CycleController } from './cycle.controller';

jest.mock('../auth/jwt-auth.guard', () => ({ JwtAuthGuard: class {} }));
jest.mock('../rbac/roles.guard', () => ({ RolesGuard: class {} }));
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfRole: {
      HR: 'HR',
      ADMIN: 'ADMIN',
      EMPLOYEE: 'EMPLOYEE',
      REVIEWER: 'REVIEWER',
      LEADER: 'LEADER',
    },
    PerfCycleStatus: {
      DRAFT: 'DRAFT',
      SCHEDULED: 'SCHEDULED',
      ACTIVE: 'ACTIVE',
      ARCHIVED: 'ARCHIVED',
    },
    PerfDimensionType: {
      REGULAR: 'REGULAR',
      PROMOTION: 'PROMOTION',
      TEXT: 'TEXT',
      METRIC: 'METRIC',
    },
    PerfScoringMethod: {
      LEVEL: 'LEVEL',
      SCORE: 'SCORE',
      CONCLUSION: 'CONCLUSION',
      TEXT: 'TEXT',
    },
  }),
  { virtual: true },
);
jest.mock('./cycle.service', () => ({ CycleService: class {} }));
jest.mock('./cycle-setup.service', () => ({ CycleSetupService: class {} }));
jest.mock('./cycle-progress.service', () => ({
  CycleProgressService: class {},
}));
jest.mock('./active-cycle-rollback.service', () => ({
  ActiveCycleRollbackService: class {},
}));

describe('CycleController 四步创建 API', () => {
  const cycleService = {
    listCycles: jest.fn(),
    getCycle: jest.fn(),
  };
  const setupService = {
    createFromPublishedConfig: jest.fn(),
    initializeLegacyDraft: jest.fn(),
    getConfigSnapshot: jest.fn(),
    updateAdvancedConfig: jest.fn(),
    reapplyPublishedConfig: jest.fn(),
    getParticipantPrefixCheck: jest.fn(),
    getPlan: jest.fn(),
    updatePlan: jest.fn(),
    startCheck: jest.fn(),
    schedule: jest.fn(),
    returnToDraft: jest.fn(),
  };
  const progressService = { getProgress: jest.fn() };
  const rollbackService = { preview: jest.fn(), rollback: jest.fn() };
  const controller = new CycleController(
    cycleService as never,
    setupService as never,
    progressService as never,
    rollbackService as never,
  );
  const request = { user: { open_id: 'ou_hr' } } as never;

  beforeEach(() => jest.clearAllMocks());

  it('创建周期只转发配置版本与计划启动时间', async () => {
    const dto = {
      name: '2026 上半年绩效评定',
      configTemplateVersionId: 30,
      plannedStartAt: '2026-07-14T09:00:00+08:00',
    };
    setupService.createFromPublishedConfig.mockResolvedValue({ id: 9 });

    await controller.create(request, dto);

    expect(setupService.createFromPublishedConfig).toHaveBeenCalledWith(
      'ou_hr',
      dto,
    );
  });

  it('待启动与退回草稿均传递当前操作者且不调用旧启动服务', async () => {
    await controller.schedule(request, 9);
    await controller.returnToDraft(request, 9);

    expect(setupService.schedule).toHaveBeenCalledWith('ou_hr', 9);
    expect(setupService.returnToDraft).toHaveBeenCalledWith('ou_hr', 9);
    expect(cycleService).not.toHaveProperty('startCycle');
  });

  it('高级配置只更新周期快照并传递当前操作者', async () => {
    const dto = {
      stageModes: {},
      ratings: [],
      constraintProfiles: {},
      reviewerRelationWeights: {},
    } as never;

    await controller.updateConfigSnapshot(request, 9, dto);

    expect(setupService.updateAdvancedConfig).toHaveBeenCalledWith(
      'ou_hr',
      9,
      dto,
    );
  });

  it('重新套用配置模板接口只转发目标版本与当前操作者', async () => {
    const dto = { configTemplateVersionId: 30 };

    await controller.reapplyConfigSnapshot(request, 9, dto);

    expect(setupService.reapplyPublishedConfig).toHaveBeenCalledWith(
      'ou_hr',
      9,
      dto,
    );
  });

  it('周期进度接口只转发任务事实聚合查询', async () => {
    await controller.progress(9);
    expect(progressService.getProgress).toHaveBeenCalledWith(9);
  });

  it('整体退回预览与确认执行均传递超级管理员和影响修订', async () => {
    await controller.previewRollback(request, 9, {
      targetStatus: 'DRAFT' as never,
    });
    const dto = {
      targetStatus: 'DRAFT',
      impactRevision: 'a'.repeat(64),
      reason: '配置严重错误',
      confirmed: true,
    } as never;
    await controller.rollback(request, 9, dto);

    expect(rollbackService.preview).toHaveBeenCalledWith('ou_hr', 9, 'DRAFT');
    expect(rollbackService.rollback).toHaveBeenCalledWith('ou_hr', 9, dto);
  });

  it('旧草稿初始化接口原样转发配置选择与基础信息', async () => {
    const dto = {
      name: '迁移后的周期',
      configTemplateVersionId: 30,
      plannedStartAt: '2026-08-01T09:00:00+08:00',
    };

    await controller.initializeConfigSnapshot(request, 9, dto);

    expect(setupService.initializeLegacyDraft).toHaveBeenCalledWith(
      'ou_hr',
      9,
      dto,
    );
  });
});
