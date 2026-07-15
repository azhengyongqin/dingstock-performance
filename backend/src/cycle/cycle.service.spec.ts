import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import { PrismaService } from '../shared/database/prisma.service';
import { CycleService } from './cycle.service';

const TEST_RATINGS = [
  { symbol: 'C', name: '不符预期', minScore: 0, maxScore: 60 },
  { symbol: 'B', name: '良好', minScore: 60, maxScore: 80 },
  { symbol: 'A', name: '优秀', minScore: 80, maxScore: 90 },
  {
    symbol: 'S',
    name: '卓越',
    minScore: 90,
    maxScore: 100,
    maxInclusive: true,
  },
];

// 生成的 Prisma client 是 ESM 产物，单测中统一 mock，避免依赖真实数据库。
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
    PerfNotificationChannel: {
      BOT_DM: 'BOT_DM',
    },
    PerfParticipantStatus: {
      PENDING_SELF_REVIEW: 'PENDING_SELF_REVIEW',
      NO_RESULT: 'NO_RESULT',
      ARCHIVED: 'ARCHIVED',
    },
  }),
  { virtual: true },
);
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation((options: unknown) => options),
}));
jest.mock('../audit/audit.service', () => ({
  AuditService: class {},
}));

describe('CycleService', () => {
  const txMock = {
    perfCycle: {
      create: jest.fn(),
      update: jest.fn(),
    },
    perfTemplate: {
      findFirst: jest.fn(),
    },
    perfEvaluationRule: {
      create: jest.fn(),
      upsert: jest.fn(),
    },
    perfDimension: {
      create: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    perfParticipant: { updateMany: jest.fn() },
    perfResult: { updateMany: jest.fn() },
  };

  const prismaMock = {
    $transaction: jest.fn((callback: (tx: typeof txMock) => unknown) =>
      Promise.resolve(callback(txMock)),
    ),
    perfCycle: {
      findFirst: jest.fn(),
    },
    perfEvaluationRule: {
      findUnique: jest.fn(),
    },
    perfDimension: {
      findMany: jest.fn(),
    },
    perfSelfReview: { count: jest.fn().mockResolvedValue(0) },
    perfReview: { count: jest.fn().mockResolvedValue(0) },
    perfManagerReview: { count: jest.fn().mockResolvedValue(0) },
    perfCalibration: { count: jest.fn().mockResolvedValue(0) },
    perfResult: { count: jest.fn().mockResolvedValue(0) },
  };
  const auditMock = { record: jest.fn() };
  // 默认非 ADMIN；管理员场景各用例自行覆盖为 true
  const rbacMock = { isAdmin: jest.fn().mockResolvedValue(false) };

  let service: CycleService;

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(
      (callback: (tx: typeof txMock) => unknown) =>
        Promise.resolve(callback(txMock)),
    );
    rbacMock.isAdmin.mockResolvedValue(false);
    for (const model of [
      prismaMock.perfSelfReview,
      prismaMock.perfReview,
      prismaMock.perfManagerReview,
      prismaMock.perfCalibration,
      prismaMock.perfResult,
    ]) {
      model.count.mockResolvedValue(0);
    }

    const moduleRef = await Test.createTestingModule({
      providers: [
        CycleService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditService, useValue: auditMock },
        { provide: RbacService, useValue: rbacMock },
      ],
    }).compile();

    service = moduleRef.get(CycleService);
  });

  it('启动前重新套用配置模板会整体覆盖周期配置并记录业务审计', async () => {
    prismaMock.perfCycle.findFirst
      .mockResolvedValueOnce({
        id: 100,
        status: 'DRAFT',
        templateId: 1,
      })
      .mockResolvedValueOnce({
        id: 100,
        templateId: 10,
        evaluationRule: { levels: TEST_RATINGS },
        dimensions: [{ id: 200, name: '业绩' }],
        _count: { participants: 0 },
      });
    txMock.perfTemplate.findFirst.mockResolvedValue({
      id: 10,
      levels: TEST_RATINGS,
      commentRequiredRules: null,
      dimensions: [
        {
          id: 1,
          name: '业绩',
          type: 'REGULAR',
          scoringMethod: 'LEVEL',
          weight: 100,
          required: true,
          sortOrder: 0,
          visibleRoles: ['LEADER'],
          editableRoles: ['LEADER'],
          formSchema: null,
          applicableScope: null,
          conclusionOptions: null,
          employeeVisible: null,
        },
      ],
    });

    await service.applyTemplate('ou_hr', 100, { templateId: 10 });

    expect(txMock.perfEvaluationRule.upsert).toHaveBeenCalledWith({
      where: { cycleId: 100 },
      create: expect.objectContaining({
        cycleId: 100,
        levels: TEST_RATINGS,
      }),
      update: expect.objectContaining({ levels: TEST_RATINGS }),
    });
    expect(txMock.perfDimension.updateMany).toHaveBeenCalledWith({
      where: { cycleId: 100, deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    expect(txMock.perfDimension.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ cycleId: 100, name: '业绩' })],
    });
    expect(txMock.perfCycle.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { templateId: 10 },
    });
    expect(auditMock.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'cycle.template.apply',
        targetType: 'perf_cycle',
        targetId: '100',
        after: expect.objectContaining({
          templateId: 10,
          coverage: ['evaluation_rule', 'dimensions'],
        }),
      }),
    );
  });

  it('周期启动后拒绝重新套用配置模板', async () => {
    prismaMock.perfCycle.findFirst.mockResolvedValue({
      id: 100,
      status: 'ACTIVE',
    });

    await expect(
      service.applyTemplate('ou_hr', 100, { templateId: 10 }),
    ).rejects.toThrow(ConflictException);
  });

  it('ADMIN 可编辑进行中周期的评估维度（非破坏性新增无需确认）', async () => {
    rbacMock.isAdmin.mockResolvedValue(true);
    prismaMock.perfCycle.findFirst
      .mockResolvedValueOnce({ id: 100, status: 'ACTIVE' })
      .mockResolvedValueOnce({
        id: 100,
        dimensions: [{ id: 300, name: '新维度' }],
        _count: { participants: 3 },
      });
    prismaMock.perfDimension.findMany.mockResolvedValue([]);

    await service.upsertDimensions('ou_admin', 100, {
      items: [{ name: '新维度', type: 'REGULAR', scoringMethod: 'LEVEL' }],
    });

    expect(txMock.perfDimension.create).toHaveBeenCalled();
    // 无已产生数据统计被触发（非破坏性）
    expect(prismaMock.perfResult.count).not.toHaveBeenCalled();
    expect(auditMock.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'cycle.dimensions.upsert',
        reason: '管理员进行中编辑',
      }),
    );
  });

  it('ADMIN 进行中删除已产生数据的维度时要求二次确认', async () => {
    rbacMock.isAdmin.mockResolvedValue(true);
    prismaMock.perfCycle.findFirst.mockResolvedValue({
      id: 100,
      status: 'ACTIVE',
    });
    prismaMock.perfDimension.findMany.mockResolvedValue([
      {
        id: 1,
        name: '业绩',
        weight: 100,
        scoringMethod: 'LEVEL',
        type: 'REGULAR',
      },
    ]);
    prismaMock.perfReview.count.mockResolvedValue(8);

    await expect(
      service.upsertDimensions('ou_admin', 100, { items: [] }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DESTRUCTIVE_EDIT_REQUIRES_CONFIRM',
        impact: expect.objectContaining({
          changes: ['删除维度「业绩」'],
        }),
      }),
    });
    // 未确认不落库
    expect(txMock.perfDimension.updateMany).not.toHaveBeenCalled();
  });

  it('ADMIN 带 confirm 时执行进行中的破坏性维度删除', async () => {
    rbacMock.isAdmin.mockResolvedValue(true);
    prismaMock.perfCycle.findFirst
      .mockResolvedValueOnce({ id: 100, status: 'ACTIVE' })
      .mockResolvedValueOnce({
        id: 100,
        dimensions: [],
        _count: { participants: 3 },
      });
    prismaMock.perfDimension.findMany.mockResolvedValue([
      {
        id: 1,
        name: '业绩',
        weight: 100,
        scoringMethod: 'LEVEL',
        type: 'REGULAR',
      },
    ]);
    prismaMock.perfReview.count.mockResolvedValue(8);

    await service.upsertDimensions('ou_admin', 100, {
      items: [],
      confirm: true,
    });

    expect(txMock.perfDimension.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1] } },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('ADMIN 也不能编辑已归档周期', async () => {
    rbacMock.isAdmin.mockResolvedValue(true);
    prismaMock.perfCycle.findFirst.mockResolvedValue({
      id: 100,
      status: 'ARCHIVED',
    });

    await expect(
      service.updateCycle('ou_admin', 100, { name: '改名' }),
    ).rejects.toThrow(ConflictException);
  });

  it('通用状态推进不能绕过关闭检查直接进入 ARCHIVED', async () => {
    prismaMock.perfCycle.findFirst.mockResolvedValue({
      id: 100,
      status: 'ACTIVE',
    });

    await expect(
      service.advanceCycle('ou_admin', 100, { to: 'ARCHIVED' }),
    ).rejects.toThrow(ConflictException);
    expect(auditMock.record).not.toHaveBeenCalled();
  });

  it('新版周期调用旧配置写接口时明确拒绝，避免静默写入 legacy 字段', async () => {
    prismaMock.perfCycle.findFirst.mockResolvedValue({
      id: 100,
      status: 'DRAFT',
      currentConfigVersionId: 19,
    });

    await expect(
      service.updateNotificationRules('ou_hr', 100, { stages: [] }),
    ).rejects.toThrow(ConflictException);
    expect(txMock.perfCycle.update).not.toHaveBeenCalled();
  });
});
