import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../shared/database/prisma.service';
import { CycleService } from './cycle.service';

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
      PENDING: 'PENDING',
      SELF_REVIEW: 'SELF_REVIEW',
    },
    PerfNotificationChannel: {
      BOT_DM: 'BOT_DM',
    },
    PerfParticipantStatus: {
      PENDING_SELF_REVIEW: 'PENDING_SELF_REVIEW',
    },
  }),
  { virtual: true },
);
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation((options: unknown) => options),
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
    perfScoringRule: {
      create: jest.fn(),
      upsert: jest.fn(),
    },
    perfDimension: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const prismaMock = {
    $transaction: jest.fn((callback: (tx: typeof txMock) => unknown) =>
      Promise.resolve(callback(txMock)),
    ),
    perfCycle: {
      findFirst: jest.fn(),
    },
  };
  const auditMock = { record: jest.fn() };

  let service: CycleService;

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(
      (callback: (tx: typeof txMock) => unknown) =>
        Promise.resolve(callback(txMock)),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        CycleService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditService, useValue: auditMock },
      ],
    }).compile();

    service = moduleRef.get(CycleService);
  });

  it('使用不可用配置模板创建绩效周期时拒绝并返回业务原因', async () => {
    txMock.perfTemplate.findFirst.mockResolvedValue({
      id: 10,
      levels: [],
      distribution: null,
      commentRequiredRules: null,
      dimensions: [{ id: 1, weight: 100, applicableScope: null }],
    });

    await expect(
      service.createCycle('ou_hr', {
        name: '2026 H1 绩效评估',
        startDate: '2026-01-01',
        endDate: '2026-06-30',
        templateId: 10,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('使用可用配置模板创建绩效周期时复制评分规则与评估维度快照', async () => {
    txMock.perfCycle.create.mockResolvedValue({
      id: 100,
      name: '2026 H1 绩效评估',
      status: 'DRAFT',
    });
    txMock.perfTemplate.findFirst.mockResolvedValue({
      id: 10,
      levels: [{ level: 'A' }],
      distribution: [{ level: 'A', maxRatio: 0.3 }],
      commentRequiredRules: { lowest: true },
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
    prismaMock.perfCycle.findFirst.mockResolvedValue({
      id: 100,
      templateId: 10,
      scoringRule: { levels: [{ level: 'A' }] },
      dimensions: [{ id: 200, name: '业绩' }],
      _count: { participants: 0 },
    });

    const cycle = await service.createCycle('ou_hr', {
      name: '2026 H1 绩效评估',
      startDate: '2026-01-01',
      endDate: '2026-06-30',
      templateId: 10,
    });

    expect(txMock.perfScoringRule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cycleId: 100,
        levels: [{ level: 'A' }],
      }),
    });
    expect(txMock.perfDimension.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          cycleId: 100,
          name: '业绩',
          weight: 100,
        }),
      ],
    });
    expect(cycle.templateId).toBe(10);
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
        scoringRule: { levels: [{ level: 'A' }] },
        dimensions: [{ id: 200, name: '业绩' }],
        _count: { participants: 0 },
      });
    txMock.perfTemplate.findFirst.mockResolvedValue({
      id: 10,
      levels: [{ level: 'A' }],
      distribution: null,
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

    expect(txMock.perfScoringRule.upsert).toHaveBeenCalledWith({
      where: { cycleId: 100 },
      create: expect.objectContaining({
        cycleId: 100,
        levels: [{ level: 'A' }],
      }),
      update: expect.objectContaining({ levels: [{ level: 'A' }] }),
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
          coverage: ['scoring_rule', 'dimensions'],
        }),
      }),
    );
  });

  it('周期启动后拒绝重新套用配置模板', async () => {
    prismaMock.perfCycle.findFirst.mockResolvedValue({
      id: 100,
      status: 'SELF_REVIEW',
    });

    await expect(
      service.applyTemplate('ou_hr', 100, { templateId: 10 }),
    ).rejects.toThrow(ConflictException);
  });
});
