import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import type {
  FormItemConfig,
  FormTemplateSubformContract,
} from '../form-template/form-template.contract';
import { RbacService } from '../rbac/rbac.service';
import { PrismaService } from '../shared/database/prisma.service';
import {
  previewConfigCalculation,
  type CalculationPreviewDimensionInput,
} from './calculation-preview';
import type {
  ConfigConstraintProfiles,
  ConfigRatingDefinition,
  ConfigStageModes,
  ConfigTemplateVersionContract,
  NotificationRules,
  ReviewerRelationWeight,
  SchedulePreset,
} from './config-template.contract';
import { buildDefaultConfigTemplate } from './default-config-template';
import { validateConfigTemplatePublication } from './publication-validator';

export type CreateConfigTemplateInput = {
  name: string;
  description?: string | null;
};

export type ReplaceConfigTemplateDraftInput = Omit<
  ConfigTemplateVersionContract,
  'formBindings' | 'notificationRules'
> & {
  /** 草稿允许暂时不绑定表单；发布校验再要求 D/M 完整覆盖。 */
  formTemplateVersionIds: number[];
  notificationRules: {
    stages: ReadonlyArray<{
      stage: 'SELF' | 'PEER' | 'MANAGER';
      taskOpened: {
        enabled: boolean;
        recipient: 'ASSIGNEE';
        ccLeader: boolean;
        ccHr: boolean;
      };
      reminder: {
        enabled: boolean;
        recipient: 'ASSIGNEE';
        ccLeader: boolean;
        ccHr: boolean;
        frequency: {
          type:
            | 'ONCE_AT_DEADLINE'
            | 'DAILY_AFTER_DEADLINE'
            | 'EVERY_N_DAYS_AFTER_DEADLINE';
          intervalDays?: number;
        };
      };
    }>;
  };
};

export type ConfigTemplatePreviewInput = {
  stage: 'SELF' | 'PEER' | 'MANAGER' | 'AI';
  jobLevelPrefix: 'D' | 'M';
  dimensions?: Array<{
    dimensionId: number;
    relations: Array<{
      type: 'ORG_OWNER' | 'PROJECT_OWNER' | 'PEER' | 'CROSS_DEPT' | 'LEADER';
      rawValues: string[];
    }>;
  }>;
  directRating?: 'S' | 'A' | 'B' | 'C';
};

type ConfigVersionRecord = NonNullable<
  Awaited<ReturnType<ConfigTemplateService['findVersionOrThrow']>>
>;

/**
 * 版本化配置模板应用服务。
 *
 * 配置版本只保存规则和精确表单版本引用；旧 PerfTemplate 与周期复制链路在 Ticket 04 前保持不变。
 */
@Injectable()
export class ConfigTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly rbacService: RbacService,
  ) {}

  async listConfigTemplates(operatorOpenId: string) {
    const isAdmin = await this.rbacService.isAdmin(operatorOpenId);
    const versions = await this.prisma.perfConfigTemplateVersion.findMany({
      where: isAdmin ? {} : { status: 'PUBLISHED' },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: this.versionInclude(),
    });
    return {
      items: versions.map((version) => this.toDetailResponse(version)),
      total: versions.length,
    };
  }

  async listTemplateVersions(operatorOpenId: string, templateId: number) {
    const isAdmin = await this.rbacService.isAdmin(operatorOpenId);
    const versions = await this.prisma.perfConfigTemplateVersion.findMany({
      where: {
        templateId,
        ...(isAdmin ? {} : { status: 'PUBLISHED' as const }),
      },
      orderBy: { version: 'desc' },
      include: this.versionInclude(),
    });
    return {
      items: versions.map((version) => this.toDetailResponse(version)),
      total: versions.length,
    };
  }

  async getVersion(operatorOpenId: string, id: number) {
    const [isAdmin, version] = await Promise.all([
      this.rbacService.isAdmin(operatorOpenId),
      this.findVersionOrThrow(id),
    ]);
    if (!isAdmin && version.status !== 'PUBLISHED') {
      // 对 HR 隐藏草稿和归档版本是否存在，防止未发布配置泄露。
      throw new NotFoundException('配置模板版本不存在或不可用');
    }
    return this.toDetailResponse(version);
  }

  async createConfigTemplate(
    operatorOpenId: string,
    input: CreateConfigTemplateInput,
  ) {
    const defaults = buildDefaultConfigTemplate();
    const versionId = await this.prisma.$transaction(async (tx) => {
      const template = await tx.perfConfigTemplate.create({
        data: { createdByOpenId: operatorOpenId },
      });
      const version = await tx.perfConfigTemplateVersion.create({
        data: {
          templateId: template.id,
          version: 1,
          status: 'DRAFT',
          name: input.name,
          description: input.description,
          ...this.toPersistedContent(defaults),
          createdByOpenId: operatorOpenId,
          updatedByOpenId: operatorOpenId,
        },
      });
      return version.id;
    });

    const result = await this.findVersionOrThrow(versionId);
    const response = this.toDetailResponse(result);
    await this.auditService.record({
      operatorOpenId,
      action: 'config_template.create',
      targetType: 'perf_config_template_version',
      targetId: String(versionId),
      after: response,
    });
    return response;
  }

  async replaceDraftContent(
    operatorOpenId: string,
    id: number,
    input: ReplaceConfigTemplateDraftInput,
  ) {
    const versionIds = [...new Set(input.formTemplateVersionIds)];
    if (
      versionIds.length !== input.formTemplateVersionIds.length ||
      versionIds.length > 2
    ) {
      throw new BadRequestException(
        '表单版本绑定必须去重且最多包含 D/M 两个版本',
      );
    }

    const candidates =
      versionIds.length === 0
        ? []
        : await this.prisma.perfFormTemplateVersion.findMany({
            where: { id: { in: versionIds }, status: 'PUBLISHED' },
            select: { id: true, jobLevelPrefix: true },
          });
    if (candidates.length !== versionIds.length) {
      throw new BadRequestException('配置模板只能绑定当前已发布的表单版本');
    }
    if (
      new Set(candidates.map((candidate) => candidate.jobLevelPrefix)).size !==
      candidates.length
    ) {
      throw new BadRequestException(
        '同一配置版本的每个职级前缀只能绑定一个表单版本',
      );
    }

    const { before, result } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "performance"."perf_config_template_versions" WHERE "id" = ${id} FOR UPDATE`;
      const lockedDraft = await this.findVersionOrThrow(id, tx);
      if (lockedDraft.status !== 'DRAFT') {
        throw new BadRequestException('只有草稿版本允许编辑');
      }

      await tx.perfConfigTemplateVersion.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          ...this.toPersistedContent(input),
          updatedByOpenId: operatorOpenId,
        },
      });
      // 整体覆盖绑定，避免删除或切换表单时遗留旧前缀关系。
      await tx.perfConfigFormBinding.deleteMany({
        where: { configVersionId: id },
      });
      if (candidates.length > 0) {
        await tx.perfConfigFormBinding.createMany({
          data: candidates.map((candidate) => ({
            configVersionId: id,
            formTemplateVersionId: candidate.id,
            jobLevelPrefix: candidate.jobLevelPrefix,
          })),
        });
      }
      return {
        before: lockedDraft,
        result: await this.findVersionOrThrow(id, tx),
      };
    });

    const response = this.toDetailResponse(result);
    await this.auditService.record({
      operatorOpenId,
      action: 'config_template.draft.update',
      targetType: 'perf_config_template_version',
      targetId: String(id),
      before: this.toDetailResponse(before),
      after: response,
    });
    return response;
  }

  async validateVersion(operatorOpenId: string, id: number) {
    const version = await this.getVisibleVersionOrThrow(operatorOpenId, id);
    const issues = this.publicationIssues(version);
    return { valid: issues.length === 0, issues };
  }

  async publishVersion(operatorOpenId: string, id: number) {
    const { before, result } = await this.prisma.$transaction(async (tx) => {
      // 与草稿整体覆盖争用同一版本行锁，确保“读取→校验→发布”之间内容不会变化。
      await tx.$queryRaw`SELECT "id" FROM "performance"."perf_config_template_versions" WHERE "id" = ${id} FOR UPDATE`;
      const lockedDraft = await this.findVersionOrThrow(id, tx);
      if (lockedDraft.status !== 'DRAFT') {
        throw new BadRequestException('只有草稿版本允许发布');
      }

      const issues = this.publicationIssues(lockedDraft);
      if (issues.length > 0) {
        throw new BadRequestException({
          message: '配置模板发布校验失败',
          issues,
        });
      }

      const now = new Date();
      await tx.perfConfigTemplateVersion.update({
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

    const response = this.toDetailResponse(result);
    await this.auditService.record({
      operatorOpenId,
      action: 'config_template.publish',
      targetType: 'perf_config_template_version',
      targetId: String(id),
      before: this.toDetailResponse(before),
      after: response,
    });
    return response;
  }

  async createDraftFromVersion(
    operatorOpenId: string,
    sourceVersionId: number,
  ) {
    const { newVersionId, source } = await this.prisma.$transaction(
      async (tx) => {
        // 共享锁阻止来源版本在复制中被归档，消除事务外检查带来的 TOCTOU。
        await tx.$queryRaw`SELECT "id" FROM "performance"."perf_config_template_versions" WHERE "id" = ${sourceVersionId} FOR SHARE`;
        const lockedSource = await this.findVersionOrThrow(sourceVersionId, tx);
        if (lockedSource.status !== 'PUBLISHED') {
          throw new BadRequestException('只能从已发布版本创建新草稿');
        }

        // 同一稳定模板的“取最大版本号→创建”必须串行，避免并发复制争用唯一键。
        await tx.$queryRaw`SELECT "id" FROM "performance"."perf_config_templates" WHERE "id" = ${lockedSource.templateId} FOR UPDATE`;
        for (const formVersionId of lockedSource.formBindings
          .map((binding) => binding.formTemplateVersionId)
          .sort((left, right) => left - right)) {
          // 最多两条绑定，按 id 固定顺序加共享锁后重读，确保归档竞态会转化为“新草稿缺少绑定”而不是数据库异常。
          await tx.$queryRaw`SELECT "id" FROM "performance"."perf_form_template_versions" WHERE "id" = ${formVersionId} FOR SHARE`;
        }
        const copySource = await this.findVersionOrThrow(sourceVersionId, tx);
        const aggregate = await tx.perfConfigTemplateVersion.aggregate({
          where: { templateId: copySource.templateId },
          _max: { version: true },
        });
        const version = await tx.perfConfigTemplateVersion.create({
          data: {
            templateId: copySource.templateId,
            version: (aggregate._max.version ?? 0) + 1,
            status: 'DRAFT',
            name: copySource.name,
            description: copySource.description,
            sourceVersionId: copySource.id,
            selfStageMode: copySource.selfStageMode,
            peerStageMode: copySource.peerStageMode,
            managerStageMode: copySource.managerStageMode,
            aiStageMode: copySource.aiStageMode,
            ratings: this.inputJson(copySource.ratings),
            constraintProfiles: this.inputJson(copySource.constraintProfiles),
            orgOwnerWeight: copySource.orgOwnerWeight,
            projectOwnerWeight: copySource.projectOwnerWeight,
            peerWeight: copySource.peerWeight,
            crossDeptWeight: copySource.crossDeptWeight,
            schedulePreset: this.inputJson(copySource.schedulePreset),
            notificationRules: this.inputJson(copySource.notificationRules),
            createdByOpenId: operatorOpenId,
            updatedByOpenId: operatorOpenId,
            formBindings: {
              // 已归档表单只保留在历史发布版本中；新草稿留出缺口并通过发布问题提示管理员重选。
              create: copySource.formBindings
                .filter(
                  (binding) =>
                    binding.formTemplateVersion.status === 'PUBLISHED',
                )
                .map((binding) => ({
                  formTemplateVersionId: binding.formTemplateVersionId,
                  jobLevelPrefix: binding.jobLevelPrefix,
                })),
            },
          },
        });
        return { newVersionId: version.id, source: copySource };
      },
    );

    const result = await this.findVersionOrThrow(newVersionId);
    const response = this.toDetailResponse(result);
    await this.auditService.record({
      operatorOpenId,
      action: 'config_template.draft.create_from_version',
      targetType: 'perf_config_template_version',
      targetId: String(newVersionId),
      before: this.toDetailResponse(source),
      after: response,
    });
    return response;
  }

  async archiveVersion(operatorOpenId: string, id: number) {
    const { before, result } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "performance"."perf_config_template_versions" WHERE "id" = ${id} FOR UPDATE`;
      const lockedVersion = await this.findVersionOrThrow(id, tx);
      if (lockedVersion.status !== 'PUBLISHED') {
        throw new BadRequestException('只有已发布版本允许归档');
      }

      const now = new Date();
      await tx.perfConfigTemplateVersion.update({
        where: { id },
        data: {
          status: 'ARCHIVED',
          archivedByOpenId: operatorOpenId,
          archivedAt: now,
          updatedByOpenId: operatorOpenId,
        },
      });
      return {
        before: lockedVersion,
        result: await this.findVersionOrThrow(id, tx),
      };
    });
    const response = this.toDetailResponse(result);
    await this.auditService.record({
      operatorOpenId,
      action: 'config_template.archive',
      targetType: 'perf_config_template_version',
      targetId: String(id),
      before: this.toDetailResponse(before),
      after: response,
    });
    return response;
  }

  async calculatePreview(
    operatorOpenId: string,
    id: number,
    input: ConfigTemplatePreviewInput,
  ) {
    const version = await this.getVisibleVersionOrThrow(operatorOpenId, id);
    const binding = version.formBindings.find(
      (candidate) => candidate.jobLevelPrefix === input.jobLevelPrefix,
    );

    const authoritativeDimensions: CalculationPreviewDimensionInput[] = [];
    if (binding && ['PEER', 'MANAGER'].includes(input.stage)) {
      const subform = binding.formTemplateVersion.subforms.find(
        (candidate) => candidate.type === input.stage,
      );
      const regularDimensions = (subform?.dimensions ?? []).filter(
        (dimension) => dimension.kind === 'REGULAR',
      );
      const dimensionsById = new Map(
        regularDimensions.map((dimension) => [dimension.id, dimension]),
      );
      const requestedDimensions = input.dimensions ?? [];
      const requestedIds = requestedDimensions.map(
        (dimension) => dimension.dimensionId,
      );
      const requestedIdSet = new Set(requestedIds);
      if (
        requestedIdSet.size !== requestedIds.length ||
        requestedIdSet.size !== dimensionsById.size ||
        [...requestedIdSet].some(
          (dimensionId) => !dimensionsById.has(dimensionId),
        )
      ) {
        return {
          status: 'UNAVAILABLE' as const,
          issues: [
            {
              code: 'PREVIEW_DIMENSION_SET_MISMATCH',
              path: 'dimensions',
              message:
                '预览维度必须与当前绑定表单该阶段的全部常规维度精确一致，且不能重复',
            },
          ],
        };
      }
      for (const requested of requestedDimensions) {
        const dimension = dimensionsById.get(requested.dimensionId);
        if (!dimension || dimension.kind !== 'REGULAR') {
          return {
            status: 'UNAVAILABLE' as const,
            issues: [
              {
                code: 'PREVIEW_DIMENSION_INVALID',
                path: 'dimensions',
                message: `维度 ${requested.dimensionId} 不属于当前绑定表单的 ${input.stage} 常规维度`,
              },
            ],
          };
        }
        authoritativeDimensions.push({
          id: String(dimension.id),
          name: dimension.name,
          weight: dimension.weight?.toString() ?? '0',
          isCore: dimension.isCore,
          relations: requested.relations.map((relation) => ({
            relation: relation.type,
            rawValues: relation.rawValues,
          })),
        });
      }
    }

    return previewConfigCalculation({
      config: this.toPublicationContract(version, version.status !== 'DRAFT'),
      stage: input.stage,
      jobLevelPrefix: input.jobLevelPrefix,
      directLevel: input.directRating,
      dimensions: authoritativeDimensions,
    });
  }

  private async getVisibleVersionOrThrow(operatorOpenId: string, id: number) {
    const [isAdmin, version] = await Promise.all([
      this.rbacService.isAdmin(operatorOpenId),
      this.findVersionOrThrow(id),
    ]);
    if (!isAdmin && version.status !== 'PUBLISHED') {
      throw new NotFoundException('配置模板版本不存在或不可用');
    }
    return version;
  }

  private publicationIssues(version: ConfigVersionRecord) {
    return validateConfigTemplatePublication(
      this.toPublicationContract(version, version.status !== 'DRAFT'),
    );
  }

  private toDetailResponse(version: ConfigVersionRecord) {
    const contract = this.toPublicationContract(
      version,
      version.status !== 'DRAFT',
    );
    // 已发布配置在发布时已经锁定；其绑定表单后来归档，不影响历史周期继续使用该精确版本。
    const publicationIssues = this.publicationIssues(version);
    const available =
      version.status === 'PUBLISHED' && publicationIssues.length === 0;
    const lifecycleIssues =
      version.status === 'DRAFT'
        ? [
            {
              code: 'CONFIG_VERSION_DRAFT',
              path: 'status',
              message: '配置模板版本尚未发布，不可用于新周期',
            },
          ]
        : version.status === 'ARCHIVED'
          ? [
              {
                code: 'CONFIG_VERSION_ARCHIVED',
                path: 'status',
                message: '配置模板版本已归档，不可再用于新周期',
              },
            ]
          : [];
    return {
      ...version,
      systemKey: version.template?.systemKey ?? null,
      source: version.sourceVersion ?? null,
      stageModes: contract.stageModes,
      ratings: contract.ratings,
      constraintProfiles: contract.constraintProfiles,
      reviewerRelationWeights: contract.reviewerRelationWeights,
      schedulePreset: contract.schedulePreset,
      notificationRules: contract.notificationRules,
      formTemplateVersionIds: version.formBindings.map(
        (binding) => binding.formTemplateVersionId,
      ),
      formBindings: version.formBindings.map(
        ({ formTemplateVersion, ...binding }) => ({
          ...binding,
          status: formTemplateVersion.status,
          subforms: this.toFormSubformContracts(formTemplateVersion.subforms),
          formTemplateVersion,
        }),
      ),
      publicationIssues,
      unavailableReasons: available
        ? []
        : [...publicationIssues, ...lifecycleIssues],
      available,
      isUsable: available,
    };
  }

  private toPublicationContract(
    version: ConfigVersionRecord,
    preservePublishedBindingStatus = false,
  ): ConfigTemplateVersionContract {
    return {
      name: version.name,
      description: version.description,
      stageModes: {
        SELF: version.selfStageMode,
        PEER: version.peerStageMode,
        MANAGER: version.managerStageMode,
        AI: version.aiStageMode,
      } as ConfigStageModes,
      ratings: version.ratings as unknown as ConfigRatingDefinition[],
      constraintProfiles:
        version.constraintProfiles as unknown as ConfigConstraintProfiles,
      reviewerRelationWeights: {
        ORG_OWNER: version.orgOwnerWeight.toString(),
        PROJECT_OWNER: version.projectOwnerWeight.toString(),
        PEER: version.peerWeight.toString(),
        CROSS_DEPT: version.crossDeptWeight.toString(),
      },
      formBindings: version.formBindings.map((binding) => ({
        formTemplateVersionId: binding.formTemplateVersionId,
        status: preservePublishedBindingStatus
          ? 'PUBLISHED'
          : binding.formTemplateVersion.status,
        jobLevelPrefix: binding.jobLevelPrefix,
        subforms: this.toFormSubformContracts(
          binding.formTemplateVersion.subforms,
        ),
      })),
      schedulePreset: version.schedulePreset as unknown as SchedulePreset,
      notificationRules:
        version.notificationRules as unknown as NotificationRules,
    };
  }

  private toFormSubformContracts(
    subforms: ConfigVersionRecord['formBindings'][number]['formTemplateVersion']['subforms'],
  ): FormTemplateSubformContract[] {
    return subforms.map((subform) => ({
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
    }));
  }

  private toPersistedContent(input: {
    stageModes: ConfigStageModes;
    ratings: readonly ConfigRatingDefinition[];
    constraintProfiles: ConfigConstraintProfiles;
    reviewerRelationWeights: ReviewerRelationWeight;
    schedulePreset: SchedulePreset;
    notificationRules:
      NotificationRules | ReplaceConfigTemplateDraftInput['notificationRules'];
  }) {
    return {
      selfStageMode: input.stageModes.SELF,
      peerStageMode: input.stageModes.PEER,
      managerStageMode: input.stageModes.MANAGER,
      aiStageMode: input.stageModes.AI,
      ratings: this.inputJson(input.ratings),
      constraintProfiles: this.inputJson(input.constraintProfiles),
      orgOwnerWeight: input.reviewerRelationWeights.ORG_OWNER,
      projectOwnerWeight: input.reviewerRelationWeights.PROJECT_OWNER,
      peerWeight: input.reviewerRelationWeights.PEER,
      crossDeptWeight: input.reviewerRelationWeights.CROSS_DEPT,
      schedulePreset: this.inputJson(input.schedulePreset),
      notificationRules: this.inputJson(input.notificationRules),
    };
  }

  /** 统一做 JSON 深复制，既剥离 readonly，也避免把 undefined 写入 Prisma Json。 */
  private inputJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private versionInclude() {
    return {
      template: { select: { systemKey: true } },
      sourceVersion: {
        select: { id: true, version: true, name: true, status: true },
      },
      formBindings: {
        orderBy: { jobLevelPrefix: 'asc' as const },
        include: {
          formTemplateVersion: {
            include: {
              subforms: {
                orderBy: { sortOrder: 'asc' as const },
                include: {
                  dimensions: {
                    orderBy: [
                      { audience: 'asc' as const },
                      { sortOrder: 'asc' as const },
                    ],
                    include: {
                      items: { orderBy: { sortOrder: 'asc' as const } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
  }

  private async findVersionOrThrow(
    id: number,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const version = await client.perfConfigTemplateVersion.findUnique({
      where: { id },
      include: this.versionInclude(),
    });
    if (!version) throw new NotFoundException('配置模板版本不存在');
    return version;
  }
}
