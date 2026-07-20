/**
 * 幂等初始化「基线业务数据」：默认评估表单模板 + 默认配置模板 + 绩效周期草稿。
 * 运行：pnpm seed:baseline
 *
 * 行为：先清理旧数据（若这三类数据已存在则全部删除），再基于权威文档重建：
 * - 评估表单模板（PerfFormTemplate D/M）：内容取自 form-template/default-form-templates，
 *   维度/权重与《盯潮-绩效系统-评估维度规则说明》一致（普通岗 35/45/20，管理岗 40/35/25 等）。
 * - 配置模板（PerfConfigTemplate，systemKey=DEFAULT_CONFIG）：评级 S/A/B/C 区间与映射分、
 *   加权/评分约束取自 config-template/default-config-template 与《绩效等级定义和计算方式》，
 *   并补齐一套可发布的默认日程（default-config-template 故意留 0/0 不可发布，这里覆盖为可发布值）。
 * - 绩效周期草稿：名称固定「2026年中绩效评定」，从上面已发布的配置模板版本复制配置快照与 D/M 表单快照，
 *   复刻 CycleSetupService.createFromPublishedConfig 的快照写入逻辑（保持与四步创建一致）。
 *
 * 注意：评估表单模板 / 配置模板 / 绩效周期相关的数据结构或数据库字段变更后，必须同步更新本脚本
 * （见 CLAUDE.md「基线初始化脚本」规则）。
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { loadAppConfig } from '../config/configuration';
import type {
  ConfigTemplateVersionContract,
  SchedulePreset,
} from '../config-template/config-template.contract';
import { buildDefaultConfigTemplate } from '../config-template/default-config-template';
import { validateConfigTemplatePublication } from '../config-template/publication-validator';
import { toCycleConfigSnapshotData } from '../cycle/cycle-config-snapshot-data';
import {
  DEFAULT_FORM_TEMPLATES,
  toDefaultLegacyPromotionCreateData,
} from '../form-template/default-form-templates';
import type {
  LegacyFormItemConfig,
  FormTemplateSubformContract,
} from '../form-template/form-template.contract';
import {
  toPerformanceSubformContracts,
  toPerformanceSubformCreateData,
} from '../form-template/form-template.persistence';
import { validateFormTemplatePublication } from '../form-template/publication-validator';
import type { Prisma } from '../generated/prisma/client';
import { PrismaClient } from '../generated/prisma/client';
import type { PerfJobLevelPrefix } from '../generated/prisma/enums';

const SYSTEM_OPERATOR = 'SYSTEM_BASELINE_SEED';

/** 配置模板稳定幂等键；清理与重建都据此定位。 */
const CONFIG_TEMPLATE_SYSTEM_KEY = 'DEFAULT_CONFIG';
const CONFIG_TEMPLATE_NAME = '标准半年度绩效配置';

/** 表单模板稳定幂等键（内容来自 DEFAULT_FORM_TEMPLATES）。 */
const FORM_TEMPLATE_SYSTEM_KEYS = DEFAULT_FORM_TEMPLATES.map(
  (template) => template.systemKey,
);

/** 绩效周期草稿名称（固定业务期间表达）。 */
const CYCLE_NAME = '2026年中绩效评定';

/**
 * 计划启动时间：必须带时区，作为相对日程换算绝对时间的唯一锚点。
 * 草稿周期不强制未来时间，这里取 2026 年中一个稳定值以匹配周期语义。
 */
const CYCLE_PLANNED_START_AT = '2026-07-01T09:00:00+08:00';

const DAY_MINUTES = 24 * 60;

/**
 * 可发布的默认日程预设：default-config-template 故意用 0/0 保持不可发布，
 * 这里覆盖为一套满足「提醒晚于开始、三阶段各一次」的默认值，使配置模板可发布、周期可创建。
 * allowStageOverlap=true，因此不校验阶段间重叠。
 */
const BASELINE_SCHEDULE_PRESET: SchedulePreset = {
  allowStageOverlap: true,
  stages: [
    {
      stage: 'SELF',
      startOffsetMinutes: 0,
      reminderDeadlineOffsetMinutes: 7 * DAY_MINUTES,
    },
    {
      stage: 'PEER',
      startOffsetMinutes: 0,
      reminderDeadlineOffsetMinutes: 7 * DAY_MINUTES,
    },
    {
      stage: 'MANAGER',
      startOffsetMinutes: 0,
      reminderDeadlineOffsetMinutes: 14 * DAY_MINUTES,
    },
  ],
};

/** 统一 JSON 深复制：剥离 readonly，并避免把 undefined 写入 Prisma Json。 */
function inputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * 清理旧基线数据。已发布的模板版本被数据库 guard 触发器保护（只允许删除 DRAFT），
 * 因此需临时禁用「版本级」用户触发器；子层触发器在级联删除时会自行放行（父记录已不可见），
 * 外键约束（Restrict/Cascade）不受 DISABLE TRIGGER USER 影响，仍然生效。
 * 删除顺序：先删同名周期的通知发送记录、通知事件与可复算阶段结果，再删周期（级联清空配置/表单快照，释放对模板版本的 Restrict 占用），
 * 再删配置模板版本+模板，最后删表单模板版本+模板。
 */
async function cleanupBaseline(prisma: PrismaClient) {
  await prisma.$transaction(async (tx) => {
    const historicalArchive = await tx.perfCycleArchive.findFirst({
      where: { cycle: { name: CYCLE_NAME } },
      select: { id: true, cycleId: true },
    });
    if (historicalArchive) {
      // 已归档周期属于正式绩效档案；seed 不能借幂等清理绕过永久不可变边界。
      throw new Error(
        `基线周期 #${historicalArchive.cycleId} 已归档（记录 #${historicalArchive.id}），不能由 seed 清理；请使用新的周期名称`,
      );
    }
    const historicalRollback = await tx.perfCycleRollback.findFirst({
      where: { cycle: { name: CYCLE_NAME } },
      select: { id: true, cycleId: true },
    });
    if (historicalRollback) {
      // 周期退回是不可删除的高风险审计事实；seed 不得为了“幂等”绕过触发器抹历史。
      throw new Error(
        `基线周期 #${historicalRollback.cycleId} 已存在退回记录 #${historicalRollback.id}，不能由 seed 清理；请保留该历史并使用新的周期名称`,
      );
    }
    const baselineCycles = await tx.perfCycle.findMany({
      where: { name: CYCLE_NAME },
      select: { id: true },
    });
    const baselineCycleIds = baselineCycles.map((cycle) => cycle.id);
    if (baselineCycleIds.length > 0) {
      // 通知事件保留来源的 RESTRICT 外键；开发基线重建时必须先删除其发送记录和事件。
      await tx.perfNotification.deleteMany({
        where: { sourceEvent: { cycleId: { in: baselineCycleIds } } },
      });
      await tx.perfNotificationEvent.deleteMany({
        where: { cycleId: { in: baselineCycleIds } },
      });
      // 阶段结果是可复算派生数据，但为保护计算证据使用 RESTRICT 外键，基线重建需显式清理。
      await tx.perfStageResult.deleteMany({
        where: { cycleId: { in: baselineCycleIds } },
      });
    }
    const removedCycles = await tx.perfCycle.deleteMany({
      where: { id: { in: baselineCycleIds } },
    });

    await tx.$executeRawUnsafe(
      'ALTER TABLE "performance"."perf_config_template_versions" DISABLE TRIGGER USER',
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE "performance"."perf_form_template_versions" DISABLE TRIGGER USER',
    );
    try {
      const configTemplates = await tx.perfConfigTemplate.findMany({
        where: { systemKey: CONFIG_TEMPLATE_SYSTEM_KEY },
        select: { id: true },
      });
      const configTemplateIds = configTemplates.map((template) => template.id);
      if (configTemplateIds.length > 0) {
        // 删除版本会级联删除表单绑定（onDelete: Cascade），释放对表单模板版本的 Restrict 占用。
        await tx.perfConfigTemplateVersion.deleteMany({
          where: { templateId: { in: configTemplateIds } },
        });
        await tx.perfConfigTemplate.deleteMany({
          where: { id: { in: configTemplateIds } },
        });
      }

      const formTemplates = await tx.perfFormTemplate.findMany({
        where: { systemKey: { in: FORM_TEMPLATE_SYSTEM_KEYS } },
        select: { id: true },
      });
      const formTemplateIds = formTemplates.map((template) => template.id);
      if (formTemplateIds.length > 0) {
        // 删除版本会级联删除子表单/维度/评估项（onDelete: Cascade）。
        await tx.perfFormTemplateVersion.deleteMany({
          where: { templateId: { in: formTemplateIds } },
        });
        await tx.perfFormTemplate.deleteMany({
          where: { id: { in: formTemplateIds } },
        });
      }

      console.log(
        `清理完成：周期 ${removedCycles.count} 个、配置模板 ${configTemplateIds.length} 个、表单模板 ${formTemplateIds.length} 个`,
      );
    } finally {
      await tx.$executeRawUnsafe(
        'ALTER TABLE "performance"."perf_form_template_versions" ENABLE TRIGGER USER',
      );
      await tx.$executeRawUnsafe(
        'ALTER TABLE "performance"."perf_config_template_versions" ENABLE TRIGGER USER',
      );
    }
  });
}

/**
 * 创建并发布默认 D/M 评估表单模板，返回各职级前缀对应的已发布版本 id。
 * 与 seed-default-form-templates 逻辑一致：先建 DRAFT（数据库要求版本从 DRAFT 起步），再转 PUBLISHED。
 */
async function seedFormTemplates(
  prisma: PrismaClient,
): Promise<Map<PerfJobLevelPrefix, number>> {
  const versionByPrefix = new Map<PerfJobLevelPrefix, number>();

  for (const template of DEFAULT_FORM_TEMPLATES) {
    const issues = validateFormTemplatePublication(template);
    if (issues.length > 0) {
      throw new Error(
        `默认表单 ${template.systemKey} 未通过发布校验：${JSON.stringify(issues)}`,
      );
    }

    const versionId = await prisma.$transaction(async (tx) => {
      const root = await tx.perfFormTemplate.create({
        data: {
          systemKey: template.systemKey,
          createdByOpenId: SYSTEM_OPERATOR,
        },
      });
      const version = await tx.perfFormTemplateVersion.create({
        data: {
          templateId: root.id,
          version: template.version,
          status: 'DRAFT',
          name: template.name,
          description: template.description,
          jobLevelPrefix: template.jobLevelPrefix,
          createdByOpenId: SYSTEM_OPERATOR,
          updatedByOpenId: SYSTEM_OPERATOR,
          subforms: {
            create: [
              ...toPerformanceSubformCreateData(template.subforms),
              toDefaultLegacyPromotionCreateData(),
            ],
          },
        },
      });
      await tx.perfFormTemplateVersion.update({
        where: { id: version.id },
        data: {
          status: 'PUBLISHED',
          publishedByOpenId: SYSTEM_OPERATOR,
          publishedAt: new Date(),
          updatedByOpenId: SYSTEM_OPERATOR,
        },
      });
      return version.id;
    });

    versionByPrefix.set(template.jobLevelPrefix, versionId);
    console.log(
      `已发布表单模板 ${template.systemKey}（jobLevelPrefix=${template.jobLevelPrefix}, versionId=${versionId}）`,
    );
  }

  if (!versionByPrefix.has('D') || !versionByPrefix.has('M')) {
    throw new Error('默认表单模板必须同时覆盖 D 与 M 前缀');
  }
  return versionByPrefix;
}

type FormVersionWithContent = Prisma.PerfFormTemplateVersionGetPayload<{
  include: {
    subforms: { include: { dimensions: { include: { items: true } } } };
  };
}>;

/** 把已发布表单版本转换为发布校验用的子表单契约（复刻 ConfigTemplateService.toFormSubformContracts）。 */
function toSubformContracts(
  version: FormVersionWithContent,
): FormTemplateSubformContract[] {
  return toPerformanceSubformContracts(version.subforms);
}

/**
 * 创建并发布默认配置模板（systemKey=DEFAULT_CONFIG），返回已发布配置版本 id。
 * 内容取默认配置模板 + 可发布日程 + D/M 表单绑定；发布前跑一次 app 层发布校验，失败即中止。
 */
async function seedConfigTemplate(
  prisma: PrismaClient,
  formVersionByPrefix: Map<PerfJobLevelPrefix, number>,
): Promise<number> {
  const formVersions = await prisma.perfFormTemplateVersion.findMany({
    where: { id: { in: [...formVersionByPrefix.values()] } },
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
  const formVersionById = new Map(
    formVersions.map((version) => [version.id, version]),
  );

  const defaults = buildDefaultConfigTemplate();
  const bindings = (['D', 'M'] as const).map((prefix) => {
    const versionId = formVersionByPrefix.get(prefix)!;
    const version = formVersionById.get(versionId)!;
    return {
      formTemplateVersionId: versionId,
      jobLevelPrefix: prefix,
      status: 'PUBLISHED' as const,
      subforms: toSubformContracts(version),
    };
  });

  // 用真实的表单绑定与可发布日程组装完整契约，发布前跑一次 app 层发布校验。
  const contract: ConfigTemplateVersionContract = {
    ...defaults,
    schedulePreset: BASELINE_SCHEDULE_PRESET,
    formBindings: bindings,
  };
  const issues = validateConfigTemplatePublication(contract);
  if (issues.length > 0) {
    throw new Error(`默认配置模板未通过发布校验：${JSON.stringify(issues)}`);
  }

  const versionId = await prisma.$transaction(async (tx) => {
    const template = await tx.perfConfigTemplate.create({
      data: {
        systemKey: CONFIG_TEMPLATE_SYSTEM_KEY,
        createdByOpenId: SYSTEM_OPERATOR,
      },
    });
    const version = await tx.perfConfigTemplateVersion.create({
      data: {
        templateId: template.id,
        version: 1,
        status: 'DRAFT',
        name: CONFIG_TEMPLATE_NAME,
        description: defaults.description,
        selfStageMode: defaults.stageModes.SELF,
        peerStageMode: defaults.stageModes.PEER,
        managerStageMode: defaults.stageModes.MANAGER,
        aiStageMode: defaults.stageModes.AI,
        ratings: inputJson(defaults.ratings),
        constraintProfiles: inputJson(defaults.constraintProfiles),
        orgOwnerWeight: defaults.reviewerRelationWeights.ORG_OWNER,
        projectOwnerWeight: defaults.reviewerRelationWeights.PROJECT_OWNER,
        peerWeight: defaults.reviewerRelationWeights.PEER,
        crossDeptWeight: defaults.reviewerRelationWeights.CROSS_DEPT,
        schedulePreset: inputJson(BASELINE_SCHEDULE_PRESET),
        notificationRules: inputJson(defaults.notificationRules),
        createdByOpenId: SYSTEM_OPERATOR,
        updatedByOpenId: SYSTEM_OPERATOR,
        formBindings: {
          create: bindings.map((binding) => ({
            formTemplateVersionId: binding.formTemplateVersionId,
            jobLevelPrefix: binding.jobLevelPrefix,
          })),
        },
      },
    });
    await tx.perfConfigTemplateVersion.update({
      where: { id: version.id },
      data: {
        status: 'PUBLISHED',
        publishedByOpenId: SYSTEM_OPERATOR,
        publishedAt: new Date(),
        updatedByOpenId: SYSTEM_OPERATOR,
      },
    });
    return version.id;
  });

  console.log(
    `已发布配置模板 ${CONFIG_TEMPLATE_SYSTEM_KEY}（configVersionId=${versionId}，绑定 D/M 表单）`,
  );
  return versionId;
}

/**
 * 把已发布表单版本转换为周期表单快照 content（复刻 CycleSetupService.toFormSnapshotContent），
 * 保持稳定 key 生成规则一致，评估项结果据 key 定位。
 */
function toFormSnapshotContent(version: FormVersionWithContent) {
  return {
    schemaVersion: 1,
    name: version.name,
    description: version.description,
    jobLevelPrefix: version.jobLevelPrefix,
    subforms: version.subforms.map((subform) => ({
      key: `subform:${subform.type}`,
      type: subform.type,
      title: subform.title,
      description: subform.description,
      sortOrder: subform.sortOrder,
      dimensions: subform.dimensions.map((dimension) => ({
        key: `dimension:${subform.type}:${dimension.audience}:${dimension.sortOrder}`,
        kind: dimension.kind,
        audience: dimension.audience,
        name: dimension.name,
        description: dimension.description,
        weight: dimension.weight?.toString() ?? null,
        isCore: dimension.isCore,
        sortOrder: dimension.sortOrder,
        items: dimension.items.map((item) => ({
          key: `item:${subform.type}:${dimension.audience}:${dimension.sortOrder}:${item.sortOrder}`,
          type: item.type,
          title: item.title,
          description: item.description,
          placeholder: item.placeholder,
          required: item.required,
          sortOrder: item.sortOrder,
          config: item.config as LegacyFormItemConfig | null,
        })),
      })),
    })),
  };
}

/**
 * 从已发布配置模板版本创建绩效周期草稿：复刻 CycleSetupService.createFromPublishedConfig 的快照写入。
 * 周期状态固定 DRAFT，写入首个配置快照版本（version=1）与 D/M 两份表单快照，并回填 currentConfigVersionId。
 */
async function seedDraftCycle(
  prisma: PrismaClient,
  configVersionId: number,
): Promise<number> {
  const source = await prisma.perfConfigTemplateVersion.findUniqueOrThrow({
    where: { id: configVersionId },
    include: {
      formBindings: {
        orderBy: { jobLevelPrefix: 'asc' },
        include: {
          formTemplateVersion: {
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
          },
        },
      },
    },
  });

  const cycleId = await prisma.$transaction(async (tx) => {
    const cycle = await tx.perfCycle.create({
      data: {
        name: CYCLE_NAME,
        ownerOpenId: SYSTEM_OPERATOR,
        plannedStartAt: new Date(CYCLE_PLANNED_START_AT),
        status: 'DRAFT',
      },
    });
    const snapshot = await tx.perfCycleConfigVersion.create({
      data: {
        cycleId: cycle.id,
        version: 1,
        sourceConfigTemplateVersionId: source.id,
        ...toCycleConfigSnapshotData(source),
        createdByOpenId: SYSTEM_OPERATOR,
      },
    });
    // 表单快照单独写入：cycleConfigVersionId 与 cycleId 组成复合外键，显式提供两者。
    await tx.perfCycleFormSnapshot.createMany({
      data: source.formBindings.map((binding) => ({
        cycleConfigVersionId: snapshot.id,
        cycleId: cycle.id,
        jobLevelPrefix: binding.jobLevelPrefix,
        sourceFormTemplateVersionId: binding.formTemplateVersionId,
        content: inputJson(toFormSnapshotContent(binding.formTemplateVersion)),
      })),
    });
    await tx.perfCycle.update({
      where: { id: cycle.id },
      data: { currentConfigVersionId: snapshot.id },
    });
    return cycle.id;
  });

  console.log(
    `已创建绩效周期草稿「${CYCLE_NAME}」（cycleId=${cycleId}，configSnapshot 已就绪）`,
  );
  return cycleId;
}

async function main() {
  const config = loadAppConfig();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.database.url }),
  });

  try {
    await cleanupBaseline(prisma);
    const formVersionByPrefix = await seedFormTemplates(prisma);
    const configVersionId = await seedConfigTemplate(
      prisma,
      formVersionByPrefix,
    );
    await seedDraftCycle(prisma, configVersionId);
    console.log('基线数据初始化完成。');
  } finally {
    await prisma.$disconnect();
  }
}

void main();
