-- Ticket 05：统一任务事实。开始时间是硬开放门槛，提醒截止时间只驱动通知。
CREATE TYPE "performance"."PerfEvaluationTaskType" AS ENUM ('SELF', 'PEER', 'MANAGER', 'AI');

CREATE TABLE "performance"."perf_evaluation_tasks" (
    "id" SERIAL NOT NULL,
    "cycle_id" INTEGER NOT NULL,
    "participant_id" INTEGER NOT NULL,
    "type" "performance"."PerfEvaluationTaskType" NOT NULL,
    "assignee_open_id" TEXT,
    "start_at" TIMESTAMP(3),
    "reminder_deadline_at" TIMESTAMP(3),
    "opened_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perf_evaluation_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "perf_evaluation_tasks_participant_id_type_key"
    ON "performance"."perf_evaluation_tasks"("participant_id", "type");
-- 复合外键阻止把 A 周期参与人的任务错误挂到 B 周期。
CREATE UNIQUE INDEX "perf_participants_id_cycle_id_key"
    ON "performance"."perf_participants"("id", "cycle_id");
CREATE INDEX "perf_evaluation_tasks_cycle_id_type_start_at_idx"
    ON "performance"."perf_evaluation_tasks"("cycle_id", "type", "start_at");
CREATE INDEX "perf_evaluation_tasks_cycle_id_type_reminder_deadline_at_idx"
    ON "performance"."perf_evaluation_tasks"("cycle_id", "type", "reminder_deadline_at");
CREATE INDEX "perf_evaluation_tasks_assignee_open_id_type_opened_at_idx"
    ON "performance"."perf_evaluation_tasks"("assignee_open_id", "type", "opened_at");

ALTER TABLE "performance"."perf_evaluation_tasks"
    ADD CONSTRAINT "perf_evaluation_tasks_cycle_id_fkey"
    FOREIGN KEY ("cycle_id") REFERENCES "performance"."perf_cycles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "performance"."perf_evaluation_tasks"
    ADD CONSTRAINT "perf_evaluation_tasks_participant_id_cycle_id_fkey"
    FOREIGN KEY ("participant_id", "cycle_id") REFERENCES "performance"."perf_participants"("id", "cycle_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- opened_at 是任务已经对填写人开放的不可逆事实，应用误写也不能清空或改写首次时间。
CREATE FUNCTION "performance"."protect_perf_task_opened_at"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."opened_at" IS NOT NULL
     AND NEW."opened_at" IS DISTINCT FROM OLD."opened_at" THEN
    RAISE EXCEPTION 'opened_at is immutable once evaluation task is opened';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_protect_perf_task_opened_at"
BEFORE UPDATE ON "performance"."perf_evaluation_tasks"
FOR EACH ROW EXECUTE FUNCTION "performance"."protect_perf_task_opened_at"();
