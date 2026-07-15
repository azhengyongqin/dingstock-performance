import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PerfRedLineAction, PerfRole } from '../generated/prisma/enums';
import { PrismaService } from '../shared/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import { RbacService } from '../rbac/rbac.service';
import { ParticipantNoResultService } from '../participant/participant-no-result.service';

type CalibrationReadDb = Pick<
  Prisma.TransactionClient,
  'perfCalibration' | 'larkUser'
>;

/**
 * 校准与最终结果（产品 §5.5/§5.6）：
 * - 这里只保留校准工作台与历史读取；决定写入统一走 CalibrationDecisionService；
 * - 当前评级 = 最近一条校准记录的 after_level，无校准则取上级初评评级；
 * - 结果版本发布统一走 ResultService，禁止继续覆盖旧单行结果。
 */
@Injectable()
export class CalibrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly rbacService: RbacService,
    private readonly participantNoResultService: ParticipantNoResultService,
  ) {}

  /** 校准工作台列表：只聚合当前 Leader 或授权 HR/Admin 可见的参与者。 */
  async listForCycle(operatorOpenId: string, cycleId: number) {
    const cycle = await this.prisma.perfCycle.findFirst({
      where: { id: cycleId, deletedAt: null },
      include: { currentConfigVersion: { select: { ratings: true } } },
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
        stageResults: {
          where: {
            stage: 'MANAGER',
            status: 'READY',
          },
          select: { stageLevel: true },
          orderBy: { calculatedAt: 'desc' },
          take: 1,
        },
        calibrations: {
          where: { invalidatedAt: null },
          orderBy: { id: 'desc' },
          take: 1,
        },
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
        redLineFindings: {
          where: {
            action: PerfRedLineAction.CONFIRM,
            revokedBy: { none: {} },
          },
          select: {
            id: true,
            findingType: true,
            facts: true,
            evidence: true,
            reason: true,
            operatorOpenId: true,
            createdAt: true,
          },
          orderBy: { id: 'asc' },
        },
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
      const initialLevel = participant.stageResults?.[0]?.stageLevel ?? null;
      const currentLevel =
        participant.redLineFindings.length > 0
          ? 'C'
          : (participant.calibrations[0]?.afterLevel ?? initialLevel);
      const requiredEvaluations = requiredEvaluationGates.get(participant.id)!;
      return {
        id: participant.id,
        employeeOpenId: participant.employeeOpenId,
        employee: userMap.get(participant.employeeOpenId) ?? null,
        status: participant.status,
        isPromotionEnabled: participant.isPromotionEnabled,
        initialLevel,
        currentLevel,
        promotionConclusion: null,
        aiReportStatus: participant.aiReport?.status ?? null,
        riskFlags: participant.aiReport?.riskFlags ?? null,
        // 校准工作台是管理端授权接口，可在同一行直接使用完整 AI 参考。
        aiReport: participant.aiReport ?? null,
        activeRedLineFindings: participant.redLineFindings,
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
      levels: cycle.currentConfigVersion?.ratings ?? [],
    };
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
    // 结果版本为空是合法状态；已存在时锁住版本链，防止并发发布或确认。
    await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id"
      FROM "performance"."perf_result_versions"
      WHERE "participant_id" = ${participantId}
      ORDER BY "version" DESC
      FOR UPDATE
    `;
  }
}
