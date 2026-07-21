-- Ticket 3：补齐申诉/面谈通知事件类型；移除遗留 PerfInterviewType 列与枚举

ALTER TYPE "performance"."PerfNotificationEventType" ADD VALUE IF NOT EXISTS 'APPEAL_CREATED';
ALTER TYPE "performance"."PerfNotificationEventType" ADD VALUE IF NOT EXISTS 'INTERVIEW_SCHEDULED';
ALTER TYPE "performance"."PerfNotificationEventType" ADD VALUE IF NOT EXISTS 'INTERVIEW_CANCELLED';
ALTER TYPE "performance"."PerfNotificationEventType" ADD VALUE IF NOT EXISTS 'APPEAL_RESOLVED_MAINTAINED';

-- 申诉/面谈通知与结果类事件同形：绑定周期，不绑定人工任务阶段
ALTER TABLE "performance"."perf_notification_events"
  DROP CONSTRAINT "perf_notification_events_shape_check",
  ADD CONSTRAINT "perf_notification_events_shape_check" CHECK (
    (
      "type" = 'TASK_OPENED'
      AND "cycle_id" IS NOT NULL AND "task_id" IS NOT NULL
      AND "stage" IS NOT NULL AND "stage" <> 'AI'
      AND "opened_at" IS NOT NULL AND "deadline_at" IS NULL
    )
    OR (
      "type" = 'TASK_REMINDER_DUE'
      AND "cycle_id" IS NOT NULL AND "task_id" IS NOT NULL
      AND "stage" IS NOT NULL AND "stage" <> 'AI'
      AND "opened_at" IS NULL AND "deadline_at" IS NOT NULL
    )
    OR (
      "type" IN (
        'CYCLE_START_FAILED',
        'RESULT_PUBLISHED',
        'RESULT_INVALIDATED',
        'APPEAL_CREATED',
        'INTERVIEW_SCHEDULED',
        'INTERVIEW_CANCELLED',
        'APPEAL_RESOLVED_MAINTAINED'
      )
      AND "cycle_id" IS NOT NULL AND "task_id" IS NULL
      AND "stage" IS NULL AND "opened_at" IS NULL AND "deadline_at" IS NULL
    )
  );

ALTER TABLE "performance"."perf_interviews" DROP COLUMN IF EXISTS "type";

DROP TYPE IF EXISTS "performance"."PerfInterviewType";
