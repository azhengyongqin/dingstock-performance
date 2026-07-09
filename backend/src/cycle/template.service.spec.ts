import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../shared/database/prisma.service';
import { TemplateService } from './template.service';

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
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation((options: unknown) => options),
}));
jest.mock('../audit/audit.service', () => ({
  AuditService: class {},
}));

describe('TemplateService', () => {
  const prismaMock = {
    perfTemplate: {
      findMany: jest.fn(),
    },
  };
  const auditMock = { record: jest.fn() };

  let service: TemplateService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        TemplateService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditService, useValue: auditMock },
      ],
    }).compile();

    service = moduleRef.get(TemplateService);
  });

  it('模板列表标记是否可用于创建绩效周期，并返回不可用原因', async () => {
    prismaMock.perfTemplate.findMany.mockResolvedValue([
      {
        id: 1,
        name: '标准半年度评估模板',
        isDefault: true,
        levels: TEST_RATINGS,
        dimensions: [
          {
            id: 10,
            weight: 70,
            applicableScope: null,
          },
          {
            id: 11,
            weight: 30,
            applicableScope: null,
          },
        ],
        _count: { dimensions: 2, cycles: 0 },
      },
      {
        id: 2,
        name: '缺少评级',
        isDefault: false,
        levels: [],
        dimensions: [{ id: 20, weight: 100, applicableScope: null }],
        _count: { dimensions: 1, cycles: 0 },
      },
      {
        id: 3,
        name: '缺少评估维度',
        isDefault: false,
        levels: TEST_RATINGS,
        dimensions: [],
        _count: { dimensions: 0, cycles: 0 },
      },
      {
        id: 4,
        name: '权重不完整',
        isDefault: false,
        levels: TEST_RATINGS,
        dimensions: [{ id: 40, weight: 80, applicableScope: null }],
        _count: { dimensions: 1, cycles: 0 },
      },
    ]);

    const result = await service.listTemplates();

    expect(result.total).toBe(4);
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 1,
        canCreateCycle: true,
        unavailableReasons: [],
      }),
      expect.objectContaining({
        id: 2,
        canCreateCycle: false,
        unavailableReasons: ['缺少评级'],
      }),
      expect.objectContaining({
        id: 3,
        canCreateCycle: false,
        unavailableReasons: ['缺少评估维度', '缺少维度权重'],
      }),
      expect.objectContaining({
        id: 4,
        canCreateCycle: false,
        unavailableReasons: ['全员维度权重合计 80，需为 100'],
      }),
    ]);
  });

  it('晋升维度不参与权重完整性校验', async () => {
    prismaMock.perfTemplate.findMany.mockResolvedValue([
      {
        id: 5,
        name: '标准半年度评估模板',
        isDefault: true,
        levels: TEST_RATINGS,
        dimensions: [
          {
            id: 50,
            type: 'REGULAR',
            weight: 70,
            applicableScope: { jobCategory: 'D' },
          },
          {
            id: 51,
            type: 'REGULAR',
            weight: 30,
            applicableScope: { jobCategory: 'D' },
          },
          {
            id: 52,
            type: 'PROMOTION',
            weight: null,
            applicableScope: null,
          },
        ],
        _count: { dimensions: 3, cycles: 0 },
      },
    ]);

    const result = await service.listTemplates();

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        canCreateCycle: true,
        unavailableReasons: [],
      }),
    );
  });
});
