import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PerfNotificationChannel,
  PerfParticipantStatus,
  PerfRole,
} from '../generated/prisma/enums';
import { PrismaService } from '../shared/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ParticipantService } from '../participant/participant.service';
import { hasRatingSymbol } from '../cycle/evaluation-rule';
import type { Prisma } from '../generated/prisma/client';
import { RbacService } from '../rbac/rbac.service';
import { ParticipantNoResultService } from '../participant/participant-no-result.service';

type CalibrationReadDb = Pick<
  Prisma.TransactionClient,
  'perfCalibration' | 'larkUser'
>;

/**
 * 校准与最终结果（产品 §5.5/§5.6）：
 * - 校准记录 append-only，每次调整必填原因；
 * - 当前评级 = 最近一条校准记录的 after_level，无校准则取上级初评评级；
 * - 批量确认 = 参与者 → CALIBRATED；推送结果 = 生成 perf_results + RESULT_PUSHED。
 */
@Injectable()
export class CalibrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly participantService: ParticipantService,
    private readonly rbacService: RbacService,
    private readonly participantNoResultService: ParticipantNoResultService,
  ) {}

  /** 校准工作台列表：只聚合当前 Leader 或授权 HR/Admin 可见的参与者。 */
  async listForCycle(operatorOpenId: string, cycleId: number) {
    const cycle = await this.prisma.perfCycle.findFirst({
      where: { id: cycleId, deletedAt: null },
      include: { evaluationRule: true },
    });
    if (!cycle) throw new NotFoundException('绩效周期不存在');

    const orgScope = await this.rbacService.getOrgScope(operatorOpenId);
    const participantWhere: Prisma.PerfParticipantWhereInput = { cycleId };
    if (orgScope !== null) {
      // Leader 始终只看当前负责员工；范围 HR 额外看授权部门，普通员工没有扩展范围。
      participantWhere.OR = [
        { leaderOpenIdSnapshot: operatorOpenId },
        ...(orgScope.length > 0
          ? [{ departmentIdSnapshot: { in: orgScope } }]
          : []),
      ];
    }

    const participants = await this.prisma.perfParticipant.findMany({
      where: participantWhere,
      include: {
        managerReview: {
          select: {
            initialLevel: true,
            promotionConclusion: true,
            status: true,
          },
        },
        stageResults: {
          where: {
            stage: 'MANAGER',
            status: 'READY',
          },
          select: { stageLevel: true },
          orderBy: { calculatedAt: 'desc' },
          take: 1,
        },
        calibrations: { orderBy: { id: 'desc' }, take: 1 },
        aiReport: {
          select: {
            status: true,
            referenceLevel: true,
            summary: true,
            highlights: true,
            improvements: true,
            promotionSummary: true,
            riskFlags: true,
            generatedAt: true,
          },
        },
        result: { select: { finalLevel: true } },
      },
      orderBy: { id: 'asc' },
    });

    const [users, requiredEvaluationGates] = await Promise.all([
      this.prisma.larkUser.findMany({
        where: { open_id: { in: participants.map((p) => p.employeeOpenId) } },
        select: { open_id: true, name: true, avatar: true, job_title: true },
      }),
      this.participantNoResultService.getRequiredEvaluationGates(
        participants.map((participant) => participant.id),
      ),
    ]);
    const userMap = new Map(users.map((u) => [u.open_id, u]));

    const items = participants.map((participant) => {
      const initialLevel =
        participant.stageResults?.[0]?.stageLevel ??
        participant.managerReview?.initialLevel ??
        null;
      const currentLevel =
        participant.calibrations[0]?.afterLevel ?? initialLevel;
      const requiredEvaluations = requiredEvaluationGates.get(participant.id)!;
      return {
        id: participant.id,
        employeeOpenId: participant.employeeOpenId,
        employee: userMap.get(participant.employeeOpenId) ?? null,
        status: participant.status,
        isPromotionEnabled: participant.isPromotionEnabled,
        initialLevel,
        currentLevel,
        promotionConclusion:
          participant.managerReview?.promotionConclusion ?? null,
        aiReportStatus: participant.aiReport?.status ?? null,
        riskFlags: participant.aiReport?.riskFlags ?? null,
        // 校准工作台是管理端授权接口，可在同一行直接使用完整 AI 参考。
        aiReport: participant.aiReport ?? null,
        adjusted: participant.calibrations.length > 0,
        requiredEvaluations,
      };
    });

    // 评级分布：按当前评级聚合，前端按评估规则评级序列展示。
    const distribution: Record<string, number> = {};
    for (const item of items) {
      if (item.currentLevel) {
        distribution[item.currentLevel] =
          (distribution[item.currentLevel] ?? 0) + 1;
      }
    }

    return {
      items,
      total: items.length,
      distribution,
      levels: cycle.evaluationRule?.levels ?? [],
    };
  }

  /** 校准调整：append-only 落一条校准记录（调整必填原因） */
  async adjust(
    operatorOpenId: string,
    participantId: number,
    afterLevel: string,
    reason: string,
  ) {
    const { record, beforeLevel } = await this.prisma.$transaction(
      async (tx) => {
        // 所有角色先锁住参与者、周期与既有结果，再读取可变前置条件和最新校准。
        await this.lockCalibrationAggregate(tx, participantId);
        const participant = await tx.perfParticipant.findUnique({
          where: { id: participantId },
          include: {
            cycle: { include: { evaluationRule: true } },
            managerReview: { select: { initialLevel: true, status: true } },
            stageResults: {
              where: { stage: 'MANAGER', status: 'READY' },
              select: { stageLevel: true },
              orderBy: { calculatedAt: 'desc' },
              take: 1,
            },
            calibrations: { orderBy: { id: 'desc' }, take: 1 },
            result: { select: { archivedAt: true } },
          },
        });
        if (!participant || participant.cycle.deletedAt) {
          throw new NotFoundException('参与者不存在');
        }
        await this.assertCanAccessParticipant(operatorOpenId, participant);
        if (participant.result?.archivedAt) {
          throw new ConflictException(
            '结果已归档，任何调整必须经申诉/面谈流程',
          );
        }
        await this.participantNoResultService.assertCalibrationReady(
          participantId,
          tx,
        );
        if (
          Array.isArray(participant.cycle.evaluationRule?.levels) &&
          !hasRatingSymbol(participant.cycle.evaluationRule.levels, afterLevel)
        ) {
          throw new BadRequestException(
            `评级 ${afterLevel} 不在评估规则定义中`,
          );
        }
        const currentLevel =
          participant.calibrations[0]?.afterLevel ??
          participant.stageResults?.[0]?.stageLevel ??
          participant.managerReview?.initialLevel ??
          null;
        if (!currentLevel) {
          throw new ConflictException('上级评估尚未形成可校准的权威阶段等级');
        }
        const created = await tx.perfCalibration.create({
          data: {
            participantId,
            beforeLevel: currentLevel,
            afterLevel,
            reason,
            operatorOpenId,
          },
        });
        return { record: created, beforeLevel: currentLevel };
      },
    );
    await this.auditService.record({
      operatorOpenId,
      action: 'calibration.adjust',
      targetType: 'perf_participant',
      targetId: String(participantId),
      before: { level: beforeLevel },
      after: { level: afterLevel },
      reason,
    });
    return record;
  }

  /** 校准记录历史（申诉处理/审计走查用） */
  async history(participantId: number, db: CalibrationReadDb = this.prisma) {
    const items = await db.perfCalibration.findMany({
      where: { participantId },
      orderBy: { id: 'asc' },
    });
    const operatorIds = [...new Set(items.map((item) => item.operatorOpenId))];
    const users = await db.larkUser.findMany({
      where: { open_id: { in: operatorIds } },
      select: { open_id: true, name: true, avatar: true },
    });
    const userMap = new Map(users.map((u) => [u.open_id, u]));
    return {
      items: items.map((item) => ({
        ...item,
        operator: userMap.get(item.operatorOpenId) ?? null,
      })),
      total: items.length,
    };
  }

  /** 当前 Leader、授权 HR 或 Admin 的敏感校准历史读取边界。 */
  async getHistory(operatorOpenId: string, participantId: number) {
    return await this.prisma.$transaction(async (tx) => {
      await this.lockCalibrationAggregate(tx, participantId);
      const participant = await tx.perfParticipant.findUnique({
        where: { id: participantId },
        include: { cycle: { select: { deletedAt: true } } },
      });
      if (!participant || participant.cycle.deletedAt) {
        throw new NotFoundException('参与者不存在');
      }
      await this.assertCanAccessParticipant(operatorOpenId, participant);
      return this.history(participantId, tx);
    });
  }

  /** 对象级权限始终读取当前考核 Leader 快照，职责转移后旧 Leader 立即失权。 */
  private async assertCanAccessParticipant(
    operatorOpenId: string,
    participant: {
      leaderOpenIdSnapshot: string | null;
      departmentIdSnapshot: string | null;
    },
  ) {
    if (participant.leaderOpenIdSnapshot === operatorOpenId) {
      return;
    }
    const isHrOrAdmin = await this.rbacService.hasAnyRole(operatorOpenId, [
      PerfRole.HR,
      PerfRole.ADMIN,
    ]);
    if (!isHrOrAdmin) {
      throw new ForbiddenException('无权查看或调整该员工的校准结果');
    }
    const scope = await this.rbacService.getOrgScope(operatorOpenId);
    if (
      scope !== null &&
      (!participant.departmentIdSnapshot ||
        !scope.includes(participant.departmentIdSnapshot))
    ) {
      throw new ForbiddenException('该参与者不在你的 HR 授权组织范围内');
    }
  }

  /**
   * 按归档流程相同的 cycle → participant → result 顺序锁住可变边界，避免反向持锁死锁；
   * 随后必须在同一事务重新读取全部校准前置事实。
   */
  private async lockCalibrationAggregate(
    tx: Prisma.TransactionClient,
    participantId: number,
  ) {
    const cycles = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT cycle."id"
      FROM "performance"."perf_cycles" AS cycle
      JOIN "performance"."perf_participants" AS participant
        ON participant."cycle_id" = cycle."id"
      WHERE participant."id" = ${participantId}
      FOR UPDATE OF cycle
    `;
    if (cycles.length !== 1) {
      throw new NotFoundException('参与者不存在');
    }
    const participants = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id"
      FROM "performance"."perf_participants"
      WHERE "id" = ${participantId}
      FOR UPDATE
    `;
    if (participants.length !== 1) {
      throw new NotFoundException('参与者不存在');
    }
    // 结果尚未创建时返回空是合法状态；已存在时锁住该行，防止并发归档。
    await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id"
      FROM "performance"."perf_results"
      WHERE "participant_id" = ${participantId}
      FOR UPDATE
    `;
  }

  /** 批量确认校准：完成度从当前有效 SELF/MANAGER 提交派生，不依赖旧阶段状态。 */
  async confirm(
    operatorOpenId: string,
    cycleId: number,
    participantIds: number[],
  ) {
    const participants = await this.prisma.perfParticipant.findMany({
      where: { id: { in: participantIds }, cycleId },
    });
    if (participants.length === 0) throw new NotFoundException('参与者不存在');

    let confirmed = 0;
    const skipped: number[] = [];
    for (const participant of participants) {
      if (participant.status === PerfParticipantStatus.CALIBRATED) {
        skipped.push(participant.id);
        continue;
      }
      await this.participantNoResultService.assertCalibrationReady(
        participant.id,
      );
      await this.participantService.transition(
        operatorOpenId,
        participant.id,
        PerfParticipantStatus.CALIBRATED,
      );
      confirmed += 1;
    }
    return { confirmed, skipped };
  }

  /**
   * 推送结果给员工确认（产品 §5.6）：
   * 生成/更新 perf_results（final = 校准后评级），参与者 → RESULT_PUSHED，落结果通知。
   */
  async pushResults(
    operatorOpenId: string,
    cycleId: number,
    participantIds?: number[],
  ) {
    const participants = await this.prisma.perfParticipant.findMany({
      where: {
        cycleId,
        status: PerfParticipantStatus.CALIBRATED,
        ...(participantIds?.length ? { id: { in: participantIds } } : {}),
      },
      include: {
        managerReview: true,
        calibrations: { orderBy: { id: 'desc' }, take: 1 },
        cycle: { include: { dimensions: { where: { deletedAt: null } } } },
      },
    });
    if (participants.length === 0) {
      throw new BadRequestException('没有可推送的参与者（需处于已校准状态）');
    }

    let pushed = 0;
    for (const participant of participants) {
      const finalLevel =
        participant.calibrations[0]?.afterLevel ??
        participant.managerReview?.initialLevel;
      if (!finalLevel) continue;

      // 维度结果快照：冗余维度名，归档后不受维度修改影响
      const scores = (participant.managerReview?.dimensionScores ?? []) as {
        dimensionId?: number;
      }[];
      const dimensionResults = scores.map((score) => ({
        ...score,
        name: participant.cycle.dimensions.find(
          (dim) => dim.id === score.dimensionId,
        )?.name,
      }));

      await this.prisma.$transaction(async (tx) => {
        await tx.perfResult.upsert({
          where: { participantId: participant.id },
          create: {
            participantId: participant.id,
            finalLevel,
            dimensionResults: dimensionResults,
            promotionResult: participant.managerReview?.promotionConclusion,
          },
          update: {
            finalLevel,
            dimensionResults: dimensionResults,
            promotionResult: participant.managerReview?.promotionConclusion,
          },
        });
        await tx.perfNotification.create({
          data: {
            receiverOpenId: participant.employeeOpenId,
            channel: PerfNotificationChannel.BOT_DM,
            template: 'result_pushed',
            payload: {
              cycleId,
              participantId: participant.id,
            },
          },
        });
      });
      await this.participantService.transition(
        operatorOpenId,
        participant.id,
        PerfParticipantStatus.RESULT_PUSHED,
      );
      pushed += 1;
    }

    await this.auditService.record({
      operatorOpenId,
      action: 'result.push',
      targetType: 'perf_cycle',
      targetId: String(cycleId),
      after: { pushed },
    });
    return { pushed };
  }
}
