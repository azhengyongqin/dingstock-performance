-- Ticket 05：通知事件 outbox。数据库唯一键保证重复调度/消费不产生重复通知。
CREATE TYPE "performance"."PerfNotificationEventType" AS ENUM (
    'TASK_OPENED',
    'TASK_REMINDER_DUE',
    'CYCLE_START_FAILED'
);

CREATE TYPE "performance"."PerfNotificationEventStatus" AS ENUM (
    'PENDING',
    'RETRYING',
    'COMPLETED',
    'FAILED'
);

-- 通知模块按软截止时间全局扫描，不能依赖以 cycle_id 开头的任务索引。
CREATE INDEX "perf_evaluation_tasks_reminder_deadline_at_completed_at_opened_at_idx"
    ON "performance"."perf_evaluation_tasks"("reminder_deadline_at", "completed_at", "opened_at");

CREATE TABLE "performance"."perf_notification_events" (
    "id" SERIAL NOT NULL,
    "dedupe_key" VARCHAR(512) NOT NULL,
    "type" "performance"."PerfNotificationEventType" NOT NULL,
    "status" "performance"."PerfNotificationEventStatus" NOT NULL DEFAULT 'PENDING',
    "cycle_id" INTEGER,
    "task_id" INTEGER,
    "stage" "performance"."PerfEvaluationTaskType",
    "opened_at" TIMESTAMP(3),
    "deadline_at" TIMESTAMP(3),
    "receiver_open_id" TEXT NOT NULL,
    "channel" "performance"."PerfNotificationChannel" NOT NULL,
    "template" TEXT NOT NULL,
    "payload" JSONB,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perf_notification_events_pkey" PRIMARY KEY ("id"),
    -- 不同事件必须携带完整且互不混淆的业务定位字段。
    CONSTRAINT "perf_notification_events_shape_check" CHECK (
        (
            "type" = 'TASK_OPENED'
            AND "cycle_id" IS NOT NULL
            AND "task_id" IS NOT NULL
            AND "stage" IS NOT NULL
            AND "stage" <> 'AI'
            AND "opened_at" IS NOT NULL
            AND "deadline_at" IS NULL
        )
        OR (
            "type" = 'TASK_REMINDER_DUE'
            AND "cycle_id" IS NOT NULL
            AND "task_id" IS NOT NULL
            AND "stage" IS NOT NULL
            AND "stage" <> 'AI'
            AND "opened_at" IS NULL
            AND "deadline_at" IS NOT NULL
        )
        OR (
            "type" = 'CYCLE_START_FAILED'
            AND "cycle_id" IS NOT NULL
            AND "task_id" IS NULL
            AND "stage" IS NULL
            AND "opened_at" IS NULL
            AND "deadline_at" IS NULL
        )
    )
);

CREATE UNIQUE INDEX "perf_notification_events_dedupe_key_key"
    ON "performance"."perf_notification_events"("dedupe_key");
CREATE INDEX "perf_notification_events_status_available_at_idx"
    ON "performance"."perf_notification_events"("status", "available_at");
CREATE INDEX "perf_notification_events_cycle_id_type_stage_idx"
    ON "performance"."perf_notification_events"("cycle_id", "type", "stage");
CREATE INDEX "perf_notification_events_task_id_type_opened_at_deadline_at_idx"
    ON "performance"."perf_notification_events"("task_id", "type", "opened_at", "deadline_at");
CREATE INDEX "perf_notification_events_receiver_open_id_created_at_idx"
    ON "performance"."perf_notification_events"("receiver_open_id", "created_at");

ALTER TABLE "performance"."perf_notification_events"
    ADD CONSTRAINT "perf_notification_events_cycle_id_fkey"
    FOREIGN KEY ("cycle_id") REFERENCES "performance"."perf_cycles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- task_id 单列外键只能证明任务存在；触发器进一步保证事件没有伪造跨周期或错阶段引用。
CREATE FUNCTION "performance"."validate_notification_event_task_reference"()
RETURNS TRIGGER AS $$
DECLARE
    task_cycle_id INTEGER;
    task_type "performance"."PerfEvaluationTaskType";
BEGIN
    IF NEW."task_id" IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT "cycle_id", "type"
      INTO task_cycle_id, task_type
      FROM "performance"."perf_evaluation_tasks"
     WHERE "id" = NEW."task_id";

    IF task_cycle_id IS NULL THEN
        RAISE EXCEPTION 'notification event task % does not exist', NEW."task_id";
    END IF;
    IF task_cycle_id <> NEW."cycle_id" OR task_type <> NEW."stage" THEN
        RAISE EXCEPTION 'notification event task %, cycle %, stage % mismatch',
            NEW."task_id", NEW."cycle_id", NEW."stage";
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "perf_notification_events_validate_task_reference"
BEFORE INSERT OR UPDATE OF "task_id", "cycle_id", "stage"
ON "performance"."perf_notification_events"
FOR EACH ROW
EXECUTE FUNCTION "performance"."validate_notification_event_task_reference"();
ALTER TABLE "performance"."perf_notification_events"
    ADD CONSTRAINT "perf_notification_events_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "performance"."perf_evaluation_tasks"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "performance"."perf_notifications"
    ADD COLUMN "source_event_id" INTEGER;

CREATE UNIQUE INDEX "perf_notifications_source_event_id_key"
    ON "performance"."perf_notifications"("source_event_id");

ALTER TABLE "performance"."perf_notifications"
    ADD CONSTRAINT "perf_notifications_source_event_id_fkey"
    FOREIGN KEY ("source_event_id") REFERENCES "performance"."perf_notification_events"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
