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
  FormItemConfig,
  FormTemplateVersionContract,
} from './form-template.contract';
import { analyzeFormTemplatePrefixCoverage } from './prefix-coverage';
import { validateFormTemplatePublication } from './publication-validator';

export type CreateFormTemplateInput = {
  name: string;
  description?: string | null;
  jobLevelPrefix: 'D' | 'M';
};

export type FormTemplateItemInput = {
  type:
    | 'RATING'
    | 'SCORE'
    | 'SHORT_TEXT'
    | 'LONG_TEXT'
    | 'MARKDOWN'
    | 'SINGLE_SELECT'
    | 'MULTI_SELECT'
    | 'ATTACHMENT'
    | 'LINK';
  title: string;
  description?: string | null;
  placeholder?: string | null;
  required: boolean;
  sortOrder: number;
  config?: FormItemConfig | null;
};

export type FormTemplateDimensionInput = {
  kind: 'REGULAR' | 'TEXT' | 'PROMOTION';
  audience: 'EMPLOYEE' | 'REVIEWER' | 'LEADER';
  name: string;
  description?: string | null;
  weight?: number | string | null;
  isCore: boolean;
  sortOrder: number;
  items: FormTemplateItemInput[];
};

export type FormTemplateSubformInput = {
  type: 'SELF' | 'PEER' | 'MANAGER' | 'PROMOTION';
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

const INITIAL_SUBFORMS = [
  { type: 'SELF', title: '员工自评', sortOrder: 0 },
  { type: 'PEER', title: '360°评估', sortOrder: 1 },
  { type: 'MANAGER', title: '上级评估', sortOrder: 2 },
  { type: 'PROMOTION', title: '晋升评估', sortOrder: 3 },
] as const;

/**
 * 版本化评估表单模板应用服务。
 *
 * 稳定模板与首个草稿必须在同一事务内创建，避免出现没有任何版本的孤立模板。
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
        subformCount: _count.subforms,
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
        subformCount: _count.subforms,
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
      // 对非管理员隐藏草稿和归档的存在性，避免泄露未发布模板内容。
      throw new NotFoundException('评估表单模板版本不存在或不可用');
    }
    return version;
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

      // 四类子表单是版本的固定骨架；草稿允许维度与评估项暂时为空。
      await tx.perfFormSubform.createMany({
        data: INITIAL_SUBFORMS.map((subform) => ({
          versionId: version.id,
          ...subform,
        })),
      });
      return version.id;
    });

    const result = await this.findVersionOrThrow(versionId);
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
    const before = await this.findVersionOrThrow(id);
    if (before.status !== 'DRAFT') {
      throw new BadRequestException('只有草稿版本允许编辑');
    }

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

      // 草稿采用整体覆盖语义，避免局部 patch 遗留孤立维度或评估项。
      await tx.perfFormSubform.deleteMany({ where: { versionId: id } });
      for (const subform of this.toSubformCreateData(input.subforms)) {
        await tx.perfFormSubform.create({
          data: {
            versionId: id,
            ...subform,
          },
        });
      }
    });

    const result = await this.findVersionOrThrow(id);
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
      // 与草稿整体覆盖争用同一版本行锁，确保“读取→校验→发布”之间内容不会变化。
      await tx.$queryRaw`SELECT "id" FROM "performance"."perf_form_template_versions" WHERE "id" = ${id} FOR UPDATE`;
      const lockedDraft = await this.findVersionOrThrow(id, tx);
      if (lockedDraft.status !== 'DRAFT') {
        throw new BadRequestException('只有草稿版本允许发布');
      }

      const issues = validateFormTemplatePublication(
        this.toPublicationContract(lockedDraft),
      );
      if (issues.length > 0) {
        // 一次返回全部问题，管理员无需逐项尝试发布才能发现下一处错误。
        throw new BadRequestException({
          message: '评估表单模板发布校验失败',
          issues,
        });
      }

      const now = new Date();
      await tx.perfFormTemplateVersion.update({
        where: { id },
        data: {
          status: 'PUBLISHED',
          publishedByOpenId: operatorOpenId,
          publishedAt: now,
          updatedByOpenId: operatorOpenId,
        },
      });
      return {
        before: lockedDraft,
        result: await this.findVersionOrThrow(id, tx),
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
            create: this.toSubformCreateData(
              this.toPublicationContract(source).subforms,
            ),
          },
        },
      });
      return version.id;
    });

    const result = await this.findVersionOrThrow(newVersionId);
    await this.auditService.record({
      operatorOpenId,
      action: 'form_template.draft.create_from_version',
      targetType: 'perf_form_template_version',
      targetId: String(newVersionId),
      before: source,
      after: result,
    });
    return result;
  }

  async archiveVersion(operatorOpenId: string, id: number) {
    const before = await this.findVersionOrThrow(id);
    if (before.status !== 'PUBLISHED') {
      throw new BadRequestException('只有已发布版本允许归档');
    }

    const now = new Date();
    await this.prisma.perfFormTemplateVersion.update({
      where: { id },
      data: {
        status: 'ARCHIVED',
        archivedByOpenId: operatorOpenId,
        archivedAt: now,
        updatedByOpenId: operatorOpenId,
      },
    });
    const result = await this.findVersionOrThrow(id);
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

  /** Prisma 三层 nested-create 的唯一映射入口，避免编辑、复制等路径字段漂移。 */
  private toSubformCreateData(
    subforms: FormTemplateVersionContract['subforms'],
  ) {
    return subforms.map((subform) => ({
      type: subform.type,
      title: subform.title,
      description: subform.description,
      sortOrder: subform.sortOrder,
      dimensions: {
        create: subform.dimensions.map((dimension) => ({
          kind: dimension.kind,
          audience: dimension.audience,
          name: dimension.name,
          description: dimension.description,
          weight: dimension.weight,
          isCore: dimension.isCore,
          sortOrder: dimension.sortOrder,
          items: {
            create: dimension.items.map((item) => ({
              type: item.type,
              title: item.title,
              description: item.description,
              placeholder: item.placeholder,
              required: item.required,
              sortOrder: item.sortOrder,
              config: item.config
                ? (item.config as Prisma.InputJsonValue)
                : undefined,
            })),
          },
        })),
      },
    }));
  }

  private toPublicationContract(
    version: Awaited<ReturnType<FormTemplateService['findVersionOrThrow']>>,
  ): FormTemplateVersionContract {
    return {
      name: version.name,
      description: version.description,
      jobLevelPrefix: version.jobLevelPrefix,
      subforms: version.subforms.map((subform) => ({
        type: subform.type,
        title: subform.title,
        description: subform.description,
        sortOrder: subform.sortOrder,
        dimensions: subform.dimensions.map((dimension) => ({
          kind: dimension.kind,
          audience: dimension.audience,
          name: dimension.name,
          description: dimension.description,
          weight: dimension.weight?.toString() ?? null,
          isCore: dimension.isCore,
          sortOrder: dimension.sortOrder,
          items: dimension.items.map((item) => ({
            type: item.type,
            title: item.title,
            description: item.description,
            placeholder: item.placeholder,
            required: item.required,
            sortOrder: item.sortOrder,
            config: item.config as FormItemConfig | null,
          })),
        })),
      })),
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
