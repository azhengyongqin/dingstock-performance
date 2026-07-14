import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import { PrismaService } from '../shared/database/prisma.service';
import { DEFAULT_FORM_TEMPLATES } from './default-form-templates';
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

describe('FormTemplateService', () => {
  const draftDetail = {
    id: 20,
    templateId: 10,
    version: 1,
    status: 'DRAFT',
    name: '普通岗评估表单',
    description: '适用于 D 职级',
    jobLevelPrefix: 'D',
    subforms: [
      { type: 'SELF', title: '员工自评', sortOrder: 0, dimensions: [] },
      { type: 'PEER', title: '360°评估', sortOrder: 1, dimensions: [] },
      { type: 'MANAGER', title: '上级评估', sortOrder: 2, dimensions: [] },
      { type: 'PROMOTION', title: '晋升评估', sortOrder: 3, dimensions: [] },
    ],
  };
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
      createMany: jest.fn().mockResolvedValue({ count: 4 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 4 }),
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
    prismaMock.perfFormTemplateVersion.findUnique.mockResolvedValue(
      draftDetail,
    );
    txMock.perfFormTemplateVersion.findUnique.mockResolvedValue(draftDetail);

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

  it('原子创建稳定模板、v1 草稿和四个固定子表单', async () => {
    const result = await service.createFormTemplate('admin-open-id', {
      name: '普通岗评估表单',
      description: '适用于 D 职级',
      jobLevelPrefix: 'D',
    });

    expect(result).toEqual(draftDetail);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(txMock.perfFormTemplateVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        templateId: 10,
        version: 1,
        status: 'DRAFT',
        name: '普通岗评估表单',
        jobLevelPrefix: 'D',
        createdByOpenId: 'admin-open-id',
      }),
    });
    expect(txMock.perfFormSubform.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ versionId: 20, type: 'SELF', sortOrder: 0 }),
        expect.objectContaining({ versionId: 20, type: 'PEER', sortOrder: 1 }),
        expect.objectContaining({
          versionId: 20,
          type: 'MANAGER',
          sortOrder: 2,
        }),
        expect.objectContaining({
          versionId: 20,
          type: 'PROMOTION',
          sortOrder: 3,
        }),
      ],
    });
    expect(auditMock.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorOpenId: 'admin-open-id',
        action: 'form_template.create',
        targetType: 'perf_form_template_version',
        targetId: '20',
      }),
    );
  });

  it('拒绝原地编辑已发布版本', async () => {
    prismaMock.perfFormTemplateVersion.findUnique.mockResolvedValueOnce({
      ...draftDetail,
      status: 'PUBLISHED',
    });

    await expect(
      service.replaceDraftContent('admin-open-id', 20, {
        name: '不能直接修改',
        description: null,
        jobLevelPrefix: 'D',
        subforms: [],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('在单个事务内整体覆盖草稿层级并记录审计', async () => {
    const input = {
      name: '普通岗评估表单 v1',
      description: '完整草稿',
      jobLevelPrefix: 'D' as const,
      subforms: [
        {
          type: 'SELF' as const,
          title: '员工自评',
          sortOrder: 0,
          dimensions: [
            {
              kind: 'REGULAR' as const,
              audience: 'EMPLOYEE' as const,
              name: '自评等级',
              weight: null,
              isCore: false,
              sortOrder: 0,
              items: [
                {
                  type: 'RATING' as const,
                  title: '请选择自评等级',
                  required: true,
                  sortOrder: 0,
                  config: null,
                },
              ],
            },
          ],
        },
      ],
    };

    const result = await service.replaceDraftContent(
      'admin-open-id',
      20,
      input,
    );

    expect(result).toEqual(draftDetail);
    expect(txMock.perfFormTemplateVersion.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: expect.objectContaining({
        name: input.name,
        description: input.description,
        jobLevelPrefix: 'D',
        updatedByOpenId: 'admin-open-id',
      }),
    });
    expect(txMock.perfFormSubform.deleteMany).toHaveBeenCalledWith({
      where: { versionId: 20 },
    });
    expect(txMock.perfFormSubform.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        versionId: 20,
        type: 'SELF',
        dimensions: {
          create: [
            expect.objectContaining({
              kind: 'REGULAR',
              audience: 'EMPLOYEE',
              items: {
                create: [expect.objectContaining({ type: 'RATING' })],
              },
            }),
          ],
        },
      }),
    });
    expect(auditMock.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'form_template.draft.update',
        targetId: '20',
        before: draftDetail,
        after: draftDetail,
      }),
    );
  });

  it('发布时一次返回全部完整性问题，且不写入状态', async () => {
    await expect(
      service.publishVersion('admin-open-id', 20),
    ).rejects.toMatchObject({
      response: {
        message: '评估表单模板发布校验失败',
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'DIMENSION_WEIGHT_TOTAL_INVALID' }),
          expect.objectContaining({ code: 'PROMOTION_ROLE_CONTENT_MISSING' }),
        ]),
      },
    });
    expect(txMock.perfFormTemplateVersion.update).not.toHaveBeenCalled();
  });

  it('完整草稿可以发布并记录发布人、时间与审计日志', async () => {
    const validDraft = {
      ...DEFAULT_FORM_TEMPLATES[0],
      id: 20,
      templateId: 10,
      status: 'DRAFT' as const,
    };
    const published = { ...validDraft, status: 'PUBLISHED' as const };
    txMock.perfFormTemplateVersion.findUnique
      .mockResolvedValueOnce(validDraft)
      .mockResolvedValueOnce(published);
    txMock.perfFormTemplateVersion.update.mockResolvedValue({ id: 20 });

    await expect(service.publishVersion('admin-open-id', 20)).resolves.toEqual(
      published,
    );
    expect(txMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(txMock.perfFormTemplateVersion.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: expect.objectContaining({
        status: 'PUBLISHED',
        publishedByOpenId: 'admin-open-id',
        publishedAt: expect.any(Date),
      }),
    });
    expect(auditMock.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'form_template.publish',
        targetId: '20',
        before: validDraft,
        after: published,
      }),
    );
  });

  it('从已发布版本深复制出递增版本号的新草稿', async () => {
    const source = {
      ...DEFAULT_FORM_TEMPLATES[0],
      id: 20,
      templateId: 10,
      status: 'PUBLISHED' as const,
    };
    const cloned = {
      ...source,
      id: 21,
      version: 2,
      status: 'DRAFT' as const,
      sourceVersionId: 20,
    };
    prismaMock.perfFormTemplateVersion.findUnique
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(cloned);
    txMock.perfFormTemplateVersion.create.mockResolvedValueOnce({ id: 21 });

    await expect(
      service.createDraftFromVersion('admin-open-id', 20),
    ).resolves.toEqual(cloned);
    expect(txMock.perfFormTemplateVersion.aggregate).toHaveBeenCalledWith({
      where: { templateId: 10 },
      _max: { version: true },
    });
    expect(txMock.perfFormTemplateVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        templateId: 10,
        version: 2,
        status: 'DRAFT',
        sourceVersionId: 20,
        subforms: {
          create: expect.arrayContaining([
            expect.objectContaining({
              type: 'SELF',
              dimensions: { create: expect.any(Array) },
            }),
          ]),
        },
      }),
    });
    expect(auditMock.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'form_template.draft.create_from_version',
        targetId: '21',
      }),
    );
  });

  it('只允许归档已发布版本并记录归档审计', async () => {
    const published = { ...draftDetail, status: 'PUBLISHED' as const };
    const archived = { ...published, status: 'ARCHIVED' as const };
    prismaMock.perfFormTemplateVersion.findUnique
      .mockResolvedValueOnce(published)
      .mockResolvedValueOnce(archived);
    prismaMock.perfFormTemplateVersion.update.mockResolvedValue({ id: 20 });

    await expect(service.archiveVersion('admin-open-id', 20)).resolves.toEqual(
      archived,
    );
    expect(prismaMock.perfFormTemplateVersion.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: expect.objectContaining({
        status: 'ARCHIVED',
        archivedByOpenId: 'admin-open-id',
        archivedAt: expect.any(Date),
      }),
    });
    expect(auditMock.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'form_template.archive' }),
    );
  });

  it('HR 列表只能查询已发布版本，Admin 可以查看全部状态', async () => {
    prismaMock.perfFormTemplateVersion.findMany.mockResolvedValue([]);
    rbacMock.isAdmin.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await service.listFormTemplates('hr-open-id');
    expect(
      prismaMock.perfFormTemplateVersion.findMany,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { status: 'PUBLISHED' } }),
    );

    await service.listFormTemplates('admin-open-id');
    expect(
      prismaMock.perfFormTemplateVersion.findMany,
    ).toHaveBeenLastCalledWith(expect.objectContaining({ where: {} }));
  });

  it('通过业务服务分析已发布候选版本的 D/M 前缀覆盖', async () => {
    prismaMock.perfFormTemplateVersion.findMany.mockResolvedValue([
      { id: 11, jobLevelPrefix: 'D' },
      { id: 12, jobLevelPrefix: 'M' },
    ]);

    await expect(
      service.analyzePublishedPrefixCoverage([11, 12]),
    ).resolves.toMatchObject({ complete: true, matches: { D: [11], M: [12] } });
    expect(prismaMock.perfFormTemplateVersion.findMany).toHaveBeenCalledWith({
      where: { id: { in: [11, 12] }, status: 'PUBLISHED' },
      select: { id: true, jobLevelPrefix: true },
    });
  });

  it('HR 不能读取草稿详情，Admin 可以读取版本历史', async () => {
    rbacMock.isAdmin.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(service.getVersion('hr-open-id', 20)).rejects.toThrow(
      '评估表单模板版本不存在或不可用',
    );
    await expect(service.getVersion('admin-open-id', 20)).resolves.toEqual(
      draftDetail,
    );
  });
});
