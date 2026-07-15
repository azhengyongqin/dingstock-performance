import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Prisma } from '../generated/prisma/client';
import {
  PerfCycleStatus,
  PerfEvaluationTaskType,
  PerfAssignmentStatus,
} from '../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../shared/database/prisma.service';
import type {
  NotificationRules,
  SchedulePreset,
} from '../config-template/config-template.contract';
import { NotificationEventService } from '../notification/notification-event.service';
import { buildEvaluationTaskSeeds } from './evaluation-task-plan';
import { analyzeParticipantFormMatch } from './participant-prefix';
import {
  CycleSetupService,
  type CycleStartCheckIssue,
} from './cycle-setup.service';

export type CycleActivationResult = {
  cycleId: number;
  ownerOpenId?: string;
  cycleName?: string;
  status:
    | 'ACTIVATED'
    | 'ALREADY_ACTIVE'
    | 'NOT_DUE'
    | 'NOT_SCHEDULED'
    | 'CHECK_FAILED'
    | 'NOT_FOUND';
  changed: boolean;
  issues?: readonly CycleStartCheckIssue[];
};

const activationInclude = {
  currentConfigVersion: {
    select: {
      schedulePreset: true,
      notificationRules: true,
      formSnapshots: { select: { id: true, jobLevelPrefix: true } },
    },
  },
  participants: {
    orderBy: { id: 'asc' as const },
    select: {
      id: true,
      employeeOpenId: true,
      leaderOpenIdSnapshot: true,
    },
  },
};

/** 周期到时启动编排：周期状态与四类任务事实必须在同一事务内成功或全部回滚。 */
@Injectable()
export class CycleActivationService {
  private readonly logger = new Logger(CycleActivationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cycleSetupService: CycleSetupService,
    private readonly auditService: AuditService,
    private readonly notificationEventService: NotificationEventService,
  ) {}

  async activateCycle(
    cycleId: number,
    now = new Date(),
  ): Promise<CycleActivationResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      // 行锁把并发定时扫描串行化；第二个事务看到 ACTIVE 后幂等退出。
      await tx.$queryRaw`SELECT "id" FROM "performance"."perf_cycles" WHERE "id" = ${cycleId} AND "deleted_at" IS NULL FOR UPDATE`;
      const cycle = await tx.perfCycle.findFirst({
        where: { id: cycleId, deletedAt: null },
        include: activationInclude,
      });
      if (!cycle) {
        return { cycleId, status: 'NOT_FOUND', changed: false } as const;
      }
      if (cycle.status === PerfCycleStatus.ACTIVE) {
        return {
          cycleId,
          ownerOpenId: cycle.ownerOpenId,
          status: 'ALREADY_ACTIVE',
          changed: false,
        } as const;
      }
      if (cycle.status !== PerfCycleStatus.SCHEDULED) {
        return {
          cycleId,
          ownerOpenId: cycle.ownerOpenId,
          status: 'NOT_SCHEDULED',
          changed: false,
        } as const;
      }
      if (
        !cycle.plannedStartAt ||
        cycle.plannedStartAt.getTime() > now.getTime()
      ) {
        return {
          cycleId,
          ownerOpenId: cycle.ownerOpenId,
          status: 'NOT_DUE',
          changed: false,
        } as const;
      }

      // 启动时以当前 CoreHR 再固化一次组织快照，后续组织同步不再改变本周期责任人。
      const openIds = cycle.participants.map((item) => item.employeeOpenId);
      const [users, corehrs] = await Promise.all([
        tx.larkUser.findMany({
          where: { open_id: { in: openIds } },
          select: { open_id: true, leader_user_id: true, department_ids: true },
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
      const userMap = new Map(users.map((item) => [item.open_id, item]));
      const corehrMap = new Map(corehrs.map((item) => [item.open_id, item]));
      const refreshedParticipants = [] as Array<
        (typeof cycle.participants)[number] & {
          leaderOpenIdSnapshot: string | null;
          departmentIdSnapshot: string | null;
          jobLevelSnapshot: Prisma.InputJsonValue;
          jobLevelPrefixSnapshot: 'D' | 'M';
          formSnapshotId: number;
        }
      >;
      const organizationIssues: CycleStartCheckIssue[] = [];
      for (const participant of cycle.participants) {
        const user = userMap.get(participant.employeeOpenId);
        const corehr = corehrMap.get(participant.employeeOpenId);
        const formMatch = analyzeParticipantFormMatch(
          {
            id: participant.id,
            employeeOpenId: participant.employeeOpenId,
            jobLevelSnapshot: corehr?.job_level ?? null,
          },
          cycle.currentConfigVersion?.formSnapshots ?? [],
        );
        const leaderOpenIdSnapshot =
          corehr?.direct_manager_id ?? user?.leader_user_id ?? null;
        const departmentIdSnapshot =
          corehr?.department_id ?? user?.department_ids[0] ?? null;
        if (!corehr?.job_level) {
          organizationIssues.push({
            code: 'PARTICIPANT_JOB_LEVEL_MISSING',
            path: `participants.${participant.id}.jobLevel`,
            message: '启动复核时未获取到当前职级',
            participantId: participant.id,
            employeeOpenId: participant.employeeOpenId,
          });
        }
        if (!leaderOpenIdSnapshot) {
          organizationIssues.push({
            code: 'PARTICIPANT_LEADER_MISSING',
            path: `participants.${participant.id}.leader`,
            message: '启动复核时未获取到当前直属 Leader',
            participantId: participant.id,
            employeeOpenId: participant.employeeOpenId,
          });
        }
        if (!departmentIdSnapshot) {
          organizationIssues.push({
            code: 'PARTICIPANT_DEPARTMENT_MISSING',
            path: `participants.${participant.id}.department`,
            message: '启动复核时未获取到当前部门',
            participantId: participant.id,
            employeeOpenId: participant.employeeOpenId,
          });
        }
        if (corehr?.job_level && formMatch.status !== 'MATCHED') {
          organizationIssues.push({
            code: `PARTICIPANT_${formMatch.status}`,
            path: `participants.${participant.id}.jobLevel`,
            message: formMatch.message,
            participantId: participant.id,
            employeeOpenId: participant.employeeOpenId,
          });
        }
        if (
          corehr?.job_level &&
          leaderOpenIdSnapshot &&
          departmentIdSnapshot &&
          formMatch.status === 'MATCHED' &&
          formMatch.jobLevelPrefix &&
          formMatch.formSnapshotId != null
        ) {
          refreshedParticipants.push({
            ...participant,
            leaderOpenIdSnapshot,
            departmentIdSnapshot,
            jobLevelSnapshot: corehr.job_level,
            jobLevelPrefixSnapshot: formMatch.jobLevelPrefix,
            formSnapshotId: formMatch.formSnapshotId,
          });
        }
      }

      // SCHEDULED 完整性触发器禁止空绑定；失败时保持原快照不动，仅返回当前主数据问题。
      if (organizationIssues.length > 0) {
        return {
          cycleId,
          ownerOpenId: cycle.ownerOpenId,
          cycleName: cycle.name,
          status: 'CHECK_FAILED',
          changed: false,
          issues: organizationIssues,
        } as const;
      }
      for (const participant of refreshedParticipants) {
        await tx.perfParticipant.update({
          where: { id: participant.id },
          data: {
            leaderOpenIdSnapshot: participant.leaderOpenIdSnapshot,
            departmentIdSnapshot: participant.departmentIdSnapshot,
            jobLevelSnapshot: participant.jobLevelSnapshot,
            jobLevelPrefixSnapshot: participant.jobLevelPrefixSnapshot,
            formSnapshotId: participant.formSnapshotId,
          },
        });
      }

      // SCHEDULED 仍允许 HR 调整人员与计划，因此真正启动前必须在锁内完整复核。
      const check = await this.cycleSetupService.startCheck(cycleId, tx);
      if (!check.ok) {
        return {
          cycleId,
          ownerOpenId: cycle.ownerOpenId,
          cycleName: cycle.name,
          status: 'CHECK_FAILED',
          changed: false,
          issues: [...check.items.flatMap((item) => item.issues)],
        } as const;
      }
      const snapshot = cycle.currentConfigVersion;
      if (!snapshot) {
        return {
          cycleId,
          ownerOpenId: cycle.ownerOpenId,
          cycleName: cycle.name,
          status: 'CHECK_FAILED',
          changed: false,
          issues: [
            {
              code: 'CONFIG_SNAPSHOT_MISSING',
              path: 'currentConfigVersionId',
              message: '周期配置快照缺失',
            },
          ] as CycleStartCheckIssue[],
        } as const;
      }
      const tasks = buildEvaluationTaskSeeds({
        cycleId,
        participants: refreshedParticipants,
        plannedStartAt: cycle.plannedStartAt,
        schedulePreset: snapshot.schedulePreset as unknown as SchedulePreset,
        now,
      });
      await tx.perfEvaluationTask.createMany({
        data: tasks,
        skipDuplicates: true,
      });
      const openedTasks = await tx.perfEvaluationTask.findMany({
        where: { cycleId, openedAt: now },
        include: {
          participant: {
            select: {
              leaderOpenIdSnapshot: true,
              reviewerAssignments: {
                where: { status: { not: PerfAssignmentStatus.REPLACED } },
                select: { reviewerOpenId: true },
              },
            },
          },
        },
      });
      const notificationRules =
        snapshot.notificationRules as unknown as NotificationRules;
      for (const task of openedTasks) {
        const rule = notificationRules.stages.find(
          (item) => item.stage === task.type,
        )?.taskOpened;
        if (!rule) continue;
        // 业务任务与 outbox 事件同事务提交；真正发送失败不会回滚周期启动。
        await this.notificationEventService.enqueueTaskOpenedEvents(
          {
            id: task.id,
            cycleId,
            type: task.type,
            assigneeOpenId: task.assigneeOpenId,
            openedAt: task.openedAt,
            reminderDeadlineAt: task.reminderDeadlineAt,
            cycleName: cycle.name,
            cycleOwnerOpenId: cycle.ownerOpenId,
            leaderOpenId: task.participant.leaderOpenIdSnapshot,
            peerReviewerOpenIds: task.participant.reviewerAssignments.map(
              (assignment) => assignment.reviewerOpenId,
            ),
            rule,
          },
          tx,
        );
      }
      await tx.perfCycle.update({
        where: { id: cycleId },
        data: { status: PerfCycleStatus.ACTIVE },
      });
      return {
        cycleId,
        ownerOpenId: cycle.ownerOpenId,
        cycleName: cycle.name,
        status: 'ACTIVATED',
        changed: true,
      } as const;
    });

    if (result.changed) {
      await this.auditService.record({
        operatorOpenId: result.ownerOpenId ?? 'system',
        action: 'cycle.activate',
        targetType: 'perf_cycle',
        targetId: String(cycleId),
        before: { status: PerfCycleStatus.SCHEDULED },
        after: { status: PerfCycleStatus.ACTIVE },
      });
    } else if (
      result.status === 'CHECK_FAILED' &&
      result.ownerOpenId &&
      result.cycleName &&
      result.issues?.length
    ) {
      // 启动事务正常结束且状态仍为 SCHEDULED 后，再写入幂等失败通知事件。
      await this.notificationEventService.enqueueCycleStartFailure({
        cycleId,
        cycleName: result.cycleName,
        ownerOpenId: result.ownerOpenId,
        issues: result.issues,
      });
    }
    return result;
  }

  /** 扫描到期周期；单个周期失败不会阻断同批次其他周期。 */
  async activateDueCycles(now = new Date()) {
    const due = await this.prisma.perfCycle.findMany({
      where: {
        status: PerfCycleStatus.SCHEDULED,
        deletedAt: null,
        plannedStartAt: { lte: now },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const results: CycleActivationResult[] = [];
    for (const cycle of due) {
      try {
        results.push(await this.activateCycle(cycle.id, now));
      } catch (error) {
        this.logger.error(`周期 ${cycle.id} 自动启动异常`, error);
        const failedCycle = await this.prisma.perfCycle.findFirst({
          where: {
            id: cycle.id,
            status: PerfCycleStatus.SCHEDULED,
            deletedAt: null,
          },
          select: { name: true, ownerOpenId: true },
        });
        if (failedCycle) {
          await this.notificationEventService.enqueueCycleStartFailure({
            cycleId: cycle.id,
            cycleName: failedCycle.name,
            ownerOpenId: failedCycle.ownerOpenId,
            issues: [
              {
                code: 'CYCLE_ACTIVATION_ERROR',
                message: '自动启动发生系统异常，请稍后重试或联系管理员',
              },
            ],
          });
        }
      }
    }
    return results;
  }

  /**
   * 将到时人工任务写成不可逆 openedAt 事实。
   * 返回实际新开放的任务，通知事件层可据 taskId 做幂等入队。
   */
  async openDueTasks(now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const due = await tx.perfEvaluationTask.findMany({
        where: {
          openedAt: null,
          startAt: { not: null, lte: now },
          cycle: { status: PerfCycleStatus.ACTIVE, deletedAt: null },
          type: { not: PerfEvaluationTaskType.AI },
        },
        orderBy: { id: 'asc' },
        // 已开放的行会退出下轮查询，因此固定主键顺序限批即可稳定推进。
        take: 200,
        include: {
          cycle: {
            select: {
              name: true,
              ownerOpenId: true,
              currentConfigVersion: { select: { notificationRules: true } },
            },
          },
          participant: {
            select: {
              leaderOpenIdSnapshot: true,
              reviewerAssignments: {
                where: { status: { not: PerfAssignmentStatus.REPLACED } },
                select: { reviewerOpenId: true },
              },
            },
          },
        },
      });
      const opened: typeof due = [];
      for (const task of due) {
        const changed = await tx.perfEvaluationTask.updateMany({
          where: { id: task.id, openedAt: null },
          data: { openedAt: now },
        });
        if (changed.count === 1) {
          const openedTask = { ...task, openedAt: now };
          opened.push(openedTask);
          const rules = task.cycle.currentConfigVersion
            ?.notificationRules as unknown as NotificationRules | undefined;
          const rule = rules?.stages.find(
            (item) => item.stage === task.type,
          )?.taskOpened;
          if (rule) {
            await this.notificationEventService.enqueueTaskOpenedEvents(
              {
                id: task.id,
                cycleId: task.cycleId,
                type: task.type,
                assigneeOpenId: task.assigneeOpenId,
                openedAt: now,
                reminderDeadlineAt: task.reminderDeadlineAt,
                cycleName: task.cycle.name,
                cycleOwnerOpenId: task.cycle.ownerOpenId,
                leaderOpenId: task.participant.leaderOpenIdSnapshot,
                peerReviewerOpenIds: task.participant.reviewerAssignments.map(
                  (assignment) => assignment.reviewerOpenId,
                ),
                rule,
              },
              tx,
            );
          }
        }
      }
      return opened;
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async runScheduler() {
    const now = new Date();
    await this.activateDueCycles(now);
    await this.openDueTasks(now);
  }
}
