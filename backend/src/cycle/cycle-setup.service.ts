import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PerfCycleStatus, PerfRole } from '../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import { PrismaService } from '../shared/database/prisma.service';
import type { SchedulePreset } from '../config-template/config-template.contract';
import type {
  ConfigTemplateVersionContract,
  ConfigTemplatePublicationIssue,
  NotificationRules,
} from '../config-template/config-template.contract';
import { validateConfigTemplatePublication } from '../config-template/publication-validator';
import {
  omitPersistedConfigInternals,
  toPublicRatings,
} from '../config-template/config-template.public';
import {
  FORM_SUBFORM_TYPES,
  type FormTemplateSubformContract,
} from '../form-template/form-template.contract';
import { toPerformanceSubformContracts } from '../form-template/form-template.persistence';
import {
  generateCyclePlan,
  validateCyclePlan,
  type CyclePlan,
} from './cycle-plan';
import {
  analyzeParticipantFormMatch,
  type ParticipantFormMatch,
} from './participant-prefix';
import type {
  CreateCycleDto,
  ReapplyCycleSetupDto,
  UpdateCycleAdvancedConfigDto,
  UpsertCyclePlanDto,
} from './cycle.dto';

type DbClient = PrismaService | Prisma.TransactionClient;

export type CycleStartCheckIssue = {
  code: string;
  path: string;
  message: string;
  participantId?: number;
  employeeOpenId?: string;
};

export type CycleStartCheckItem = {
  key:
    | 'config_snapshot'
    | 'participants'
    | 'participant_prefixes'
    | 'schedule'
    | 'notifications';
  ok: boolean;
  message: string;
  issues: CycleStartCheckIssue[];
  target: 'basic' | 'participants' | 'plan' | 'advanced';
  actionLabel: string;
};

const sourceVersionInclude = {
  template: { select: { id: true } },
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
                include: { fields: { orderBy: { sortOrder: 'asc' as const } } },
              },
            },
          },
        },
      },
    },
  },
};

const cycleSetupInclude = {
  currentConfigVersion: {
    include: {
      sourceConfigVersion: {
        select: { id: true, templateId: true, name: true, version: true },
      },
      formSnapshots: { orderBy: { jobLevelPrefix: 'asc' as const } },
    },
  },
  participants: { orderBy: { id: 'asc' as const } },
};

type CycleConfigSnapshotRecord = Prisma.PerfCycleConfigVersionGetPayload<{
  include: { formSnapshots: true };
}>;

type PublishedConfigSource = Prisma.PerfConfigTemplateVersionGetPayload<{
  include: typeof sourceVersionInclude;
}>;

/**
 * 四步创建专用服务。
 * 旧周期 CRUD 暂留 CycleService；新版创建、计划、检查与待启动状态全部收口到这里。
 */
@Injectable()
export class CycleSetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly rbacService: RbacService,
  ) {}

  async createFromPublishedConfig(operatorOpenId: string, dto: CreateCycleDto) {
    if (!dto.configTemplateVersionId || !dto.plannedStartAt) {
      throw new BadRequestException(
        '创建周期必须选择已发布配置版本并填写计划启动时间',
      );
    }
    // 先验证时区与计划预设之外的基础输入，避免事务内留下含糊错误。
    if (!/(Z|[+-]\d{2}:\d{2})$/i.test(dto.plannedStartAt)) {
      throw new BadRequestException('计划启动时间必须包含时区');
    }
    const ownerOpenId = dto.ownerOpenId ?? operatorOpenId;
    if (
      ownerOpenId !== operatorOpenId &&
      !(await this.rbacService.hasAnyRole(ownerOpenId, [
        PerfRole.HR,
        PerfRole.ADMIN,
      ]))
    ) {
      throw new BadRequestException('周期负责人必须拥有 HR 或 ADMIN 角色');
    }

    const cycleId = await this.prisma.$transaction(async (tx) => {
      const source = await this.resolvePublishedSource(
        tx,
        dto.configTemplateVersionId,
        dto.plannedStartAt,
      );

      const cycle = await tx.perfCycle.create({
        data: {
          name: dto.name,
          ownerOpenId,
          plannedStartAt: new Date(dto.plannedStartAt),
          status: PerfCycleStatus.DRAFT,
        },
      });
      const snapshot = await tx.perfCycleConfigVersion.create({
        data: this.buildSnapshotCreateData(source, cycle.id, 1, operatorOpenId),
      });
      await tx.perfCycle.update({
        where: { id: cycle.id },
        data: { currentConfigVersionId: snapshot.id },
      });
      return cycle.id;
    });

    await this.auditService.record({
      operatorOpenId,
      action: 'cycle.setup.create',
      targetType: 'perf_cycle',
      targetId: String(cycleId),
      after: {
        configTemplateVersionId: dto.configTemplateVersionId,
        plannedStartAt: dto.plannedStartAt,
        status: PerfCycleStatus.DRAFT,
      },
    });
    return this.toPublicSetup(await this.getSetup(cycleId));
  }

  /**
   * 启动前重新套用已发布配置模板版本：整套覆盖当前快照的评估规则与评估维度（含四个关系权重、表单快照），
   * 不做字段级合并；日程预设与通知规则不属于复制范围，沿用当前快照原值（PRD Out of Scope）；
   * 旧配置版本保留（ADR-0026 语义），仅切换 currentConfigVersionId。
   */
  async reapplyPublishedConfig(
    operatorOpenId: string,
    cycleId: number,
    dto: ReapplyCycleSetupDto,
  ) {
    let auditPayload!: { before: unknown; after: unknown };

    await this.prisma.$transaction(async (tx) => {
      await this.lockCycle(tx, cycleId);
      const cycle = await this.getSetup(cycleId, tx);
      if (
        cycle.status !== PerfCycleStatus.DRAFT &&
        cycle.status !== PerfCycleStatus.SCHEDULED
      ) {
        throw new ConflictException('只有草稿或待启动周期允许重新套用配置模板');
      }
      const currentSnapshot = cycle.currentConfigVersion;
      if (!currentSnapshot) {
        throw new ConflictException('周期尚无配置快照，请先初始化配置快照');
      }
      if (!cycle.plannedStartAt) {
        throw new BadRequestException(
          '周期缺少计划启动时间，无法重新套用配置模板',
        );
      }

      // 重套只覆盖评估规则与评估维度（PRD Out of Scope 明确排除时间窗/通知复制）；
      // 计划校验对象因此改为「沿用当前快照的 schedulePreset」+ cycle.plannedStartAt，而非来源模板的日程预设。
      const source = await this.resolvePublishedSource(
        tx,
        dto.configTemplateVersionId,
        cycle.plannedStartAt.toISOString(),
        currentSnapshot.schedulePreset,
      );

      const snapshot = await tx.perfCycleConfigVersion.create({
        data: this.buildSnapshotCreateData(
          source,
          cycleId,
          // 周期内版本递增，旧版本不删除，版本链保留供追溯（ADR-0026）。
          currentSnapshot.version + 1,
          operatorOpenId,
          {
            // 日程预设与通知规则沿用当前快照，不随模板重套被重置（PRD 明确排除时间窗/通知复制）。
            schedulePreset: currentSnapshot.schedulePreset,
            notificationRules: currentSnapshot.notificationRules,
          },
        ),
        include: { formSnapshots: true },
      });
      await tx.perfCycle.update({
        where: { id: cycleId },
        data: { currentConfigVersionId: snapshot.id },
      });

      await this.rebindParticipantsToSnapshot(
        tx,
        cycle.participants,
        snapshot.formSnapshots,
      );

      auditPayload = {
        before: {
          sourceConfigTemplateVersionId:
            currentSnapshot.sourceConfigTemplateVersionId,
          version: currentSnapshot.version,
        },
        after: {
          sourceConfigTemplateVersionId: snapshot.sourceConfigTemplateVersionId,
          version: snapshot.version,
          coverage: ['evaluation_rule', 'dimensions'],
        },
      };
    });

    await this.auditService.record({
      operatorOpenId,
      action: 'cycle.template.apply',
      targetType: 'perf_cycle',
      targetId: String(cycleId),
      before: auditPayload.before,
      after: auditPayload.after,
    });
    return this.getConfigSnapshot(cycleId);
  }

  /**
   * 参与人重绑定：新快照写入后按 CoreHR 主数据刷新 Leader/部门快照，并按 D/M 前缀重新匹配表单。
   * initializeLegacyDraft 与 reapplyPublishedConfig 共用，行为语义保持一致。
   */
  private async rebindParticipantsToSnapshot(
    tx: Prisma.TransactionClient,
    participants: ReadonlyArray<{
      id: number;
      employeeOpenId: string;
      leaderOpenIdSnapshot: string | null;
      departmentIdSnapshot: string | null;
      jobLevelSnapshot: Prisma.JsonValue | null;
    }>,
    formSnapshots: ReadonlyArray<{
      id: number;
      jobLevelPrefix: 'D' | 'M';
    }>,
  ) {
    if (participants.length === 0) return;
    const openIds = participants.map(
      (participant) => participant.employeeOpenId,
    );
    const [users, corehrs] = await Promise.all([
      tx.larkUser.findMany({
        where: { open_id: { in: openIds } },
        select: {
          open_id: true,
          leader_user_id: true,
          department_ids: true,
        },
      }),
      tx.larkCorehrEmployee.findMany({
        where: { open_id: { in: openIds } },
        select: {
          open_id: true,
          direct_manager_id: true,
          department_id: true,
          job_level: true,
        },
      }),
    ]);
    const userMap = new Map(users.map((user) => [user.open_id, user]));
    const corehrMap = new Map(
      corehrs.map((employee) => [employee.open_id, employee]),
    );

    for (const participant of participants) {
      const user = userMap.get(participant.employeeOpenId);
      const corehr = corehrMap.get(participant.employeeOpenId);
      // CoreHR 暂缺时保留旧快照；没有任何职级则留空，由启动检查给出可操作阻塞项。
      const jobLevel =
        corehr?.job_level ?? participant.jobLevelSnapshot ?? null;
      const match = analyzeParticipantFormMatch(
        {
          id: participant.id,
          employeeOpenId: participant.employeeOpenId,
          jobLevelSnapshot: jobLevel,
        },
        formSnapshots,
      );
      await tx.perfParticipant.update({
        where: { id: participant.id },
        data: {
          leaderOpenIdSnapshot:
            corehr?.direct_manager_id ??
            user?.leader_user_id ??
            participant.leaderOpenIdSnapshot,
          departmentIdSnapshot:
            corehr?.department_id ??
            user?.department_ids?.[0] ??
            participant.departmentIdSnapshot,
          jobLevelSnapshot:
            jobLevel === null ? undefined : this.inputJson(jobLevel),
          jobLevelPrefixSnapshot:
            match.status === 'MATCHED' ? match.jobLevelPrefix : null,
          formSnapshotId:
            match.status === 'MATCHED' ? match.formSnapshotId : null,
        },
      });
    }
  }

  /**
   * 来源配置版本校验：行锁防并发修改 → 查询来源版本 → PUBLISHED 状态校验 → D/M 表单完整性校验 → 周期计划校验。
   * createFromPublishedConfig / initializeLegacyDraft / reapplyPublishedConfig 三个入口共用同一套校验，
   * 错误类型、文案与抛出顺序保持一致；仅计划锚点时间（plannedStartAtIso）来源不同。
   * schedulePresetForPlanCheck 默认取来源版本的日程预设；reapplyPublishedConfig 传入当前快照的日程预设，
   * 因为重套不复制来源模板的日程（PRD Out of Scope），计划校验必须针对实际会写入新快照的值。
   */
  private async resolvePublishedSource(
    tx: Prisma.TransactionClient,
    configTemplateVersionId: number,
    plannedStartAtIso: string,
    schedulePresetForPlanCheck?: Prisma.JsonValue,
  ): Promise<PublishedConfigSource> {
    await tx.$queryRaw`SELECT "id" FROM "performance"."perf_config_template_versions" WHERE "id" = ${configTemplateVersionId} FOR SHARE`;
    const source = await tx.perfConfigTemplateVersion.findUnique({
      where: { id: configTemplateVersionId },
      include: sourceVersionInclude,
    });
    if (!source || source.status !== 'PUBLISHED') {
      throw new BadRequestException('配置模板版本未发布或已不可用');
    }
    const prefixes = source.formBindings.map(
      (binding) => binding.jobLevelPrefix,
    );
    if (
      source.formBindings.length !== 2 ||
      !prefixes.includes('D') ||
      !prefixes.includes('M')
    ) {
      throw new BadRequestException('配置模板版本未完整覆盖 D/M 表单');
    }

    const plan = generateCyclePlan(
      plannedStartAtIso,
      (schedulePresetForPlanCheck ??
        source.schedulePreset) as unknown as SchedulePreset,
    );
    const planIssues = validateCyclePlan(plan);
    if (planIssues.length > 0) {
      throw new BadRequestException({
        code: 'CONFIG_SCHEDULE_INVALID',
        message: '配置模板计划不可用',
        issues: planIssues,
      });
    }

    return source;
  }

  /**
   * 周期配置快照写入载荷：字段默认均从来源版本值复制（JSON 字段经 inputJson 深拷贝，避免与来源共享引用）。
   * createFromPublishedConfig / initializeLegacyDraft 不传 overrides，日程预设与通知规则随来源模板一起复制（ADR-0023）；
   * reapplyPublishedConfig 传入 overrides，让日程预设与通知规则沿用当前快照而非来源模板（PRD Out of Scope 排除时间窗/通知复制）。
   */
  private buildSnapshotCreateData(
    source: PublishedConfigSource,
    cycleId: number,
    version: number,
    operatorOpenId: string,
    overrides?: {
      schedulePreset: Prisma.JsonValue;
      notificationRules: Prisma.JsonValue;
    },
  ) {
    return {
      // 使用 checked relation connect，避免与嵌套 formSnapshots 混用时 Prisma
      // 把载荷判为 checked input 后拒绝裸 cycleId 标量。
      cycle: { connect: { id: cycleId } },
      version,
      sourceConfigVersion: { connect: { id: source.id } },
      ratings: this.inputJson(toPublicRatings(source.ratings)),
      orgOwnerWeight: source.orgOwnerWeight,
      projectOwnerWeight: source.projectOwnerWeight,
      peerWeight: source.peerWeight,
      crossDeptWeight: source.crossDeptWeight,
      schedulePreset: this.inputJson(
        overrides?.schedulePreset ?? source.schedulePreset,
      ),
      notificationRules: this.inputJson(
        overrides?.notificationRules ?? source.notificationRules,
      ),
      createdByOpenId: operatorOpenId,
      formSnapshots: {
        create: source.formBindings.map((binding) => ({
          jobLevelPrefix: binding.jobLevelPrefix,
          // cycleId 属于 configVersion 复合关系的一部分，嵌套创建时由父关系自动带入；
          // 此处只显式连接另一条必填关系，避免 Prisma 将嵌套载荷判为非法输入。
          sourceFormVersion: {
            connect: { id: binding.formTemplateVersionId },
          },
          content: this.inputJson(
            this.toFormSnapshotContent(binding.formTemplateVersion),
          ),
        })),
      },
    };
  }

  async getSetup(cycleId: number, client: DbClient = this.prisma) {
    const cycle = await client.perfCycle.findFirst({
      where: { id: cycleId, deletedAt: null },
      include: cycleSetupInclude,
    });
    if (!cycle) throw new NotFoundException('绩效周期不存在');
    return cycle;
  }

  async getConfigSnapshot(cycleId: number) {
    const cycle = await this.getSetup(cycleId);
    const snapshot = cycle.currentConfigVersion;
    if (!snapshot) throw new NotFoundException('周期配置快照不存在');
    return {
      id: snapshot.id,
      cycleId: snapshot.cycleId,
      sourceConfigTemplateVersionId: snapshot.sourceConfigTemplateVersionId,
      source: snapshot.sourceConfigVersion,
      version: snapshot.version,
      // 快照行只有创建（create/reapply 产生新行）与手动编辑（updateAdvancedConfig/updatePlan 原地更新）两类写入；
      // updatedAt 晚于 createdAt 说明创建/最近重套之后被手动调整过，前端据此决定重套前是否弹覆盖确认。
      manuallyModified:
        snapshot.updatedAt.getTime() > snapshot.createdAt.getTime(),
      forms: snapshot.formSnapshots.map((form) => ({
        id: form.id,
        jobLevelPrefix: form.jobLevelPrefix,
        sourceFormTemplateVersionId: form.sourceFormTemplateVersionId,
        content: form.content,
      })),
      ratings: toPublicRatings(snapshot.ratings),
      reviewerRelationWeights: {
        ORG_OWNER: snapshot.orgOwnerWeight.toString(),
        PROJECT_OWNER: snapshot.projectOwnerWeight.toString(),
        PEER: snapshot.peerWeight.toString(),
        CROSS_DEPT: snapshot.crossDeptWeight.toString(),
      },
      notificationRules: snapshot.notificationRules,
      allowStageOverlap: (
        snapshot.schedulePreset as { allowStageOverlap?: boolean }
      ).allowStageOverlap,
    };
  }

  async updateAdvancedConfig(
    operatorOpenId: string,
    cycleId: number,
    dto: UpdateCycleAdvancedConfigDto,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockCycle(tx, cycleId);
      const cycle = await this.getSetup(cycleId, tx);
      if (
        cycle.status !== PerfCycleStatus.DRAFT &&
        cycle.status !== PerfCycleStatus.SCHEDULED
      ) {
        throw new ConflictException('只有草稿或待启动周期允许调整高级配置');
      }
      const snapshot = cycle.currentConfigVersion;
      if (!snapshot) throw new ConflictException('周期配置快照不存在');
      const issues = this.validateConfigContract(
        this.toConfigContract(snapshot, dto),
      );
      if (issues.length > 0) {
        throw new BadRequestException({
          code: 'CYCLE_ADVANCED_CONFIG_INVALID',
          message: '周期高级配置校验失败',
          issues,
        });
      }
      await tx.perfCycleConfigVersion.update({
        where: { id: snapshot.id },
        data: {
          ratings: this.inputJson(toPublicRatings(dto.ratings)),
          orgOwnerWeight: dto.reviewerRelationWeights.ORG_OWNER,
          projectOwnerWeight: dto.reviewerRelationWeights.PROJECT_OWNER,
          peerWeight: dto.reviewerRelationWeights.PEER,
          crossDeptWeight: dto.reviewerRelationWeights.CROSS_DEPT,
        },
      });
    });
    await this.auditService.record({
      operatorOpenId,
      action: 'cycle.advanced_config.update',
      targetType: 'perf_cycle',
      targetId: String(cycleId),
      after: dto,
    });
    return this.getConfigSnapshot(cycleId);
  }

  async getParticipantPrefixCheck(
    cycleId: number,
    client: DbClient = this.prisma,
  ): Promise<{
    ok: boolean;
    items: Array<
      ParticipantFormMatch & {
        formTemplateVersionId?: number;
        formTemplateName?: string;
      }
    >;
  }> {
    const cycle = await this.getSetup(cycleId, client);
    const forms = cycle.currentConfigVersion?.formSnapshots ?? [];
    const items = cycle.participants.map((participant) => {
      const match = analyzeParticipantFormMatch(participant, forms);
      const form = forms.find(
        (candidate) => candidate.id === match.formSnapshotId,
      );
      const content = form?.content as { name?: unknown } | undefined;
      return {
        ...match,
        formTemplateVersionId: form?.sourceFormTemplateVersionId,
        formTemplateName:
          typeof content?.name === 'string' ? content.name : undefined,
      };
    });
    return {
      ok: items.length > 0 && items.every((item) => item.status === 'MATCHED'),
      items,
    };
  }

  async getPlan(cycleId: number) {
    const cycle = await this.getSetup(cycleId);
    const snapshot = cycle.currentConfigVersion;
    if (!snapshot || !cycle.plannedStartAt) {
      throw new NotFoundException('周期计划不存在');
    }
    const plan = generateCyclePlan(
      cycle.plannedStartAt.toISOString(),
      snapshot.schedulePreset as unknown as SchedulePreset,
    );
    return { ...plan, notificationRules: snapshot.notificationRules };
  }

  async updatePlan(
    operatorOpenId: string,
    cycleId: number,
    dto: UpsertCyclePlanDto,
  ) {
    const plan: CyclePlan = {
      allowStageOverlap: dto.allowStageOverlap,
      stages: dto.stages,
    };
    const issues = validateCyclePlan(plan);
    if (issues.length > 0) {
      throw new BadRequestException({
        code: 'CYCLE_PLAN_INVALID',
        message: '周期计划校验失败',
        issues,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await this.lockCycle(tx, cycleId);
      const cycle = await this.requireEditableSetup(cycleId, tx);
      if (!cycle.plannedStartAt || !cycle.currentConfigVersionId) {
        throw new ConflictException('周期缺少计划锚点或配置快照');
      }
      const anchor = cycle.plannedStartAt.getTime();
      const schedulePreset = {
        allowStageOverlap: dto.allowStageOverlap,
        stages: dto.stages.map((row) => ({
          stage: row.stage,
          startOffsetMinutes: this.toMinuteOffset(anchor, row.startAt),
          reminderDeadlineOffsetMinutes: this.toMinuteOffset(
            anchor,
            row.reminderDeadlineAt,
          ),
        })),
      } satisfies SchedulePreset;
      await tx.perfCycleConfigVersion.update({
        where: { id: cycle.currentConfigVersionId },
        data: {
          schedulePreset: this.inputJson(schedulePreset),
          notificationRules: this.inputJson(dto.notificationRules),
        },
      });
    });

    await this.auditService.record({
      operatorOpenId,
      action: 'cycle.plan.update',
      targetType: 'perf_cycle',
      targetId: String(cycleId),
      after: dto,
    });
    return this.getPlan(cycleId);
  }

  async startCheck(
    cycleId: number,
    client: DbClient = this.prisma,
  ): Promise<{ items: CycleStartCheckItem[]; ok: boolean }> {
    const cycle = await this.getSetup(cycleId, client);
    const snapshot = cycle.currentConfigVersion;
    const publicationIssues = snapshot
      ? this.validateConfigContract(this.toConfigContract(snapshot))
      : [];
    const configIssues: CycleStartCheckIssue[] = snapshot
      ? publicationIssues
          .filter(
            (issue) =>
              !issue.path.startsWith('notificationRules') &&
              !issue.path.startsWith('schedulePreset'),
          )
          .map((issue) => this.publicationIssue(issue))
      : [
          {
            code: 'CONFIG_SNAPSHOT_MISSING',
            path: 'currentConfigVersionId',
            message: '周期配置快照缺失，请重新创建周期',
          },
        ];
    const participantIssues: CycleStartCheckIssue[] =
      cycle.participants.length > 0
        ? []
        : [
            {
              code: 'PARTICIPANTS_EMPTY',
              path: 'participants',
              message: '尚未添加考核人员',
            },
          ];
    const prefixCheck = await this.getParticipantPrefixCheck(cycleId, client);
    const prefixIssues = prefixCheck.items
      .filter((item) => item.status !== 'MATCHED')
      .map((item) => ({
        code: `PARTICIPANT_${item.status}`,
        path: `participants.${item.participantId}.jobLevel`,
        message: item.message,
        participantId: item.participantId,
        employeeOpenId: item.employeeOpenId,
      }));
    let scheduleIssues: CycleStartCheckIssue[] = [];
    if (!cycle.plannedStartAt || !snapshot) {
      scheduleIssues = [
        {
          code: 'SCHEDULE_MISSING',
          path: 'plannedStartAt',
          message: '计划启动时间或周期计划缺失',
        },
      ];
    } else {
      scheduleIssues = validateCyclePlan(
        generateCyclePlan(
          cycle.plannedStartAt.toISOString(),
          snapshot.schedulePreset as unknown as SchedulePreset,
        ),
      );
      scheduleIssues.push(
        ...publicationIssues
          .filter((issue) => issue.path.startsWith('schedulePreset'))
          .map((issue) => this.publicationIssue(issue)),
      );
    }
    const notificationIssues = publicationIssues
      .filter((issue) => issue.path.startsWith('notificationRules'))
      .map((issue) => this.publicationIssue(issue));

    const items: CycleStartCheckItem[] = [
      this.checkItem(
        'config_snapshot',
        configIssues,
        '配置快照完整',
        'advanced',
        '查看高级配置',
      ),
      this.checkItem(
        'participants',
        participantIssues,
        `已添加 ${cycle.participants.length} 名考核人员`,
        'participants',
        '添加考核人员',
      ),
      this.checkItem(
        'participant_prefixes',
        prefixIssues,
        '所有参与人均已唯一匹配 D/M 表单',
        'participants',
        '修复职级主数据',
      ),
      this.checkItem(
        'schedule',
        scheduleIssues,
        '三阶段计划校验通过',
        'plan',
        '调整计划',
      ),
      this.checkItem(
        'notifications',
        notificationIssues,
        '通知规则校验通过',
        'plan',
        '调整通知',
      ),
    ];
    return { items, ok: items.every((item) => item.ok) };
  }

  async schedule(operatorOpenId: string, cycleId: number) {
    let changed = false;
    await this.prisma.$transaction(async (tx) => {
      await this.lockCycle(tx, cycleId);
      const cycle = await this.getSetup(cycleId, tx);
      if (cycle.status === PerfCycleStatus.SCHEDULED) return;
      if (cycle.status !== PerfCycleStatus.DRAFT) {
        throw new ConflictException(
          `周期状态 ${cycle.status} 不允许设为待启动`,
        );
      }
      const check = await this.startCheck(cycleId, tx);
      if (!check.ok) {
        throw new BadRequestException({
          code: 'CYCLE_START_CHECK_FAILED',
          message: '启动检查未通过',
          items: check.items,
        });
      }
      // Ticket 04 只切换粗粒度状态，任务和通知由 Ticket 05 的原子启动创建。
      await tx.perfCycle.update({
        where: { id: cycleId },
        data: { status: PerfCycleStatus.SCHEDULED },
      });
      changed = true;
    });
    if (changed) {
      await this.auditService.record({
        operatorOpenId,
        action: 'cycle.schedule',
        targetType: 'perf_cycle',
        targetId: String(cycleId),
        before: { status: PerfCycleStatus.DRAFT },
        after: { status: PerfCycleStatus.SCHEDULED },
      });
    }
    return {
      changed,
      cycle: this.toPublicSetup(await this.getSetup(cycleId)),
    };
  }

  async returnToDraft(operatorOpenId: string, cycleId: number) {
    let changed = false;
    await this.prisma.$transaction(async (tx) => {
      await this.lockCycle(tx, cycleId);
      const cycle = await this.getSetup(cycleId, tx);
      if (cycle.status === PerfCycleStatus.DRAFT) return;
      if (cycle.status !== PerfCycleStatus.SCHEDULED) {
        throw new ConflictException(`周期状态 ${cycle.status} 不允许退回草稿`);
      }
      await tx.perfCycle.update({
        where: { id: cycleId },
        data: { status: PerfCycleStatus.DRAFT },
      });
      changed = true;
    });
    if (changed) {
      await this.auditService.record({
        operatorOpenId,
        action: 'cycle.return_to_draft',
        targetType: 'perf_cycle',
        targetId: String(cycleId),
        before: { status: PerfCycleStatus.SCHEDULED },
        after: { status: PerfCycleStatus.DRAFT },
      });
    }
    return {
      changed,
      cycle: this.toPublicSetup(await this.getSetup(cycleId)),
    };
  }

  private async requireEditableSetup(cycleId: number, client: DbClient) {
    const cycle = await client.perfCycle.findFirst({
      where: { id: cycleId, deletedAt: null },
    });
    if (!cycle) throw new NotFoundException('绩效周期不存在');
    if (
      cycle.status !== PerfCycleStatus.DRAFT &&
      cycle.status !== PerfCycleStatus.SCHEDULED
    ) {
      throw new ConflictException('只有草稿或待启动周期允许调整');
    }
    return cycle;
  }

  private async lockCycle(tx: Prisma.TransactionClient, cycleId: number) {
    await tx.$queryRaw`SELECT "id" FROM "performance"."perf_cycles" WHERE "id" = ${cycleId} AND "deleted_at" IS NULL FOR UPDATE`;
  }

  private checkItem(
    key: CycleStartCheckItem['key'],
    issues: CycleStartCheckIssue[],
    successMessage: string,
    target: CycleStartCheckItem['target'],
    actionLabel: string,
  ): CycleStartCheckItem {
    return {
      key,
      ok: issues.length === 0,
      message: issues.length === 0 ? successMessage : issues[0].message,
      issues,
      target,
      actionLabel,
    };
  }

  private publicationIssue(
    issue: ConfigTemplatePublicationIssue,
  ): CycleStartCheckIssue {
    return { code: issue.code, path: issue.path, message: issue.message };
  }

  private validateConfigContract(
    contract: ConfigTemplateVersionContract,
  ): ConfigTemplatePublicationIssue[] {
    try {
      return validateConfigTemplatePublication(contract);
    } catch {
      // 历史或直接数据库写入的畸形 JSON 也必须转成可操作检查项，不能让启动检查 500。
      return [
        {
          code: 'CONFIG_SNAPSHOT_MALFORMED',
          path: 'configSnapshot',
          message: '周期配置快照结构损坏，请重新创建周期或联系管理员修复',
        },
      ];
    }
  }

  private toConfigContract(
    snapshot: CycleConfigSnapshotRecord,
    advanced?: UpdateCycleAdvancedConfigDto,
  ): ConfigTemplateVersionContract {
    return {
      name: '周期配置快照',
      ratings: toPublicRatings(advanced?.ratings ?? snapshot.ratings),
      reviewerRelationWeights: advanced?.reviewerRelationWeights ?? {
        ORG_OWNER: snapshot.orgOwnerWeight.toString(),
        PROJECT_OWNER: snapshot.projectOwnerWeight.toString(),
        PEER: snapshot.peerWeight.toString(),
        CROSS_DEPT: snapshot.crossDeptWeight.toString(),
      },
      formBindings: snapshot.formSnapshots.map((form) => ({
        formTemplateVersionId: form.sourceFormTemplateVersionId,
        // 周期已持有独立内容；来源后来归档不应让快照失效。
        status: 'PUBLISHED',
        jobLevelPrefix: form.jobLevelPrefix,
        subforms: ((form.content as { subforms?: unknown }).subforms ??
          []) as FormTemplateSubformContract[],
      })),
      schedulePreset: snapshot.schedulePreset as unknown as SchedulePreset,
      notificationRules:
        snapshot.notificationRules as unknown as NotificationRules,
    };
  }

  private toMinuteOffset(anchor: number, value: string): number {
    const time = Date.parse(value);
    const minutes = (time - anchor) / 60_000;
    if (!Number.isInteger(minutes) || minutes < 0) {
      throw new BadRequestException(
        '阶段时间必须按整分钟设置且不能早于计划启动时间',
      );
    }
    return minutes;
  }

  private toFormSnapshotContent(
    version: Prisma.PerfFormTemplateVersionGetPayload<{
      include: typeof sourceVersionInclude.formBindings.include.formTemplateVersion.include;
    }>,
  ) {
    const subforms = toPerformanceSubformContracts(version.subforms);

    return {
      // v2 快照与新版模板采用同一“维度 + 字段”层级，并直接继承稳定业务 key。
      schemaVersion: 2,
      name: version.name,
      description: version.description,
      jobLevelPrefix: version.jobLevelPrefix,
      subforms: subforms
        .filter((subform) => FORM_SUBFORM_TYPES.includes(subform.type))
        .map((subform) => ({
          key: `subform:${subform.type}`,
          type: subform.type,
          title: subform.title,
          description: subform.description,
          sortOrder: subform.sortOrder,
          dimensions: subform.dimensions.map((dimension) => ({
            sourceDimensionId: dimension.id,
            key: dimension.key,
            type: dimension.type,
            audience: dimension.audience,
            name: dimension.name,
            description: dimension.description,
            scoringMethod: dimension.scoringMethod ?? null,
            weight:
              dimension.type === 'SCORING' && dimension.weight != null
                ? dimension.weight.toString()
                : null,
            isCore: dimension.isCore,
            sortOrder: dimension.sortOrder,
            fields: dimension.fields.map((field) => ({
              sourceFieldId: field.id,
              key: field.key,
              type: field.type,
              title: field.title,
              description: field.description,
              placeholder: field.placeholder,
              requiredRule: field.requiredRule,
              requiredLevels: [...field.requiredLevels],
              sortOrder: field.sortOrder,
              config: field.config ?? null,
            })),
          })),
        })),
    };
  }

  private inputJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private toPublicSetup<T extends { currentConfigVersion?: unknown }>(
    cycle: T,
  ) {
    const current = cycle.currentConfigVersion as
      (Record<string, unknown> & { ratings?: unknown }) | null | undefined;
    if (!current) return cycle;
    const ratings = current.ratings;
    const publicCurrent = omitPersistedConfigInternals(current);
    return {
      ...cycle,
      currentConfigVersion: {
        ...publicCurrent,
        ratings: toPublicRatings(ratings),
      },
    };
  }
}
