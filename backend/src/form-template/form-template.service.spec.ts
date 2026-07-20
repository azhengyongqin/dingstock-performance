import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import { PrismaService } from '../shared/database/prisma.service';
import { FormTemplateService } from './form-template.service';

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
jest.mock('../audit/audit.service', () => ({ AuditService: class {} }));
jest.mock('../rbac/rbac.service', () => ({ RbacService: class {} }));

const emptyDraft = {
  id: 20,
  templateId: 10,
  version: 1,
  status: 'DRAFT',
  name: '普通岗评估表单',
  description: '适用于 D 职级',
  jobLevelPrefix: 'D',
  sourceVersionId: null,
  subforms: [
    { type: 'SELF', title: '员工自评', sortOrder: 0, dimensions: [] },
    { type: 'PEER', title: '360°评估', sortOrder: 1, dimensions: [] },
    { type: 'MANAGER', title: '上级评估', sortOrder: 2, dimensions: [] },
  ],
};

const rawScoringDimension = (
  businessKey: string,
  audience: 'EMPLOYEE' | 'REVIEWER' | 'LEADER',
  scoringMethod: 'RATING' | 'SCORE',
  name: string,
) => ({
  id: 100,
  businessKey,
  kind: 'REGULAR',
  scoringMethod,
  audience,
  name,
  description: null,
  weight: 100,
  isCore: true,
  sortOrder: 0,
  items: [
    {
      id: 200,
      businessKey: `compat-scoring:${businessKey}`,
      type: scoringMethod,
      title: `${name}评分`,
      description: null,
      placeholder: null,
      required: true,
      requiredRule: 'ALWAYS',
      requiredLevels: [],
      sortOrder: 0,
      config: null,
    },
  ],
});

const completeVersion = (status: 'DRAFT' | 'PUBLISHED' = 'DRAFT') => ({
  ...emptyDraft,
  status,
  subforms: [
    {
      type: 'SELF',
      title: '员工自评',
      sortOrder: 0,
      dimensions: [
        rawScoringDimension(
          'self-performance',
          'EMPLOYEE',
          'RATING',
          '绩效自评',
        ),
      ],
    },
    {
      type: 'PEER',
      title: '360°评估',
      sortOrder: 1,
      dimensions: [
        rawScoringDimension(
          'peer-performance',
          'REVIEWER',
          'RATING',
          '协作表现',
        ),
      ],
    },
    {
      type: 'MANAGER',
      title: '上级评估',
      sortOrder: 2,
      dimensions: [
        rawScoringDimension(
          'manager-performance',
          'LEADER',
          'SCORE',
          '核心业绩',
        ),
      ],
    },
  ],
});

const completeInput = () => ({
  name: '新版表单',
  description: '维度直接计分',
  jobLevelPrefix: 'D' as const,
  subforms: [
    {
      type: 'SELF' as const,
      title: '员工自评',
      sortOrder: 0,
      dimensions: [
        {
          type: 'SCORING' as const,
          scoringMethod: 'RATING' as const,
          audience: 'EMPLOYEE' as const,
          name: '绩效自评',
          weight: 100,
          isCore: true,
          sortOrder: 0,
          fields: [
            {
              type: 'LONG_TEXT' as const,
              title: '特殊等级说明',
              requiredRule: 'CONDITIONAL' as const,
              requiredLevels: ['S', 'C'] as ('S' | 'C')[],
              sortOrder: 0,
              config: null,
            },
          ],
        },
      ],
    },
    {
      type: 'PEER' as const,
      title: '360°评估',
      sortOrder: 1,
      dimensions: [
        {
          type: 'SCORING' as const,
          scoringMethod: 'RATING' as const,
          audience: 'REVIEWER' as const,
          name: '协作表现',
          weight: 100,
          isCore: true,
          sortOrder: 0,
          fields: [],
        },
      ],
    },
    {
      type: 'MANAGER' as const,
      title: '上级评估',
      sortOrder: 2,
      dimensions: [
        {
          type: 'SCORING' as const,
          scoringMethod: 'SCORE' as const,
          audience: 'LEADER' as const,
          name: '核心业绩',
          weight: 100,
          isCore: true,
          sortOrder: 0,
          fields: [],
        },
      ],
    },
  ],
});

describe('FormTemplateService', () => {
  const txMock = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 20 }]),
    perfFormTemplate: {
      create: jest.fn().mockResolvedValue({ id: 10 }),
    },
    perfFormTemplateVersion: {
      create: jest.fn().mockResolvedValue({ id: 20 }),
      update: jest.fn().mockResolvedValue({ id: 20 }),
      aggregate: jest.fn().mockResolvedValue({ _max: { version: 1 } }),
      findUnique: jest.fn(),
    },
    perfFormSubform: {
      createMany: jest.fn().mockResolvedValue({ count: 3 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
      create: jest.fn().mockResolvedValue({ id: 30 }),
    },
  };
  const prismaMock = {
    $transaction: jest.fn(),
    perfFormTemplateVersion: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };
  const auditMock = { record: jest.fn() };
  const rbacMock = { isAdmin: jest.fn() };

  let service: FormTemplateService;

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(
      (operation: (tx: typeof txMock) => unknown) => operation(txMock),
    );
    prismaMock.perfFormTemplateVersion.findUnique.mockResolvedValue(emptyDraft);
    txMock.perfFormTemplateVersion.findUnique.mockResolvedValue(emptyDraft);
    rbacMock.isAdmin.mockResolvedValue(true);

    const moduleRef = await Test.createTestingModule({
      providers: [
        FormTemplateService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditService, useValue: auditMock },
        { provide: RbacService, useValue: rbacMock },
      ],
    }).compile();
    service = moduleRef.get(FormTemplateService);
  });

  it('新建模板只创建三个绩效子表单', async () => {
    const result = await service.createFormTemplate('admin-open-id', {
      name: '普通岗评估表单',
      description: '适用于 D 职级',
      jobLevelPrefix: 'D',
    });

    expect(result.subforms.map((subform) => subform.type)).toEqual([
      'SELF',
      'PEER',
      'MANAGER',
    ]);
    expect(txMock.perfFormSubform.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ type: 'SELF', sortOrder: 0 }),
        expect.objectContaining({ type: 'PEER', sortOrder: 1 }),
        expect.objectContaining({ type: 'MANAGER', sortOrder: 2 }),
      ],
    });
  });

  it('保存新版草稿时生成稳定 key，并只在持久化兼容层创建隐藏计分项', async () => {
    await service.replaceDraftContent('admin-open-id', 20, completeInput());

    expect(txMock.perfFormSubform.deleteMany).toHaveBeenCalledWith({
      where: {
        versionId: 20,
        type: { in: ['SELF', 'PEER', 'MANAGER'] },
      },
    });
    const selfCreate = txMock.perfFormSubform.create.mock.calls[0][0].data;
    const dimension = selfCreate.dimensions.create[0];
    expect(dimension).toEqual(
      expect.objectContaining({
        businessKey: expect.any(String),
        kind: 'REGULAR',
        scoringMethod: 'RATING',
        weight: 100,
        isCore: true,
      }),
    );
    expect(dimension.items.create).toEqual([
      expect.objectContaining({
        businessKey: expect.stringMatching(/^compat-scoring:/),
        type: 'RATING',
        sortOrder: 0,
      }),
      expect.objectContaining({
        businessKey: expect.any(String),
        type: 'LONG_TEXT',
        requiredRule: 'CONDITIONAL',
        requiredLevels: ['S', 'C'],
        sortOrder: 1,
      }),
    ]);
  });

  it('编辑、改类型或移动时只允许沿用当前版本已有业务 key', async () => {
    const before: any = completeVersion();
    before.subforms[0].dimensions[0].items.push({
      id: 201,
      businessKey: 'self-comment',
      type: 'LONG_TEXT',
      title: '说明',
      description: null,
      placeholder: null,
      required: false,
      requiredRule: 'OPTIONAL',
      requiredLevels: [],
      sortOrder: 1,
      config: null,
    });
    prismaMock.perfFormTemplateVersion.findUnique.mockResolvedValueOnce(before);
    const input: any = completeInput();
    input.subforms[0].dimensions[0].key = 'self-performance';
    input.subforms[0].dimensions[0].fields[0].key = 'self-comment';
    input.subforms[0].dimensions[0].fields[0].type = 'MARKDOWN';

    await service.replaceDraftContent('admin-open-id', 20, input);

    const dimension =
      txMock.perfFormSubform.create.mock.calls[0][0].data.dimensions.create[0];
    expect(dimension.businessKey).toBe('self-performance');
    expect(dimension.items.create[1]).toEqual(
      expect.objectContaining({
        businessKey: 'self-comment',
        type: 'MARKDOWN',
      }),
    );

    input.subforms[0].dimensions[0].key = 'client-forged-key';
    await expect(
      service.replaceDraftContent('admin-open-id', 20, input),
    ).rejects.toThrow('评估维度业务标识不可由客户端创建或修改');
  });

  it('发布只校验三个绩效子表单并返回维度/字段契约', async () => {
    const draft = completeVersion('DRAFT');
    const published = completeVersion('PUBLISHED');
    txMock.perfFormTemplateVersion.findUnique
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(published);

    const result = await service.publishVersion('admin-open-id', 20);

    expect(result.status).toBe('PUBLISHED');
    expect(result.subforms[0].dimensions[0]).toEqual(
      expect.objectContaining({
        key: 'self-performance',
        type: 'SCORING',
        scoringMethod: 'RATING',
        fields: [],
      }),
    );
    expect(result.subforms[0].dimensions[0]).not.toHaveProperty('items');
    expect(txMock.perfFormTemplateVersion.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: expect.objectContaining({
        status: 'PUBLISHED',
        publishedByOpenId: 'admin-open-id',
      }),
    });
  });

  it('从已发布版本复制草稿时继承维度 key，并原样保留旧晋升表单', async () => {
    const source: any = completeVersion('PUBLISHED');
    source.subforms.push({
      type: 'PROMOTION',
      title: '晋升评估',
      sortOrder: 3,
      dimensions: [
        {
          id: 300,
          businessKey: 'legacy-promotion',
          kind: 'PROMOTION',
          scoringMethod: null,
          audience: 'EMPLOYEE',
          name: '晋升材料',
          description: null,
          weight: null,
          isCore: false,
          sortOrder: 0,
          items: [],
        },
      ],
    });
    prismaMock.perfFormTemplateVersion.findUnique
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(emptyDraft);

    await service.createDraftFromVersion('admin-open-id', 20);

    const create = txMock.perfFormTemplateVersion.create.mock.calls[0][0].data;
    expect(create.subforms.create[0].dimensions.create[0].businessKey).toBe(
      'self-performance',
    );
    expect(create.subforms.create.at(-1)).toEqual(
      expect.objectContaining({
        type: 'PROMOTION',
        dimensions: {
          create: [
            expect.objectContaining({ businessKey: 'legacy-promotion' }),
          ],
        },
      }),
    );
  });

  it('旧晋升表单只读响应完整保留说明、占位和字段配置', async () => {
    const source: any = completeVersion('PUBLISHED');
    source.subforms.push({
      type: 'PROMOTION',
      title: '晋升评估',
      description: '历史表单',
      sortOrder: 3,
      dimensions: [
        {
          businessKey: 'legacy-promotion',
          kind: 'PROMOTION',
          audience: 'LEADER',
          name: '晋升结论',
          description: '仅供历史查阅',
          weight: null,
          isCore: false,
          sortOrder: 0,
          items: [
            {
              businessKey: 'legacy-conclusion',
              type: 'SINGLE_SELECT',
              title: '结论',
              description: '请选择历史结论',
              placeholder: '请选择',
              required: true,
              sortOrder: 0,
              config: { options: [{ value: 'YES', label: '建议晋升' }] },
            },
          ],
        },
      ],
    });
    prismaMock.perfFormTemplateVersion.findUnique.mockResolvedValueOnce(source);

    const result = await service.getVersion('admin-open-id', 20);

    expect(result.legacyPromotionSubform.dimensions[0]).toEqual(
      expect.objectContaining({
        description: '仅供历史查阅',
        fields: [
          expect.objectContaining({
            description: '请选择历史结论',
            placeholder: '请选择',
            config: { options: [{ value: 'YES', label: '建议晋升' }] },
          }),
        ],
      }),
    );
  });

  it('拒绝原地编辑已发布版本', async () => {
    prismaMock.perfFormTemplateVersion.findUnique.mockResolvedValueOnce(
      completeVersion('PUBLISHED'),
    );
    await expect(
      service.replaceDraftContent('admin-open-id', 20, completeInput()),
    ).rejects.toThrow(BadRequestException);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
