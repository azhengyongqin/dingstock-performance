import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import {
  PerfCycleStatus,
  PerfParticipantStatus,
} from '../generated/prisma/enums';
import { PrismaService } from '../shared/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import { assertCycleTransition } from './cycle-state';
import { normalizeEvaluationRule } from './evaluation-rule';
import { getCycleCreationUnavailableReasons } from './template-usability';
import type {
  AdvanceCycleDto,
  ApplyTemplateDto,
  DimensionItemDto,
  UpdateCycleDto,
  UpsertDimensionsDto,
  UpsertEvaluationRuleDto,
} from './cycle.dto';

/** 启动前检查项：返回给前端"启动前检查"步骤逐条展示 */
export type StartCheckItem = { key: string; ok: boolean; message: string };

@Injectable()
export class CycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly rbacService: RbacService,
  ) {}

  // ---------------------------------------------------------------------
  // 查询
  // ---------------------------------------------------------------------

  async listCycles(status?: PerfCycleStatus) {
    const where: Prisma.PerfCycleWhereInput = {
      deletedAt: null,
      status: status || undefined,
    };
    const items = await this.prisma.perfCycle.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      include: { _count: { select: { participants: true, dimensions: true } } },
    });
    return { items, total: items.length };
  }

  async getCycle(id: number) {
    const cycle = await this.prisma.perfCycle.findFirst({
      where: { id, deletedAt: null },
      include: {
        evaluationRule: true,
        dimensions: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        },
        template: { select: { id: true, name: true } },
        _count: { select: { participants: true } },
      },
    });
    if (!cycle) throw new NotFoundException('绩效周期不存在');
    return cycle;
  }

  /** 仅返回裸周期行（内部用） */
  async requireCycle(id: number) {
    const cycle = await this.prisma.perfCycle.findFirst({
      where: { id, deletedAt: null },
    });
    if (!cycle) throw new NotFoundException('绩效周期不存在');
    return cycle;
  }

  /**
   * 配置可编辑校验（角色感知）：
   * - ADMIN：除已归档外的任何状态都可编辑进行中周期的每个步骤；
   * - 其余（HR）：仅 DRAFT/SCHEDULED 可编辑。
   */
  private async assertEditable(
    status: PerfCycleStatus,
    operatorOpenId: string,
  ) {
    if (await this.rbacService.isAdmin(operatorOpenId)) {
      if (status === PerfCycleStatus.ARCHIVED) {
        throw new ConflictException('周期已归档，配置不可修改');
      }
      return;
    }
    if (
      status !== PerfCycleStatus.DRAFT &&
      status !== PerfCycleStatus.SCHEDULED
    ) {
      throw new ConflictException('周期已启动，配置不可修改');
    }
  }

  /** 进行中（可能已产生评估数据）：ACTIVE */
  private isInProgress(status: PerfCycleStatus) {
    return status === PerfCycleStatus.ACTIVE;
  }

  /** 新版周期以 currentConfigVersion 为唯一权威源，旧写接口不得静默写入废弃字段。 */
  private assertLegacyConfigPath(cycle: {
    currentConfigVersionId?: number | null;
  }) {
    if (cycle.currentConfigVersionId != null) {
      throw new ConflictException(
        '新版周期请使用计划或高级配置接口，旧配置接口不会修改周期快照',
      );
    }
  }

  /**
   * 周期级「已产生评估数据」统计（用于破坏性修改二次确认的 impact）。
   * 维度与评分是 JSON 逻辑引用、无外键，故按周期整体计数，宁可多提示。
   */
  private async collectDataImpact(cycleId: number) {
    const [selfReviews, reviews, managerReviews, calibrations, results] =
      await Promise.all([
        this.prisma.perfSelfReview.count({
          where: { participant: { cycleId } },
        }),
        this.prisma.perfReview.count({ where: { participant: { cycleId } } }),
        this.prisma.perfManagerReview.count({
          where: { participant: { cycleId } },
        }),
        this.prisma.perfCalibration.count({
          where: { participant: { cycleId } },
        }),
        this.prisma.perfResult.count({ where: { participant: { cycleId } } }),
      ]);
    return { selfReviews, reviews, managerReviews, calibrations, results };
  }

  /**
   * 破坏性修改二次确认：进行中周期、已产生数据、且未确认时，抛结构化 409
   * （code=DESTRUCTIVE_EDIT_REQUIRES_CONFIRM + impact），前端确认后带 confirm 重放。
   */
  private async assertDestructiveConfirmed(
    cycleId: number,
    changes: string[],
    confirm: boolean | undefined,
  ) {
    if (changes.length === 0 || confirm) return;
    const affectedData = await this.collectDataImpact(cycleId);
    // 尚无任何已产生数据：删除/改权重不会伤害历史，直接放行
    if (!Object.values(affectedData).some((count) => count > 0)) return;
    throw new ConflictException({
      code: 'DESTRUCTIVE_EDIT_REQUIRES_CONFIRM',
      message: '该修改会影响已产生的评估数据，请确认后继续',
      impact: { changes, affectedData },
    });
  }

  /** 比对维度变更，识别破坏性项（删除、改权重/计分方式/类型） */
  private detectDimensionDestructiveChanges(
    existing: {
      id: number;
      name: string;
      weight: unknown;
      scoringMethod: string;
      type: string;
    }[],
    items: DimensionItemDto[],
    keptIds: Set<number>,
  ): string[] {
    const changes: string[] = [];
    for (const dim of existing) {
      if (!keptIds.has(dim.id)) changes.push(`删除维度「${dim.name}」`);
    }
    const byId = new Map(existing.map((dim) => [dim.id, dim]));
    for (const item of items) {
      if (!item.id) continue;
      const prev = byId.get(item.id);
      if (!prev) continue;
      const prevWeight = prev.weight == null ? null : Number(prev.weight);
      const nextWeight = item.weight == null ? null : Number(item.weight);
      if (prevWeight !== nextWeight) {
        changes.push(
          `调整维度「${prev.name}」权重 ${prevWeight ?? '空'}→${nextWeight ?? '空'}`,
        );
      }
      if (prev.scoringMethod !== item.scoringMethod) {
        changes.push(`调整维度「${prev.name}」计分方式`);
      }
      if (prev.type !== item.type) {
        changes.push(`调整维度「${prev.name}」类型`);
      }
    }
    return changes;
  }

  // ---------------------------------------------------------------------
  // 周期 CRUD
  // ---------------------------------------------------------------------

  async updateCycle(operatorOpenId: string, id: number, dto: UpdateCycleDto) {
    const cycle = await this.requireCycle(id);
    await this.assertEditable(cycle.status, operatorOpenId);
    const updated = await this.prisma.perfCycle.update({
      where: { id },
      data: {
        name: dto.name,
        plannedStartAt: dto.plannedStartAt
          ? new Date(dto.plannedStartAt)
          : undefined,
        ownerOpenId: dto.ownerOpenId,
      },
    });
    await this.auditService.record({
      operatorOpenId,
      action: 'cycle.update',
      targetType: 'perf_cycle',
      targetId: String(id),
      before: cycle,
      after: updated,
      reason: this.isInProgress(cycle.status) ? '管理员进行中编辑' : undefined,
    });
    return updated;
  }

  async deleteCycle(operatorOpenId: string, id: number) {
    const cycle = await this.requireCycle(id);
    if (cycle.status !== PerfCycleStatus.DRAFT) {
      throw new ConflictException('仅草稿状态的周期允许删除');
    }
    await this.prisma.perfCycle.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.auditService.record({
      operatorOpenId,
      action: 'cycle.delete',
      targetType: 'perf_cycle',
      targetId: String(id),
      before: cycle,
    });
    return { ok: true };
  }

  // ---------------------------------------------------------------------
  // 配置子资源
  // ---------------------------------------------------------------------

  async upsertEvaluationRule(
    operatorOpenId: string,
    cycleId: number,
    dto: UpsertEvaluationRuleDto,
  ) {
    const cycle = await this.requireCycle(cycleId);
    this.assertLegacyConfigPath(cycle);
    await this.assertEditable(cycle.status, operatorOpenId);
    const evaluationRule = normalizeEvaluationRule(dto);
    // 进行中改评级区间会使已提交评分/初评评级口径失效 → 破坏性，需确认
    if (this.isInProgress(cycle.status)) {
      const current = await this.prisma.perfEvaluationRule.findUnique({
        where: { cycleId },
      });
      const changed =
        !!current &&
        JSON.stringify(current.levels) !==
          JSON.stringify(evaluationRule.levels);
      await this.assertDestructiveConfirmed(
        cycleId,
        changed ? ['修改评级区间定义'] : [],
        dto.confirm,
      );
    }
    const rule = await this.prisma.perfEvaluationRule.upsert({
      where: { cycleId },
      create: {
        cycleId,
        levels: evaluationRule.levels,
        commentRequiredRules: evaluationRule.commentRequiredRules,
      },
      update: {
        levels: evaluationRule.levels,
        commentRequiredRules: evaluationRule.commentRequiredRules,
      },
    });
    await this.auditService.record({
      operatorOpenId,
      action: 'cycle.evaluation_rule.upsert',
      targetType: 'perf_cycle',
      targetId: String(cycleId),
      after: rule,
      reason: this.isInProgress(cycle.status) ? '管理员进行中编辑' : undefined,
    });
    return rule;
  }

  /**
   * 整体覆盖式维护维度列表：带 id 更新、不带 id 新增、缺席的软删除。
   * 周期启动后禁止增删（已产生评估数据），仅允许 DRAFT/SCHEDULED 修改。
   */
  async upsertDimensions(
    operatorOpenId: string,
    cycleId: number,
    dto: UpsertDimensionsDto,
  ) {
    const cycle = await this.requireCycle(cycleId);
    this.assertLegacyConfigPath(cycle);
    await this.assertEditable(cycle.status, operatorOpenId);

    const existing = await this.prisma.perfDimension.findMany({
      where: { cycleId, deletedAt: null },
    });
    const keptIds = new Set(
      dto.items.filter((item) => item.id).map((item) => item.id!),
    );

    // 进行中删除维度或改权重/计分方式/类型 → 破坏性，需确认
    if (this.isInProgress(cycle.status)) {
      await this.assertDestructiveConfirmed(
        cycleId,
        this.detectDimensionDestructiveChanges(existing, dto.items, keptIds),
        dto.confirm,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // 缺席的软删除
      const removed = existing.filter((dim) => !keptIds.has(dim.id));
      if (removed.length > 0) {
        await tx.perfDimension.updateMany({
          where: { id: { in: removed.map((dim) => dim.id) } },
          data: { deletedAt: new Date() },
        });
      }
      for (const [index, item] of dto.items.entries()) {
        const data = this.dimensionData(item, index);
        if (item.id) {
          if (!existing.some((dim) => dim.id === item.id)) {
            throw new BadRequestException(`维度 #${item.id} 不属于本周期`);
          }
          await tx.perfDimension.update({ where: { id: item.id }, data });
        } else {
          await tx.perfDimension.create({ data: { ...data, cycleId } });
        }
      }
    });

    await this.auditService.record({
      operatorOpenId,
      action: 'cycle.dimensions.upsert',
      targetType: 'perf_cycle',
      targetId: String(cycleId),
      after: { count: dto.items.length },
      reason: this.isInProgress(cycle.status) ? '管理员进行中编辑' : undefined,
    });
    return this.getCycle(cycleId);
  }

  private dimensionData(item: DimensionItemDto, index: number) {
    return {
      name: item.name,
      type: item.type,
      scoringMethod: item.scoringMethod,
      weight: item.weight,
      required: item.required ?? true,
      sortOrder: item.sortOrder ?? index,
      visibleRoles: item.visibleRoles ?? [],
      editableRoles: item.editableRoles ?? [],
      formSchema: item.formSchema as Prisma.InputJsonValue | undefined,
      applicableScope: item.applicableScope as
        Prisma.InputJsonValue | undefined,
      conclusionOptions: item.conclusionOptions as unknown as
        Prisma.InputJsonValue | undefined,
      employeeVisible: item.employeeVisible,
    };
  }

  async applyTemplate(
    operatorOpenId: string,
    cycleId: number,
    dto: ApplyTemplateDto,
  ) {
    const cycle = await this.requireCycle(cycleId);
    this.assertLegacyConfigPath(cycle);
    await this.assertEditable(cycle.status, operatorOpenId);
    // 重新套用模板整体覆盖评估规则与评估维度，进行中必然破坏性
    if (this.isInProgress(cycle.status)) {
      await this.assertDestructiveConfirmed(
        cycleId,
        ['重新套用模板将整体覆盖评估规则与评估维度'],
        dto.confirm,
      );
    }

    const template = await this.prisma.$transaction(async (tx) => {
      const found = await tx.perfTemplate.findFirst({
        where: { id: dto.templateId, deletedAt: null },
        include: { dimensions: true },
      });
      if (!found) throw new NotFoundException('配置模板不存在');

      const unavailableReasons = getCycleCreationUnavailableReasons(found);
      if (unavailableReasons.length > 0) {
        throw new BadRequestException(
          `配置模板不可用于创建周期：${unavailableReasons.join('；')}`,
        );
      }

      await tx.perfEvaluationRule.upsert({
        where: { cycleId },
        create: {
          cycleId,
          levels: found.levels as Prisma.InputJsonValue,
          commentRequiredRules: found.commentRequiredRules ?? undefined,
        },
        update: {
          levels: found.levels as Prisma.InputJsonValue,
          commentRequiredRules: found.commentRequiredRules ?? undefined,
        },
      });
      // 重新套用模板是整套覆盖动作：旧维度软删，新维度按模板重新复制。
      await tx.perfDimension.updateMany({
        where: { cycleId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      await tx.perfDimension.createMany({
        data: found.dimensions.map((dim) => ({
          cycleId,
          name: dim.name,
          type: dim.type,
          scoringMethod: dim.scoringMethod,
          weight: dim.weight,
          required: dim.required,
          sortOrder: dim.sortOrder,
          visibleRoles: dim.visibleRoles,
          editableRoles: dim.editableRoles,
          formSchema: dim.formSchema ?? undefined,
          applicableScope: dim.applicableScope ?? undefined,
          conclusionOptions: dim.conclusionOptions ?? undefined,
          employeeVisible: dim.employeeVisible,
        })),
      });
      await tx.perfCycle.update({
        where: { id: cycleId },
        data: { templateId: found.id },
      });

      return found;
    });

    await this.auditService.record({
      operatorOpenId,
      action: 'cycle.template.apply',
      targetType: 'perf_cycle',
      targetId: String(cycleId),
      before: { templateId: cycle.templateId },
      after: {
        templateId: template.id,
        coverage: ['evaluation_rule', 'dimensions'],
        dimensions: template.dimensions.length,
      },
      reason: this.isInProgress(cycle.status) ? '管理员进行中编辑' : undefined,
    });
    return this.getCycle(cycleId);
  }

  async updateWindows(
    operatorOpenId: string,
    cycleId: number,
    windows: Record<string, unknown>,
  ) {
    const cycle = await this.requireCycle(cycleId);
    this.assertLegacyConfigPath(cycle);
    // 窗口允许启动后调整（延长窗口是产品定义的异常处理手段，产品 §5.8），必须写审计
    const updated = await this.prisma.perfCycle.update({
      where: { id: cycleId },
      data: { windows: windows as Prisma.InputJsonValue },
    });
    await this.auditService.record({
      operatorOpenId,
      action: 'cycle.windows.update',
      targetType: 'perf_cycle',
      targetId: String(cycleId),
      after: windows,
    });
    return updated;
  }

  async updateNotificationRules(
    operatorOpenId: string,
    cycleId: number,
    rules: Record<string, unknown>,
  ) {
    const cycle = await this.requireCycle(cycleId);
    this.assertLegacyConfigPath(cycle);
    const updated = await this.prisma.perfCycle.update({
      where: { id: cycleId },
      data: { notificationRules: rules as Prisma.InputJsonValue },
    });
    await this.auditService.record({
      operatorOpenId,
      action: 'cycle.notification_rules.update',
      targetType: 'perf_cycle',
      targetId: String(cycleId),
      after: rules,
    });
    return updated;
  }

  // ---------------------------------------------------------------------
  // 启动校验 + 启动/流转/归档
  // ---------------------------------------------------------------------

  /** 启动前完整性校验（产品 §5.2）；返回检查项列表供前端展示 */
  async startCheck(
    cycleId: number,
  ): Promise<{ items: StartCheckItem[]; ok: boolean }> {
    const cycle = await this.prisma.perfCycle.findFirst({
      where: { id: cycleId, deletedAt: null },
      include: {
        evaluationRule: true,
        dimensions: { where: { deletedAt: null } },
        _count: { select: { participants: true } },
      },
    });
    if (!cycle) throw new NotFoundException('绩效周期不存在');

    const items: StartCheckItem[] = [];

    items.push({
      key: 'participants',
      ok: cycle._count.participants > 0,
      message:
        cycle._count.participants > 0
          ? `已圈定 ${cycle._count.participants} 名考核人员`
          : '尚未添加考核人员',
    });

    items.push({
      key: 'evaluation_rule',
      ok: Boolean(cycle.evaluationRule),
      message: cycle.evaluationRule ? '评估规则已配置' : '评估规则未配置',
    });

    items.push({
      key: 'dimensions',
      ok: cycle.dimensions.length > 0,
      message:
        cycle.dimensions.length > 0
          ? `已配置 ${cycle.dimensions.length} 个评估维度`
          : '尚未配置评估维度',
    });

    // 权重校验：按 applicable_scope 分组，各组（组内 + 全员维度）合计 = 100
    const weighted = cycle.dimensions.filter((dim) => dim.weight !== null);
    if (weighted.length > 0) {
      const scopeKeys = new Set(
        weighted.map((dim) =>
          dim.applicableScope ? JSON.stringify(dim.applicableScope) : '__ALL__',
        ),
      );
      const globalSum = weighted
        .filter((dim) => !dim.applicableScope)
        .reduce((sum, dim) => sum + Number(dim.weight), 0);
      const failures: string[] = [];
      if (scopeKeys.size === 1 && scopeKeys.has('__ALL__')) {
        if (Math.abs(globalSum - 100) > 0.001)
          failures.push(`全员维度权重合计 ${globalSum}`);
      } else {
        for (const key of scopeKeys) {
          if (key === '__ALL__') continue;
          const groupSum = weighted
            .filter(
              (dim) =>
                dim.applicableScope &&
                JSON.stringify(dim.applicableScope) === key,
            )
            .reduce((sum, dim) => sum + Number(dim.weight), 0);
          const total = groupSum + globalSum;
          if (Math.abs(total - 100) > 0.001)
            failures.push(`分组 ${key} 权重合计 ${total}`);
        }
      }
      items.push({
        key: 'weights',
        ok: failures.length === 0,
        message:
          failures.length === 0
            ? '维度权重校验通过（各适用分组合计 = 100）'
            : failures.join('；'),
      });
    } else {
      items.push({
        key: 'weights',
        ok: false,
        message: '没有任何带权重的维度',
      });
    }

    const windows = (cycle.windows ?? {}) as Record<string, unknown>;
    const requiredWindows = ['selfReview', 'review'];
    const missingWindows = requiredWindows.filter((key) => !windows[key]);
    items.push({
      key: 'windows',
      ok: missingWindows.length === 0,
      message:
        missingWindows.length === 0
          ? '时间窗口已配置'
          : `缺少时间窗口配置：${missingWindows.join('、')}`,
    });

    return { items, ok: items.every((item) => item.ok) };
  }

  /** HR 手动推进周期阶段（配合时间窗口调度）；合法性由状态机映射表校验 */
  async advanceCycle(
    operatorOpenId: string,
    cycleId: number,
    dto: AdvanceCycleDto,
  ) {
    const cycle = await this.requireCycle(cycleId);
    if (
      cycle.status === PerfCycleStatus.ACTIVE &&
      (dto.to === PerfCycleStatus.DRAFT || dto.to === PerfCycleStatus.SCHEDULED)
    ) {
      // ACTIVE 退回必须走 Ticket 17 的专用事务，禁止绕过失效、解锁、审计与通知。
      throw new ConflictException('活动周期退回必须使用整体退回接口');
    }
    assertCycleTransition(cycle.status, dto.to);
    const updated = await this.prisma.perfCycle.update({
      where: { id: cycleId },
      data: { status: dto.to },
    });
    await this.auditService.record({
      operatorOpenId,
      action: 'cycle.advance',
      targetType: 'perf_cycle',
      targetId: String(cycleId),
      before: { status: cycle.status },
      after: { status: dto.to },
      reason: dto.reason,
    });
    return updated;
  }

  /** 归档周期：参与者全部置 ARCHIVED，结果表落 archived_at（此后结果不可变） */
  async closeCycle(operatorOpenId: string, cycleId: number) {
    const cycle = await this.requireCycle(cycleId);
    assertCycleTransition(cycle.status, PerfCycleStatus.ARCHIVED);

    await this.prisma.$transaction(async (tx) => {
      await tx.perfCycle.update({
        where: { id: cycleId },
        data: { status: PerfCycleStatus.ARCHIVED },
      });
      await tx.perfParticipant.updateMany({
        // NO_RESULT 是参与者自己的结果终态；周期归档只令其永久不可撤销，不改写语义。
        where: {
          cycleId,
          status: { not: PerfParticipantStatus.NO_RESULT },
        },
        data: { status: PerfParticipantStatus.ARCHIVED },
      });
      await tx.perfResult.updateMany({
        where: { participant: { cycleId }, archivedAt: null },
        data: { archivedAt: new Date() },
      });
    });

    await this.auditService.record({
      operatorOpenId,
      action: 'cycle.close',
      targetType: 'perf_cycle',
      targetId: String(cycleId),
      before: { status: cycle.status },
      after: { status: PerfCycleStatus.ARCHIVED },
    });
    return this.getCycle(cycleId);
  }
}
