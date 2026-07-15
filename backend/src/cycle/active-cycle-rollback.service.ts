import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client';
import {
  PerfCycleStatus,
  PerfEvaluationTaskType,
  PerfParticipantStatus,
  PerfReviewStatus,
} from '../generated/prisma/enums';
import { NotificationEventService } from '../notification/notification-event.service';
import { RbacService } from '../rbac/rbac.service';
import { PrismaService } from '../shared/database/prisma.service';
import { assertCycleTransition } from './cycle-state';

export type ActiveCycleRollbackInput = {
  targetStatus:
    (typeof PerfCycleStatus)['DRAFT'] | (typeof PerfCycleStatus)['SCHEDULED'];
  reason: string;
  confirmed: boolean;
  impactRevision: string;
  plannedStartAt?: string;
};

const rollbackCycleInclude = {
  evaluationTasks: {
    select: { id: true, openedAt: true, completedAt: true },
    orderBy: { id: 'asc' as const },
  },
  participants: {
    orderBy: { id: 'asc' as const },
    select: {
      id: true,
      employeeOpenId: true,
      status: true,
      evaluationLockedAt: true,
      updatedAt: true,
      evaluationSubmissions: {
        where: {
          status: PerfReviewStatus.SUBMITTED,
          stage: {
            in: [PerfEvaluationTaskType.SELF, PerfEvaluationTaskType.MANAGER],
          },
        },
        select: { id: true, stage: true, status: true },
        orderBy: { id: 'asc' as const },
      },
      calibrations: {
        where: { invalidatedAt: null },
        select: { id: true, invalidatedAt: true },
        orderBy: { id: 'asc' as const },
      },
      resultVersions: {
        where: { invalidatedAt: null },
        select: {
          id: true,
          version: true,
          confirmedAt: true,
          supersededAt: true,
          invalidatedAt: true,
        },
        orderBy: { id: 'asc' as const },
      },
      appeals: {
        where: { invalidatedAt: null },
        select: { id: true, status: true, invalidatedAt: true },
        orderBy: { id: 'asc' as const },
      },
    },
  },
} satisfies Prisma.PerfCycleInclude;

type RollbackCycle = Prisma.PerfCycleGetPayload<{
  include: typeof rollbackCycleInclude;
}>;

/**
 * Ticket 17 周期整体退回边界：预览与执行共享同一影响计算，执行时在串行事务内
 * 再次加锁复核，确保失效、解锁、状态、审计与通知 outbox 原子提交。
 */
@Injectable()
export class ActiveCycleRollbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbacService: RbacService,
    private readonly notificationEventService: NotificationEventService,
  ) {}

  async preview(
    operatorOpenId: string,
    cycleId: number,
    targetStatus: PerfCycleStatus,
  ) {
    await this.assertAdmin(operatorOpenId);
    this.assertTarget(targetStatus);
    const cycle = await this.loadActiveCycle(this.prisma, cycleId);
    return this.buildImpact(cycle, targetStatus);
  }

  async rollback(
    operatorOpenId: string,
    cycleId: number,
    input: ActiveCycleRollbackInput,
    now = new Date(),
  ) {
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException('周期整体退回必须填写原因');
    if (reason.length > 500) {
      throw new BadRequestException('退回原因不能超过 500 个字符');
    }
    if (input.confirmed !== true) {
      throw new BadRequestException('必须确认影响摘要后才能整体退回周期');
    }
    this.assertTarget(input.targetStatus);
    const nextPlannedStartAt = this.parseScheduledStart(input, now);
    await this.assertAdmin(operatorOpenId);

    return this.prisma.$transaction(
      async (tx) => {
        // 锁顺序固定为 cycle → participants，与结果发布/归档聚合锁保持一致。
        await tx.$queryRaw`SELECT "id" FROM "performance"."perf_cycles" WHERE "id" = ${cycleId} AND "deleted_at" IS NULL FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "performance"."perf_participants" WHERE "cycle_id" = ${cycleId} ORDER BY "id" FOR UPDATE`;
        const cycle = await this.loadActiveCycle(tx, cycleId);
        await this.assertAdmin(operatorOpenId);
        assertCycleTransition(cycle.status, input.targetStatus);
        const impact = this.buildImpact(cycle, input.targetStatus);
        if (impact.impactRevision !== input.impactRevision) {
          throw new ConflictException({
            code: 'CYCLE_ROLLBACK_IMPACT_STALE',
            message: '预览后周期进度或结果链已变化，请刷新影响摘要后重试',
            currentImpactRevision: impact.impactRevision,
          });
        }

        const rollback = await tx.perfCycleRollback.create({
          data: {
            cycleId,
            targetStatus: input.targetStatus,
            reason,
            operatorOpenId,
            impactSummary: this.inputJson({
              impactRevision: impact.impactRevision,
              ...impact.summary,
            }),
          },
        });
        const invalidation = {
          invalidatedAt: now,
          invalidatedByRollbackId: rollback.id,
        };
        const participantIds = cycle.participants.map((item) => item.id);

        await Promise.all([
          tx.perfCalibration.updateMany({
            where: {
              participantId: { in: participantIds },
              invalidatedAt: null,
            },
            data: invalidation,
          }),
          tx.perfResultVersion.updateMany({
            where: {
              participantId: { in: participantIds },
              invalidatedAt: null,
            },
            data: invalidation,
          }),
          tx.perfAppeal.updateMany({
            where: {
              participantId: { in: participantIds },
              invalidatedAt: null,
            },
            data: invalidation,
          }),
        ]);

        for (const participant of cycle.participants) {
          const nextStatus = this.rollbackParticipantStatus(participant);
          if (
            participant.evaluationLockedAt !== null ||
            nextStatus !== participant.status
          ) {
            await tx.perfParticipant.update({
              where: { id: participant.id },
              data: { evaluationLockedAt: null, status: nextStatus },
            });
          }
        }

        await tx.perfCycle.update({
          where: { id: cycleId },
          data: {
            status: input.targetStatus,
            ...(nextPlannedStartAt
              ? { plannedStartAt: nextPlannedStartAt }
              : {}),
          },
        });

        // 只有已经拥有当前员工结果版本的人收到失效通知，避免误导尚未出结果的员工。
        for (const participant of impact.notificationRecipients) {
          await this.notificationEventService.enqueueResultInvalidatedEvent(
            {
              rollbackId: rollback.id,
              cycleId,
              cycleName: cycle.name,
              participantId: participant.id,
              resultVersionId: participant.resultVersions.find(
                (version) => version.supersededAt === null,
              )!.id,
              receiverOpenId: participant.employeeOpenId,
              targetStatus: input.targetStatus,
            },
            tx,
          );
        }

        await tx.auditLog.create({
          data: {
            operatorOpenId,
            action: 'cycle.rollback',
            targetType: 'perf_cycle',
            targetId: String(cycleId),
            before: this.inputJson({ status: PerfCycleStatus.ACTIVE }),
            after: this.inputJson({
              status: input.targetStatus,
              rollbackId: rollback.id,
              plannedStartAt: nextPlannedStartAt?.toISOString() ?? null,
              impact: impact.summary,
            }),
            reason,
          },
        });
        return {
          rollbackId: rollback.id,
          cycleId,
          targetStatus: input.targetStatus,
          plannedStartAt: nextPlannedStartAt,
          impact: impact.summary,
        };
      },
      { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 120_000 },
    );
  }

  private buildImpact(cycle: RollbackCycle, targetStatus: PerfCycleStatus) {
    const statusCounts: Record<string, number> = {};
    let lockedParticipantCount = 0;
    let calibrationCount = 0;
    let resultVersionCount = 0;
    let confirmedResultCount = 0;
    let appealCount = 0;
    for (const participant of cycle.participants) {
      statusCounts[participant.status] =
        (statusCounts[participant.status] ?? 0) + 1;
      if (participant.evaluationLockedAt) lockedParticipantCount += 1;
      calibrationCount += participant.calibrations.length;
      resultVersionCount += participant.resultVersions.length;
      confirmedResultCount += participant.resultVersions.filter(
        (item) => item.confirmedAt,
      ).length;
      appealCount += participant.appeals.length;
    }
    const notificationRecipients = cycle.participants.filter((participant) =>
      participant.resultVersions.some(
        (version) => version.supersededAt === null,
      ),
    );
    const summary = {
      participantCount: cycle.participants.length,
      participantStatusCounts: statusCounts,
      taskCount: cycle.evaluationTasks.length,
      openedTaskCount: cycle.evaluationTasks.filter((task) => task.openedAt)
        .length,
      completedTaskCount: cycle.evaluationTasks.filter(
        (task) => task.completedAt,
      ).length,
      lockedParticipantCount,
      calibrationCount,
      resultVersionCount,
      confirmedResultCount,
      appealCount,
      notificationRecipientCount: notificationRecipients.length,
    };
    const revisionFacts = {
      cycleId: cycle.id,
      cycleUpdatedAt: cycle.updatedAt.toISOString(),
      targetStatus,
      tasks: cycle.evaluationTasks.map((task) => ({
        id: task.id,
        openedAt: task.openedAt?.toISOString() ?? null,
        completedAt: task.completedAt?.toISOString() ?? null,
      })),
      participants: cycle.participants.map((participant) => ({
        id: participant.id,
        status: participant.status,
        updatedAt: participant.updatedAt.toISOString(),
        calibrationIds: participant.calibrations.map((item) => item.id),
        resultVersionIds: participant.resultVersions.map((item) => item.id),
        appealIds: participant.appeals.map((item) => item.id),
      })),
    };
    return {
      cycleId: cycle.id,
      targetStatus,
      summary,
      impactRevision: createHash('sha256')
        .update(JSON.stringify(revisionFacts))
        .digest('hex'),
      notificationRecipients,
    };
  }

  private rollbackParticipantStatus(
    participant: RollbackCycle['participants'][number],
  ): PerfParticipantStatus {
    if (participant.status === PerfParticipantStatus.NO_RESULT) {
      return participant.status;
    }
    const resultChainStatuses = new Set<PerfParticipantStatus>([
      PerfParticipantStatus.CALIBRATED,
      PerfParticipantStatus.RESULT_PUBLISHED,
      PerfParticipantStatus.CONFIRMED,
      PerfParticipantStatus.APPEALING,
      PerfParticipantStatus.RE_CONFIRMING,
    ]);
    if (!resultChainStatuses.has(participant.status)) return participant.status;
    // 退回只解除结果生命周期；人工评估进度继续由提交与任务事实派生。
    return PerfParticipantStatus.ACTIVE;
  }

  private parseScheduledStart(input: ActiveCycleRollbackInput, now: Date) {
    if (input.targetStatus !== PerfCycleStatus.SCHEDULED) return null;
    if (!input.plannedStartAt) {
      throw new BadRequestException('退回待启动必须填写新的计划启动时间');
    }
    const plannedStartAt = new Date(input.plannedStartAt);
    if (Number.isNaN(plannedStartAt.getTime())) {
      throw new BadRequestException('计划启动时间格式无效');
    }
    if (plannedStartAt.getTime() <= now.getTime()) {
      throw new BadRequestException('新的计划启动时间必须晚于当前时间');
    }
    return plannedStartAt;
  }

  private assertTarget(targetStatus: PerfCycleStatus) {
    if (
      targetStatus !== PerfCycleStatus.DRAFT &&
      targetStatus !== PerfCycleStatus.SCHEDULED
    ) {
      throw new BadRequestException('整体退回目标只能是 DRAFT 或 SCHEDULED');
    }
  }

  private async assertAdmin(operatorOpenId: string) {
    if (!(await this.rbacService.isAdmin(operatorOpenId))) {
      throw new ForbiddenException('只有超级管理员可以整体退回活动周期');
    }
  }

  private async loadActiveCycle(
    db:
      | Pick<PrismaService, 'perfCycle'>
      | Pick<Prisma.TransactionClient, 'perfCycle'>,
    cycleId: number,
  ): Promise<RollbackCycle> {
    const cycle = await db.perfCycle.findFirst({
      where: { id: cycleId, deletedAt: null },
      include: rollbackCycleInclude,
    });
    if (!cycle) throw new NotFoundException('绩效周期不存在');
    if (cycle.status !== PerfCycleStatus.ACTIVE) {
      throw new ConflictException('只有进行中的周期可以整体退回');
    }
    return cycle;
  }

  private inputJson(value: unknown) {
    return value as Prisma.InputJsonValue;
  }
}
