import type {
  PerfEvaluationTaskType,
  PerfNotificationChannel,
} from '../generated/prisma/enums';
import type {
  NotificationTargetRule,
  ReminderFrequency,
} from '../config-template/config-template.contract';
import type { Prisma } from '../generated/prisma/client';

/**
 * 业务通知事件的稳定输入契约。
 * dedupeKey 必须包含业务对象与事件发生时间，确保调度器重复扫描也只入队一次。
 */
export type EnqueueNotificationEventInput = {
  dedupeKey: string;
  type:
    | 'TASK_OPENED'
    | 'TASK_REMINDER_DUE'
    | 'CYCLE_START_FAILED'
    | 'RESULT_PUBLISHED'
    | 'RESULT_INVALIDATED'
    | 'APPEAL_CREATED'
    | 'INTERVIEW_SCHEDULED'
    | 'INTERVIEW_CANCELLED'
    | 'APPEAL_RESOLVED_MAINTAINED';
  cycleId?: number;
  taskId?: number;
  stage?: PerfEvaluationTaskType;
  openedAt?: Date;
  deadlineAt?: Date;
  receiverOpenId: string;
  channel: PerfNotificationChannel;
  template: string;
  payload?: Prisma.InputJsonValue;
};

/** 构造任务开放事件的唯一业务键，供周期调度器与通知消费者共同复用。 */
export function taskOpenedDedupeKey(input: {
  taskId: number;
  openedAt: Date;
  receiverOpenId: string;
}) {
  return `task-opened:${input.taskId}:${input.openedAt.toISOString()}:${input.receiverOpenId}`;
}

/** 构造软截止提醒事件的唯一业务键；截止时间变化会产生新的提醒事件。 */
export function taskReminderDedupeKey(input: {
  taskId: number;
  deadlineAt: Date;
  reminderAt?: Date;
  receiverOpenId: string;
}) {
  const occurrence = input.reminderAt ?? input.deadlineAt;
  return `task-reminder:${input.taskId}:${input.deadlineAt.toISOString()}:${occurrence.toISOString()}:${input.receiverOpenId}`;
}

/**
 * 启动失败按一次检查结果去重；同一问题重复扫描不会轰炸 HR/Admin，
 * 修复后出现新的检查结果则可再次通知。
 */
export function cycleStartFailedDedupeKey(input: {
  cycleId: number;
  checkDigest: string;
  receiverOpenId: string;
}) {
  return `cycle-start-failed:${input.cycleId}:${input.checkDigest}:${input.receiverOpenId}`;
}

/** 一个不可变结果版本只向同一员工发布一次，重试发布不会重复通知。 */
export function resultPublishedDedupeKey(input: {
  resultVersionId: number;
  receiverOpenId: string;
}) {
  return `result-published:${input.resultVersionId}:${input.receiverOpenId}`;
}

/** 一次周期退回只向一个已收到结果的员工生成一条失效通知。 */
export function resultInvalidatedDedupeKey(input: {
  rollbackId: number;
  receiverOpenId: string;
}) {
  return `result-invalidated:${input.rollbackId}:${input.receiverOpenId}`;
}

/** 一次申诉发起对每个接收人只入队一条处理提醒。 */
export function appealCreatedDedupeKey(input: {
  appealId: number;
  receiverOpenId: string;
}) {
  return `appeal-created:${input.appealId}:${input.receiverOpenId}`;
}

/** 一次面谈预约只向员工发一条应用通知（日历邀请另计）。 */
export function interviewScheduledDedupeKey(input: {
  interviewId: number;
  receiverOpenId: string;
}) {
  return `interview-scheduled:${input.interviewId}:${input.receiverOpenId}`;
}

/** 一次面谈取消对每个参与人只入队一条通知。 */
export function interviewCancelledDedupeKey(input: {
  interviewId: number;
  receiverOpenId: string;
}) {
  return `interview-cancelled:${input.interviewId}:${input.receiverOpenId}`;
}

/** 结案维持等级时，同一申诉对员工只通知一次。 */
export function appealResolvedMaintainedDedupeKey(input: {
  appealId: number;
  receiverOpenId: string;
}) {
  return `appeal-resolved-maintained:${input.appealId}:${input.receiverOpenId}`;
}

export type TaskNotificationContext = {
  id: number;
  cycleId: number;
  type: PerfEvaluationTaskType;
  assigneeOpenId: string | null;
  openedAt: Date | null;
  reminderDeadlineAt: Date | null;
  cycleName: string;
  cycleOwnerOpenId: string;
  leaderOpenId: string | null;
  /** PEER 协调任务没有单一 assignee，由所有有效评审员共同作为执行人。 */
  peerReviewerOpenIds?: readonly string[];
};

export type TaskOpenedEventInput = TaskNotificationContext & {
  rule: NotificationTargetRule;
};

export type TaskReminderEventInput = TaskNotificationContext & {
  rule: NotificationTargetRule & { frequency: ReminderFrequency };
  reminderAt: Date;
};
