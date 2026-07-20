import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import { RbacService } from '../rbac/rbac.service';
import { PrismaService } from '../shared/database/prisma.service';
import type {
  FormFieldConfig,
  FormFieldRequiredRule,
  FormFieldType,
  FormRatingLevel,
  FormScoringMethod,
  FormTemplateSubformContract,
  FormTemplateVersionContract,
} from './form-template.contract';
import { analyzeFormTemplatePrefixCoverage } from './prefix-coverage';
import { validateFormTemplatePublication } from './publication-validator';
import {
  toPerformanceSubformContracts,
  toPerformanceSubformCreateData,
} from './form-template.persistence';

export type CreateFormTemplateInput = {
  name: string;
  description?: string | null;
  jobLevelPrefix: 'D' | 'M';
};

export type FormTemplateFieldInput = {
  key?: string;
  type: FormFieldType;
  title: string;
  description?: string | null;
  placeholder?: string | null;
  requiredRule: FormFieldRequiredRule;
  requiredLevels: FormRatingLevel[];
  sortOrder: number;
  config?: FormFieldConfig | null;
};

export type FormTemplateDimensionInput = {
  key?: string;
  type: 'SCORING' | 'NON_SCORING';
  scoringMethod?: FormScoringMethod | null;
  audience: 'EMPLOYEE' | 'REVIEWER' | 'LEADER';
  name: string;
  description?: string | null;
  weight?: number | string | null;
  isCore: boolean;
  sortOrder: number;
  fields: FormTemplateFieldInput[];
};

export type FormTemplateSubformInput = {
  type: 'SELF' | 'PEER' | 'MANAGER';
  title: string;
  description?: string | null;
  sortOrder: number;
  dimensions: FormTemplateDimensionInput[];
};

export type ReplaceDraftContentInput = Omit<
  CreateFormTemplateInput,
  'description'
> & {
  description?: string | null;
  subforms: FormTemplateSubformInput[];
};

const PERFORMANCE_SUBFORM_TYPES = ['SELF', 'PEER', 'MANAGER'] as const;
const INITIAL_SUBFORMS = [
  { type: 'SELF', title: '员工自评', sortOrder: 0 },
  { type: 'PEER', title: '360°评估', sortOrder: 1 },
  { type: 'MANAGER', title: '上级评估', sortOrder: 2 },
] as const;
const SCORING_ITEM_TYPES = new Set(['RATING', 'SCORE']);

type BusinessKeySet = {
  dimensions: Set<string>;
  fields: Set<string>;
};

/**
 * 版本化绩效表单模板应用服务。
 *
 * 当前处于 expand 阶段：对外只暴露“维度 + 表单字段”，对内暂时写入隐藏计分项，
 * 让尚未迁移的周期快照与填写链路继续运行；最终 contract 票会删除该兼容写入。
 */
@Injectable()
export class FormTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly rbacService: RbacService,
  ) {}

  async listFormTemplates(operatorOpenId: string) {
    const isAdmin = await this.rbacService.isAdmin(operatorOpenId);
    const versions = await this.prisma.perfFormTemplateVersion.findMany({
      where: isAdmin ? {} : { status: 'PUBLISHED' },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: {
        template: { select: { systemKey: true } },
        _count: { select: { subforms: true } },
      },
    });
    return {
      items: versions.map(({ template, _count, ...version }) => ({
        ...version,
        systemKey: template.systemKey,
        // 旧版本可能额外保留晋升内容，绩效表单固定按三个子表单展示。
        subformCount: Math.min(_count.subforms, 3),
      })),
      total: versions.length,
    };
  }

  async listTemplateVersions(operatorOpenId: string, templateId: number) {
    const isAdmin = await this.rbacService.isAdmin(operatorOpenId);
    const versions = await this.prisma.perfFormTemplateVersion.findMany({
      where: {
        templateId,
        ...(isAdmin ? {} : { status: 'PUBLISHED' as const }),
      },
      orderBy: { version: 'desc' },
      include: {
        template: { select: { systemKey: true } },
        _count: { select: { subforms: true } },
      },
    });
    return {
      items: versions.map(({ template, _count, ...version }) => ({
        ...version,
        systemKey: template.systemKey,
        subformCount: Math.min(_count.subforms, 3),
      })),
      total: versions.length,
    };
  }

  async analyzePublishedPrefixCoverage(versionIds: number[]) {
    const candidates = await this.prisma.perfFormTemplateVersion.findMany({
      where: { id: { in: versionIds }, status: 'PUBLISHED' },
      select: { id: true, jobLevelPrefix: true },
    });
    return analyzeFormTemplatePrefixCoverage(candidates);
  }

  async getVersion(operatorOpenId: string, id: number) {
    const [isAdmin, version] = await Promise.all([
      this.rbacService.isAdmin(operatorOpenId),
      this.findVersionOrThrow(id),
    ]);
    if (!isAdmin && version.status !== 'PUBLISHED') {
      throw new NotFoundException('评估表单模板版本不存在或不可用');
    }
    return this.toVersionResponse(version);
  }

  async createFormTemplate(
    operatorOpenId: string,
    input: CreateFormTemplateInput,
  ) {
    const versionId = await this.prisma.$transaction(async (tx) => {
      const template = await tx.perfFormTemplate.create({
        data: { createdByOpenId: operatorOpenId },
      });
      const version = await tx.perfFormTemplateVersion.create({
        data: {
          templateId: template.id,
          version: 1,
          status: 'DRAFT',
          name: input.name,
          description: input.description,
          jobLevelPrefix: input.jobLevelPrefix,
          createdByOpenId: operatorOpenId,
          updatedByOpenId: operatorOpenId,
        },
      });

      // 新绩效模板固定三类人工评估；晋升不再随模板新建。
      await tx.perfFormSubform.createMany({
        data: INITIAL_SUBFORMS.map((subform) => ({
          versionId: version.id,
          ...subform,
        })),
      });
      return version.id;
    });

    const result = this.toVersionResponse(
      await this.findVersionOrThrow(versionId),
    );
    await this.auditService.record({
      operatorOpenId,
      action: 'form_template.create',
      targetType: 'perf_form_template_version',
      targetId: String(versionId),
      after: result,
    });
    return result;
  }

  async replaceDraftContent(
    operatorOpenId: string,
    id: number,
    input: ReplaceDraftContentInput,
  ) {
    const beforeRecord = await this.findVersionOrThrow(id);
    if (beforeRecord.status !== 'DRAFT') {
      throw new BadRequestException('只有草稿版本允许编辑');
    }
    const keyedSubforms = this.materializeBusinessKeys(
      input.subforms,
      this.collectBusinessKeys(beforeRecord),
    );
    const before = this.toVersionResponse(beforeRecord);

    await this.prisma.$transaction(async (tx) => {
      await tx.perfFormTemplateVersion.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          jobLevelPrefix: input.jobLevelPrefix,
          updatedByOpenId: operatorOpenId,
        },
      });

      // 只覆盖三个绩效子表单；旧晋升子表单留在原版本中只读保存。
      await tx.perfFormSubform.deleteMany({
        where: { versionId: id, type: { in: [...PERFORMANCE_SUBFORM_TYPES] } },
      });
      for (const subform of this.toSubformCreateData(keyedSubforms)) {
        await tx.perfFormSubform.create({
          data: { versionId: id, ...subform },
        });
      }
    });

    const result = this.toVersionResponse(await this.findVersionOrThrow(id));
    await this.auditService.record({
      operatorOpenId,
      action: 'form_template.draft.update',
      targetType: 'perf_form_template_version',
      targetId: String(id),
      before,
      after: result,
    });
    return result;
  }

  async publishVersion(operatorOpenId: string, id: number) {
    const { before, result } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "performance"."perf_form_template_versions" WHERE "id" = ${id} FOR UPDATE`;
      const lockedDraft = await this.findVersionOrThrow(id, tx);
      if (lockedDraft.status !== 'DRAFT') {
        throw new BadRequestException('只有草稿版本允许发布');
      }

      const contract = this.toPublicationContract(lockedDraft);
      const issues = validateFormTemplatePublication(contract);
      if (issues.length > 0) {
        throw new BadRequestException({
          message: '评估表单模板发布校验失败',
          issues,
        });
      }

      await tx.perfFormTemplateVersion.update({
        where: { id },
        data: {
          status: 'PUBLISHED',
          publishedByOpenId: operatorOpenId,
          publishedAt: new Date(),
          updatedByOpenId: operatorOpenId,
        },
      });
      return {
        before: this.toVersionResponse(lockedDraft),
        result: this.toVersionResponse(await this.findVersionOrThrow(id, tx)),
      };
    });

    await this.auditService.record({
      operatorOpenId,
      action: 'form_template.publish',
      targetType: 'perf_form_template_version',
      targetId: String(id),
      before,
      after: result,
    });
    return result;
  }

  async createDraftFromVersion(
    operatorOpenId: string,
    sourceVersionId: number,
  ) {
    const source = await this.findVersionOrThrow(sourceVersionId);
    if (source.status !== 'PUBLISHED') {
      throw new BadRequestException('只能从已发布版本创建新草稿');
    }

    const newVersionId = await this.prisma.$transaction(async (tx) => {
      const versionAggregate = await tx.perfFormTemplateVersion.aggregate({
        where: { templateId: source.templateId },
        _max: { version: true },
      });
      const performanceSubforms = this.toPublicationContract(source).subforms;
      const legacyPromotion = source.subforms.find(
        (subform) => subform.type === 'PROMOTION',
      );
      const version = await tx.perfFormTemplateVersion.create({
        data: {
          templateId: source.templateId,
          version: (versionAggregate._max.version ?? 0) + 1,
          status: 'DRAFT',
          name: source.name,
          description: source.description,
          jobLevelPrefix: source.jobLevelPrefix,
          sourceVersionId: source.id,
          createdByOpenId: operatorOpenId,
          updatedByOpenId: operatorOpenId,
          subforms: {
            create: [
              ...this.toSubformCreateData(performanceSubforms),
              ...(legacyPromotion
                ? [this.toLegacyPromotionCreateData(legacyPromotion)]
                : []),
            ],
          },
        },
      });
      return version.id;
    });

    const result = this.toVersionResponse(
      await this.findVersionOrThrow(newVersionId),
    );
    await this.auditService.record({
      operatorOpenId,
      action: 'form_template.draft.create_from_version',
      targetType: 'perf_form_template_version',
      targetId: String(newVersionId),
      before: this.toVersionResponse(source),
      after: result,
    });
    return result;
  }

  async archiveVersion(operatorOpenId: string, id: number) {
    const beforeRecord = await this.findVersionOrThrow(id);
    if (beforeRecord.status !== 'PUBLISHED') {
      throw new BadRequestException('只有已发布版本允许归档');
    }
    const before = this.toVersionResponse(beforeRecord);
    await this.prisma.perfFormTemplateVersion.update({
      where: { id },
      data: {
        status: 'ARCHIVED',
        archivedByOpenId: operatorOpenId,
        archivedAt: new Date(),
        updatedByOpenId: operatorOpenId,
      },
    });
    const result = this.toVersionResponse(await this.findVersionOrThrow(id));
    await this.auditService.record({
      operatorOpenId,
      action: 'form_template.archive',
      targetType: 'perf_form_template_version',
      targetId: String(id),
      before,
      after: result,
    });
    return result;
  }

  private materializeBusinessKeys(
    subforms: readonly FormTemplateSubformInput[],
    allowed?: BusinessKeySet,
  ): FormTemplateSubformContract[] {
    const usedDimensions = new Set<string>();
    const usedFields = new Set<string>();
    return subforms.map((subform) => ({
      ...subform,
      dimensions: subform.dimensions.map((dimension) => {
        const key = this.materializeKey(
          dimension.key,
          allowed?.dimensions,
          usedDimensions,
          '评估维度',
        );
        return {
          ...dimension,
          key,
          scoringMethod:
            dimension.type === 'SCORING'
              ? (dimension.scoringMethod ?? null)
              : null,
          weight: dimension.type === 'SCORING' ? dimension.weight : null,
          isCore: dimension.type === 'SCORING' && dimension.isCore,
          fields: dimension.fields.map((field) => ({
            ...field,
            key: this.materializeKey(
              field.key,
              allowed?.fields,
              usedFields,
              '表单字段',
            ),
          })),
        };
      }),
    }));
  }

  private materializeKey(
    requested: string | undefined,
    allowed: Set<string> | undefined,
    used: Set<string>,
    label: string,
  ) {
    if (requested && allowed && !allowed.has(requested)) {
      throw new BadRequestException(`${label}业务标识不可由客户端创建或修改`);
    }
    const key = requested ?? randomUUID();
    if (used.has(key)) {
      throw new BadRequestException(`${label}业务标识不能重复`);
    }
    used.add(key);
    return key;
  }

  private collectBusinessKeys(
    version: Awaited<ReturnType<FormTemplateService['findVersionOrThrow']>>,
  ): BusinessKeySet {
    const dimensions = new Set<string>();
    const fields = new Set<string>();
    for (const subform of version.subforms) {
      if (!PERFORMANCE_SUBFORM_TYPES.includes(subform.type as never)) continue;
      for (const dimension of subform.dimensions) {
        dimensions.add(dimension.businessKey);
        for (const field of dimension.items) {
          if (!SCORING_ITEM_TYPES.has(field.type))
            fields.add(field.businessKey);
        }
      }
    }
    return { dimensions, fields };
  }

  /** Prisma nested-create 的唯一映射入口；隐藏计分项只在这里生成。 */
  private toSubformCreateData(
    subforms: readonly FormTemplateSubformContract[],
  ) {
    return toPerformanceSubformCreateData(subforms);
  }

  private toPublicationContract(
    version: Awaited<ReturnType<FormTemplateService['findVersionOrThrow']>>,
  ): FormTemplateVersionContract {
    return {
      name: version.name,
      description: version.description,
      jobLevelPrefix: version.jobLevelPrefix,
      subforms: toPerformanceSubformContracts(version.subforms),
    };
  }

  private toVersionResponse(
    version: Awaited<ReturnType<FormTemplateService['findVersionOrThrow']>>,
  ) {
    const contract = this.toPublicationContract(version);
    const legacyPromotion = version.subforms.find(
      (subform) => subform.type === 'PROMOTION',
    );
    return {
      ...version,
      subforms: contract.subforms,
      // 旧晋升内容单独只读返回，不参与绩效模板保存和发布。
      legacyPromotionSubform: legacyPromotion
        ? this.toLegacyPromotionResponse(legacyPromotion)
        : null,
    };
  }

  private toLegacyPromotionResponse(
    subform: Awaited<
      ReturnType<FormTemplateService['findVersionOrThrow']>
    >['subforms'][number],
  ) {
    return {
      title: subform.title,
      description: subform.description,
      dimensions: subform.dimensions.map((dimension) => ({
        key: dimension.businessKey,
        name: dimension.name,
        description: dimension.description,
        audience: dimension.audience,
        sortOrder: dimension.sortOrder,
        fields: dimension.items.map((field) => ({
          key: field.businessKey,
          title: field.title,
          type: field.type,
          description: field.description,
          placeholder: field.placeholder,
          required: field.required,
          sortOrder: field.sortOrder,
          config: field.config,
        })),
      })),
    };
  }

  private toLegacyPromotionCreateData(
    subform: Awaited<
      ReturnType<FormTemplateService['findVersionOrThrow']>
    >['subforms'][number],
  ) {
    return {
      type: 'PROMOTION' as const,
      title: subform.title,
      description: subform.description,
      sortOrder: subform.sortOrder,
      dimensions: {
        create: subform.dimensions.map((dimension) => ({
          businessKey: dimension.businessKey,
          kind: 'PROMOTION' as const,
          scoringMethod: null,
          audience: dimension.audience,
          name: dimension.name,
          description: dimension.description,
          weight: null,
          isCore: false,
          sortOrder: dimension.sortOrder,
          items: {
            create: dimension.items.map((field) => ({
              businessKey: field.businessKey,
              type: field.type,
              title: field.title,
              description: field.description,
              placeholder: field.placeholder,
              required: field.required,
              requiredRule: field.requiredRule,
              requiredLevels: field.requiredLevels,
              sortOrder: field.sortOrder,
              config: field.config
                ? (field.config as Prisma.InputJsonValue)
                : undefined,
            })),
          },
        })),
      },
    };
  }

  private async findVersionOrThrow(
    id: number,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const version = await client.perfFormTemplateVersion.findUnique({
      where: { id },
      include: {
        subforms: {
          orderBy: { sortOrder: 'asc' },
          include: {
            dimensions: {
              orderBy: [{ audience: 'asc' }, { sortOrder: 'asc' }],
              include: { items: { orderBy: { sortOrder: 'asc' } } },
            },
          },
        },
      },
    });
    if (!version) throw new NotFoundException('评估表单模板版本不存在');
    return version;
  }
}
