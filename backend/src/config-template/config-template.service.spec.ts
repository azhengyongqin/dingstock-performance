import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { DEFAULT_FORM_TEMPLATES } from '../form-template/default-form-templates';
import { RbacService } from '../rbac/rbac.service';
import { PrismaService } from '../shared/database/prisma.service';
import { buildDefaultConfigTemplate } from './default-config-template';
import { ConfigTemplateService } from './config-template.service';

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

describe('ConfigTemplateService', () => {
  const formBindings = DEFAULT_FORM_TEMPLATES.map((template, index) => ({
    formTemplateVersionId: 101 + index,
    status: 'PUBLISHED' as const,
    jobLevelPrefix: template.jobLevelPrefix,
    subforms: template.subforms,
  }));
  const validContract = buildDefaultConfigTemplate(formBindings);
  validContract.schedulePreset.stages.forEach((row, index) => {
    row.startOffsetMinutes = index * 120;
    row.reminderDeadlineOffsetMinutes = index * 120 + 60;
  });

  const draftDetail = {
    id: 20,
    templateId: 10,
    version: 1,
    status: 'DRAFT',
    name: validContract.name,
    description: validContract.description,
    sourceVersionId: null,
    selfStageMode: validContract.stageModes.SELF,
    peerStageMode: validContract.stageModes.PEER,
    managerStageMode: validContract.stageModes.MANAGER,
    aiStageMode: validContract.stageModes.AI,
    ratings: validContract.ratings,
    constraintProfiles: validContract.constraintProfiles,
    orgOwnerWeight: validContract.reviewerRelationWeights.ORG_OWNER,
    projectOwnerWeight: validContract.reviewerRelationWeights.PROJECT_OWNER,
    peerWeight: validContract.reviewerRelationWeights.PEER,
    crossDeptWeight: validContract.reviewerRelationWeights.CROSS_DEPT,
    schedulePreset: validContract.schedulePreset,
    notificationRules: validContract.notificationRules,
    formBindings: formBindings.map((binding) => ({
      formTemplateVersionId: binding.formTemplateVersionId,
      jobLevelPrefix: binding.jobLevelPrefix,
      formTemplateVersion: {
        ...DEFAULT_FORM_TEMPLATES.find(
          (template) => template.jobLevelPrefix === binding.jobLevelPrefix,
        ),
        id: binding.formTemplateVersionId,
      },
    })),
  };

  const txMock = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 20 }]),
    perfConfigTemplate: {
      create: jest.fn().mockResolvedValue({ id: 10 }),
    },
    perfConfigTemplateVersion: {
      create: jest.fn().mockResolvedValue({ id: 20 }),
      update: jest.fn().mockResolvedValue({ id: 20 }),
      aggregate: jest.fn().mockResolvedValue({ _max: { version: 1 } }),
      findUnique: jest.fn(),
    },
    perfConfigFormBinding: {
      deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
  };
  const prismaMock = {
    $transaction: jest.fn(),
    perfConfigTemplateVersion: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    perfFormTemplateVersion: {
      findMany: jest.fn(),
    },
  };
  const auditMock = { record: jest.fn() };
  const rbacMock = { isAdmin: jest.fn() };

  let service: ConfigTemplateService;

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(
      (operation: (tx: typeof txMock) => unknown) => operation(txMock),
    );
    prismaMock.perfConfigTemplateVersion.findUnique.mockResolvedValue(
      draftDetail,
    );
    txMock.perfConfigTemplateVersion.findUnique.mockResolvedValue(draftDetail);
    prismaMock.perfFormTemplateVersion.findMany.mockResolvedValue(
      draftDetail.formBindings.map((binding) => binding.formTemplateVersion),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        ConfigTemplateService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditService, useValue: auditMock },
        { provide: RbacService, useValue: rbacMock },
      ],
    }).compile();
    service = moduleRef.get(ConfigTemplateService);
  });

  it('原子创建稳定配置模板和带受控默认值的 v1 草稿', async () => {
    const initialDefaults = buildDefaultConfigTemplate();
    prismaMock.perfConfigTemplateVersion.findUnique.mockResolvedValueOnce({
      ...draftDetail,
      name: '研发绩效配置',
      description: '研发岗位配置',
      schedulePreset: initialDefaults.schedulePreset,
      formBindings: [],
    });

    await expect(
      service.createConfigTemplate('admin-open-id', {
        name: '研发绩效配置',
        description: '研发岗位配置',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 20,
        stageModes: validContract.stageModes,
        reviewerRelationWeights: validContract.reviewerRelationWeights,
        formTemplateVersionIds: [],
        publicationIssues: expect.arrayContaining([
          expect.objectContaining({ code: 'FORM_BINDING_REQUIRED' }),
          expect.objectContaining({
            code: 'SCHEDULE_REMINDER_NOT_AFTER_START',
          }),
        ]),
        available: false,
      }),
    );

    expect(txMock.perfConfigTemplateVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        templateId: 10,
        version: 1,
        status: 'DRAFT',
        name: '研发绩效配置',
        peerStageMode: 'WEIGHTED_RATING',
        managerStageMode: 'WEIGHTED_SCORE',
        orgOwnerWeight: '30',
        createdByOpenId: 'admin-open-id',
      }),
    });
    expect(auditMock.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'config_template.create',
        targetId: '20',
      }),
    );
  });

  it('整体覆盖草稿内容，并按表单当前前缀重建精确绑定', async () => {
    await service.replaceDraftContent('admin-open-id', 20, {
      ...validContract,
      formTemplateVersionIds: [101, 102],
    });

    expect(txMock.perfConfigTemplateVersion.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: expect.objectContaining({
        peerStageMode: 'WEIGHTED_RATING',
        managerStageMode: 'WEIGHTED_SCORE',
        updatedByOpenId: 'admin-open-id',
      }),
    });
    expect(txMock.perfConfigFormBinding.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        {
          configVersionId: 20,
          formTemplateVersionId: 101,
          jobLevelPrefix: 'D',
        },
        {
          configVersionId: 20,
          formTemplateVersionId: 102,
          jobLevelPrefix: 'M',
        },
      ]),
    });
  });

  it('发布时持有版本行锁并一次返回全部问题', async () => {
    txMock.perfConfigTemplateVersion.findUnique.mockResolvedValueOnce({
      ...draftDetail,
      formBindings: [],
    });

    await expect(
      service.publishVersion('admin-open-id', 20),
    ).rejects.toMatchObject({
      response: {
        message: '配置模板发布校验失败',
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'FORM_BINDING_REQUIRED' }),
        ]),
      },
    });
    expect(txMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(txMock.perfConfigTemplateVersion.update).not.toHaveBeenCalled();
  });

  it('完整草稿可原子发布并记录审计', async () => {
    const published = { ...draftDetail, status: 'PUBLISHED' };
    txMock.perfConfigTemplateVersion.findUnique
      .mockResolvedValueOnce(draftDetail)
      .mockResolvedValueOnce(published);

    await expect(service.publishVersion('admin-open-id', 20)).resolves.toEqual(
      expect.objectContaining({ status: 'PUBLISHED' }),
    );
    expect(txMock.perfConfigTemplateVersion.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: expect.objectContaining({
        status: 'PUBLISHED',
        publishedByOpenId: 'admin-open-id',
        publishedAt: expect.any(Date),
      }),
    });
    expect(auditMock.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'config_template.publish' }),
    );
  });

  it('HR 只能列出已发布版本且不能读取草稿详情', async () => {
    prismaMock.perfConfigTemplateVersion.findMany.mockResolvedValue([]);
    rbacMock.isAdmin.mockResolvedValue(false);

    await service.listConfigTemplates('hr-open-id');
    expect(prismaMock.perfConfigTemplateVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'PUBLISHED' } }),
    );
    await expect(service.getVersion('hr-open-id', 20)).rejects.toThrow(
      '配置模板版本不存在或不可用',
    );
  });

  it('拒绝原地编辑已发布版本', async () => {
    txMock.perfConfigTemplateVersion.findUnique.mockResolvedValueOnce({
      ...draftDetail,
      status: 'PUBLISHED',
    });

    await expect(
      service.replaceDraftContent('admin-open-id', 20, {
        ...validContract,
        formTemplateVersionIds: [101, 102],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('内容已通过校验的草稿仍明确说明尚未发布', async () => {
    rbacMock.isAdmin.mockResolvedValue(true);

    await expect(service.getVersion('admin-open-id', 20)).resolves.toEqual(
      expect.objectContaining({
        publicationIssues: [],
        available: false,
        unavailableReasons: [
          expect.objectContaining({ code: 'CONFIG_VERSION_DRAFT' }),
        ],
      }),
    );
  });

  it('从已发布版本复制新草稿时锁定稳定模板，并跳过后来已归档的表单绑定', async () => {
    const source = {
      ...draftDetail,
      status: 'PUBLISHED',
      formBindings: draftDetail.formBindings.map((binding, index) => ({
        ...binding,
        formTemplateVersion: {
          ...binding.formTemplateVersion,
          status: index === 0 ? 'ARCHIVED' : 'PUBLISHED',
        },
      })),
    };
    txMock.perfConfigTemplateVersion.findUnique.mockResolvedValue(source);
    prismaMock.perfConfigTemplateVersion.findUnique.mockResolvedValueOnce({
      ...draftDetail,
      id: 30,
      version: 2,
    });
    txMock.perfConfigTemplateVersion.create.mockResolvedValueOnce({ id: 30 });

    await expect(
      service.createDraftFromVersion('admin-open-id', 20),
    ).resolves.toEqual(expect.objectContaining({ id: 30, version: 2 }));

    expect(txMock.$queryRaw).toHaveBeenCalledTimes(4);
    expect(txMock.perfConfigTemplateVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        version: 2,
        sourceVersionId: 20,
        formBindings: {
          create: [
            {
              formTemplateVersionId: 102,
              jobLevelPrefix: 'M',
            },
          ],
        },
      }),
    });
  });

  it('归档在版本行锁内原子判断，并返回明确不可用原因', async () => {
    txMock.perfConfigTemplateVersion.findUnique
      .mockResolvedValueOnce({ ...draftDetail, status: 'PUBLISHED' })
      .mockResolvedValueOnce({ ...draftDetail, status: 'ARCHIVED' });

    await expect(service.archiveVersion('admin-open-id', 20)).resolves.toEqual(
      expect.objectContaining({
        status: 'ARCHIVED',
        available: false,
        unavailableReasons: expect.arrayContaining([
          expect.objectContaining({ code: 'CONFIG_VERSION_ARCHIVED' }),
        ]),
      }),
    );
    expect(txMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(txMock.perfConfigTemplateVersion.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: expect.objectContaining({
        status: 'ARCHIVED',
        archivedByOpenId: 'admin-open-id',
      }),
    });
  });

  it('已发布配置的绑定表单后来归档，仍可按数据库权威维度完成历史预览', async () => {
    let dimensionId = 1000;
    const formBindingsWithIds = draftDetail.formBindings.map(
      (binding, bindingIndex) => ({
        ...binding,
        formTemplateVersion: {
          ...binding.formTemplateVersion,
          status: bindingIndex === 0 ? 'ARCHIVED' : 'PUBLISHED',
          subforms: (binding.formTemplateVersion.subforms ?? []).map(
            (subform) => ({
              ...subform,
              dimensions: subform.dimensions.map((dimension) => ({
                ...dimension,
                id: dimensionId++,
              })),
            }),
          ),
        },
      }),
    );
    const published = {
      ...draftDetail,
      status: 'PUBLISHED',
      formBindings: formBindingsWithIds,
    };
    prismaMock.perfConfigTemplateVersion.findUnique.mockResolvedValueOnce(
      published,
    );
    rbacMock.isAdmin.mockResolvedValue(false);
    const peerDimensions = formBindingsWithIds[0].formTemplateVersion.subforms
      .find((subform) => subform.type === 'PEER')!
      .dimensions.filter((dimension) => dimension.type === 'SCORING');

    await expect(
      service.calculatePreview('hr-open-id', 20, {
        stage: 'PEER',
        jobLevelPrefix: 'D',
        dimensions: peerDimensions.map((dimension) => ({
          dimensionId: dimension.id,
          relations: [
            { type: 'ORG_OWNER', rawValues: ['B'] },
            { type: 'PROJECT_OWNER', rawValues: ['B'] },
            { type: 'PEER', rawValues: ['B'] },
            { type: 'CROSS_DEPT', rawValues: ['B'] },
          ],
        })),
      }),
    ).resolves.toEqual(expect.objectContaining({ status: 'READY' }));
  });

  it('预览拒绝重复或遗漏维度，不能通过重复权重凑满 100%', async () => {
    let dimensionId = 2000;
    const formBindingsWithIds = draftDetail.formBindings.map((binding) => ({
      ...binding,
      formTemplateVersion: {
        ...binding.formTemplateVersion,
        subforms: (binding.formTemplateVersion.subforms ?? []).map(
          (subform) => ({
            ...subform,
            dimensions: subform.dimensions.map((dimension) => ({
              ...dimension,
              id: dimensionId++,
            })),
          }),
        ),
      },
    }));
    prismaMock.perfConfigTemplateVersion.findUnique.mockResolvedValueOnce({
      ...draftDetail,
      formBindings: formBindingsWithIds,
    });
    rbacMock.isAdmin.mockResolvedValue(true);
    const firstPeerDimension =
      formBindingsWithIds[0].formTemplateVersion.subforms.find(
        (subform) => subform.type === 'PEER',
      )!.dimensions[0];

    await expect(
      service.calculatePreview('admin-open-id', 20, {
        stage: 'PEER',
        jobLevelPrefix: 'D',
        dimensions: [firstPeerDimension, firstPeerDimension].map(
          (dimension) => ({
            dimensionId: dimension.id,
            relations: [{ type: 'PEER', rawValues: ['B'] }],
          }),
        ),
      }),
    ).resolves.toEqual({
      status: 'UNAVAILABLE',
      issues: [
        expect.objectContaining({ code: 'PREVIEW_DIMENSION_SET_MISMATCH' }),
      ],
    });
  });
});
