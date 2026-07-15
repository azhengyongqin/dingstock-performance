import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type Redis from 'ioredis';
import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client';
import {
  PerfAssignmentStatus,
  PerfCycleStatus,
  PerfEvaluationTaskType,
  PerfNotificationChannel,
  PerfNotificationEventStatus,
  PerfRole,
} from '../generated/prisma/enums';
import { PrismaService } from '../shared/database/prisma.service';
import { REDIS_CLIENT } from '../shared/redis/redis.constants';
import type { NotificationRules } from '../config-template/config-template.contract';
import {
  cycleStartFailedDedupeKey,
  resultPublishedDedupeKey,
  type EnqueueNotificationEventInput,
  type TaskNotificationContext,
  type TaskOpenedEventInput,
  type TaskReminderEventInput,
  taskOpenedDedupeKey,
  taskReminderDedupeKey,
} from './notification-event.contract';

const MAX_EVENT_ATTEMPTS = 3;
const EVENT_BATCH_LOCK_KEY = 'perf:notification:event:consume:lock';
const REMINDER_SCAN_CURSOR_KEY = 'perf:notification:reminder:scan:cursor';
const RELEASE_LOCK_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

/** 能在业务事务内写入通知事件的最小 Prisma 契约。 */
type NotificationEventWriter = Pick<
  Prisma.TransactionClient,
  'perfNotificationEvent'
>;

const DAY_MS = 24 * 60 * 60 * 1_000;

function notificationRecipients(
  task: TaskNotificationContext,
  rule: { ccLeader: boolean; ccHr: boolean },
) {
  const receivers = new Set<string>();
  if (task.assigneeOpenId) receivers.add(task.assigneeOpenId);
  if (task.type === PerfEvaluationTaskType.PEER) {
    for (const reviewerOpenId of task.peerReviewerOpenIds ?? []) {
      receivers.add(reviewerOpenId);
    }
  }
  if (rule.ccLeader && task.leaderOpenId) receivers.add(task.leaderOpenId);
  if (rule.ccHr) receivers.add(task.cycleOwnerOpenId);
  return [...receivers];
}

/** 返回当前扫描时刻应触发的提醒批次；null 表示尚未到提醒时间。 */
function reminderOccurrenceAt(
  deadlineAt: Date,
  frequency: TaskReminderEventInput['rule']['frequency'],
  now: Date,
) {
  if (deadlineAt.getTime() > now.getTime()) return null;
  if (frequency.type === 'ONCE_AT_DEADLINE') return deadlineAt;
  const intervalDays =
    frequency.type === 'DAILY_AFTER_DEADLINE' ? 1 : frequency.intervalDays;
  const occurrence = Math.floor(
    (now.getTime() - deadlineAt.getTime()) / (intervalDays * DAY_MS),
  );
  return new Date(deadlineAt.getTime() + occurrence * intervalDays * DAY_MS);
}

/**
 * 通知事件 outbox：业务事务只负责入队，消费者再幂等转换为待发送通知。
 * 事件与发送记录分层后，业务动作不会因飞书瞬时故障回滚。
 */
@Injectable()
export class NotificationEventService {
  private readonly logger = new Logger(NotificationEventService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * 幂等入队；可传入业务侧 transaction client，使业务结果与事件同事务提交。
   * 相同 dedupeKey 永远返回首次创建的事件，不覆盖原始载荷。
   */
  enqueue(
    input: EnqueueNotificationEventInput,
    transaction?: NotificationEventWriter,
  ) {
    const writer = transaction ?? this.prisma;
    return writer.perfNotificationEvent.upsert({
      where: { dedupeKey: input.dedupeKey },
      update: {},
      create: {
        dedupeKey: input.dedupeKey,
        type: input.type,
        cycleId: input.cycleId,
        taskId: input.taskId,
        stage: input.stage,
        openedAt: input.openedAt,
        deadlineAt: input.deadlineAt,
        receiverOpenId: input.receiverOpenId,
        channel: input.channel,
        template: input.template,
        payload: input.payload,
      },
    });
  }

  /** 结果版本与通知事件在同一业务事务提交，消费者失败可按 outbox 重试。 */
  enqueueResultPublishedEvent(
    input: {
      cycleId: number;
      cycleName: string;
      participantId: number;
      resultVersionId: number;
      version: number;
      receiverOpenId: string;
    },
    transaction?: NotificationEventWriter,
  ) {
    return this.enqueue(
      {
        dedupeKey: resultPublishedDedupeKey(input),
        type: 'RESULT_PUBLISHED',
        cycleId: input.cycleId,
        receiverOpenId: input.receiverOpenId,
        channel: PerfNotificationChannel.BOT_DM,
        template: 'result_published',
        payload: {
          cycleId: input.cycleId,
          cycleName: input.cycleName,
          participantId: input.participantId,
          resultVersionId: input.resultVersionId,
          version: input.version,
        },
      },
      transaction,
    );
  }

  /** 任务开放事件按接收人拆分，抄送人与执行人为同一人时自动去重。 */
  enqueueTaskOpenedEvents(
    input: TaskOpenedEventInput,
    transaction?: NotificationEventWriter,
  ) {
    const openedAt = input.openedAt;
    if (!input.rule.enabled || !openedAt) return Promise.resolve([]);
    return Promise.all(
      notificationRecipients(input, input.rule).map((receiverOpenId) =>
        this.enqueue(
          {
            dedupeKey: taskOpenedDedupeKey({
              taskId: input.id,
              openedAt,
              receiverOpenId,
            }),
            type: 'TASK_OPENED',
            cycleId: input.cycleId,
            taskId: input.id,
            stage: input.type,
            openedAt,
            receiverOpenId,
            channel: PerfNotificationChannel.BOT_DM,
            template: 'evaluation_task_opened',
            payload: {
              cycleId: input.cycleId,
              cycleName: input.cycleName,
              taskId: input.id,
              stage: input.type,
              openedAt: openedAt.toISOString(),
            },
          },
          transaction,
        ),
      ),
    );
  }

  /** 软截止提醒只入通知事件，不修改任务开放/完成状态。 */
  enqueueTaskReminderEvents(
    input: TaskReminderEventInput,
    transaction?: NotificationEventWriter,
  ) {
    const deadlineAt = input.reminderDeadlineAt;
    if (!input.rule.enabled || !deadlineAt) {
      return Promise.resolve([]);
    }
    return Promise.all(
      notificationRecipients(input, input.rule).map((receiverOpenId) =>
        this.enqueue(
          {
            dedupeKey: taskReminderDedupeKey({
              taskId: input.id,
              deadlineAt,
              reminderAt: input.reminderAt,
              receiverOpenId,
            }),
            type: 'TASK_REMINDER_DUE',
            cycleId: input.cycleId,
            taskId: input.id,
            stage: input.type,
            deadlineAt,
            receiverOpenId,
            channel: PerfNotificationChannel.BOT_DM,
            template: 'evaluation_task_reminder',
            payload: {
              cycleId: input.cycleId,
              cycleName: input.cycleName,
              taskId: input.id,
              stage: input.type,
              deadlineAt: deadlineAt.toISOString(),
              reminderAt: input.reminderAt.toISOString(),
            },
          },
          transaction,
        ),
      ),
    );
  }

  /**
   * 启动失败通知周期负责人和所有已授权 HR/Admin，并携带可直接处理的问题列表。
   * 检查结果摘要进入业务键，同一问题每位接收人只提醒一次。
   */
  async enqueueCycleStartFailure(input: {
    cycleId: number;
    cycleName: string;
    ownerOpenId: string;
    issues: readonly { code: string; path?: string; message: string }[];
  }) {
    const managementGrants = await this.prisma.roleGrant.findMany({
      where: { role: { in: [PerfRole.HR, PerfRole.ADMIN] } },
      select: { userOpenId: true },
    });
    const receivers = new Set([
      input.ownerOpenId,
      ...managementGrants.map((grant) => grant.userOpenId),
    ]);
    const issuePayload = input.issues.map((issue) => ({
      code: issue.code,
      path: issue.path,
      message: issue.message,
    }));
    const checkDigest = createHash('sha256')
      .update(JSON.stringify(issuePayload))
      .digest('hex')
      .slice(0, 24);
    return Promise.all(
      [...receivers].map((receiverOpenId) =>
        this.enqueue({
          dedupeKey: cycleStartFailedDedupeKey({
            cycleId: input.cycleId,
            checkDigest,
            receiverOpenId,
          }),
          type: 'CYCLE_START_FAILED',
          cycleId: input.cycleId,
          receiverOpenId,
          channel: PerfNotificationChannel.BOT_DM,
          template: 'cycle_start_failed',
          payload: {
            cycleId: input.cycleId,
            cycleName: input.cycleName,
            issues: issuePayload,
          },
        }),
      ),
    );
  }

  /**
   * 扫描仍未完成的到期人工任务并按周期快照生成提醒事件。
   * 重复扫描只会命中相同 dedupeKey；截止时间不会关闭任务。
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async enqueueDueTaskReminders(now = new Date()) {
    const rawCursor = await this.redis.get(REMINDER_SCAN_CURSOR_KEY);
    const cursor = Number.isSafeInteger(Number(rawCursor))
      ? Number(rawCursor)
      : 0;
    const tasks = await this.prisma.perfEvaluationTask.findMany({
      where: {
        id: { gt: cursor },
        completedAt: null,
        openedAt: { not: null },
        reminderDeadlineAt: { not: null, lte: now },
        type: { not: PerfEvaluationTaskType.AI },
        OR: [
          { assigneeOpenId: { not: null } },
          { type: PerfEvaluationTaskType.PEER },
        ],
        cycle: { status: PerfCycleStatus.ACTIVE, deletedAt: null },
      },
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
      orderBy: { id: 'asc' },
      take: 200,
    });

    if (tasks.length === 0) {
      // 一轮扫描完成后回绕；下一分钟从头检查新的重复提醒批次。
      if (cursor > 0) await this.redis.del(REMINDER_SCAN_CURSOR_KEY);
      return { eventCount: 0 };
    }

    let eventCount = 0;
    for (const task of tasks) {
      const rules = task.cycle.currentConfigVersion
        ?.notificationRules as unknown as NotificationRules | undefined;
      const rule = rules?.stages.find(
        (item) => item.stage === task.type,
      )?.reminder;
      if (!rule || !task.reminderDeadlineAt) continue;
      const reminderAt = reminderOccurrenceAt(
        task.reminderDeadlineAt,
        rule.frequency,
        now,
      );
      if (!reminderAt) continue;
      const created = await this.enqueueTaskReminderEvents({
        id: task.id,
        cycleId: task.cycleId,
        type: task.type,
        assigneeOpenId: task.assigneeOpenId,
        openedAt: task.openedAt,
        reminderDeadlineAt: task.reminderDeadlineAt,
        cycleName: task.cycle.name,
        cycleOwnerOpenId: task.cycle.ownerOpenId,
        leaderOpenId: task.participant.leaderOpenIdSnapshot,
        peerReviewerOpenIds: task.participant.reviewerAssignments.map(
          (assignment) => assignment.reviewerOpenId,
        ),
        rule,
        reminderAt,
      });
      eventCount += created.length;
    }
    await this.redis.set(
      REMINDER_SCAN_CURSOR_KEY,
      String(tasks.at(-1)?.id ?? cursor),
      'EX',
      86_400,
    );
    return { eventCount };
  }

  /** 每分钟消费一批到期事件；Redis 锁只减少竞争，数据库唯一键才是幂等底线。 */
  @Cron(CronExpression.EVERY_MINUTE)
  async processPendingEvents() {
    const lockToken = randomUUID();
    const locked = await this.redis.set(
      EVENT_BATCH_LOCK_KEY,
      lockToken,
      'EX',
      55,
      'NX',
    );
    if (!locked) return;

    try {
      const events = await this.prisma.perfNotificationEvent.findMany({
        where: {
          status: {
            in: [
              PerfNotificationEventStatus.PENDING,
              PerfNotificationEventStatus.RETRYING,
            ],
          },
          availableAt: { lte: new Date() },
        },
        orderBy: { id: 'asc' },
        take: 100,
      });
      for (const event of events) {
        await this.processEvent(event.id);
      }
    } finally {
      // 只释放自己持有的锁，避免超时后误删下一任 worker 的锁。
      await this.redis.eval(
        RELEASE_LOCK_SCRIPT,
        1,
        EVENT_BATCH_LOCK_KEY,
        lockToken,
      );
    }
  }

  /**
   * 至少一次消费下的幂等处理：sourceEventId 唯一键 + 同事务 upsert，
   * 即使事件被重复投递，也只会形成一条待发送通知。
   */
  async processEvent(eventId: number) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const event = await tx.perfNotificationEvent.findUnique({
          where: { id: eventId },
        });
        if (
          !event ||
          (event.status !== PerfNotificationEventStatus.PENDING &&
            event.status !== PerfNotificationEventStatus.RETRYING)
        ) {
          return;
        }

        await tx.perfNotification.upsert({
          where: { sourceEventId: event.id },
          update: {},
          create: {
            sourceEventId: event.id,
            receiverOpenId: event.receiverOpenId,
            channel: event.channel,
            template: event.template,
            payload: event.payload ?? undefined,
          },
        });
        await tx.perfNotificationEvent.update({
          where: { id: event.id },
          data: {
            status: PerfNotificationEventStatus.COMPLETED,
            processedAt: new Date(),
            errorMessage: null,
          },
        });
      });
    } catch (error) {
      await this.recordFailure(eventId, error);
    }
  }

  private async recordFailure(eventId: number, error: unknown) {
    const event = await this.prisma.perfNotificationEvent.findUnique({
      where: { id: eventId },
    });
    if (
      !event ||
      event.status === PerfNotificationEventStatus.COMPLETED ||
      event.status === PerfNotificationEventStatus.FAILED
    ) {
      return;
    }

    const attemptCount = event.attemptCount + 1;
    const failed = attemptCount >= MAX_EVENT_ATTEMPTS;
    const message = String((error as Error)?.message ?? error);
    // 指数退避按分钟增长；失败终态仍保留事件，便于人工定位和后续补偿。
    const availableAt = new Date(Date.now() + 2 ** attemptCount * 60_000);
    this.logger.warn(
      `通知事件消费失败 #${eventId}（第 ${attemptCount} 次）：${message}`,
    );
    await this.prisma.perfNotificationEvent.update({
      where: { id: eventId },
      data: {
        status: failed
          ? PerfNotificationEventStatus.FAILED
          : PerfNotificationEventStatus.RETRYING,
        attemptCount,
        availableAt,
        errorMessage: message,
      },
    });
  }
}
