-- 面谈独立生命周期：状态 + 预约时间 + 飞书日程关联 + 结果纪要
CREATE TYPE "performance"."PerfInterviewStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

ALTER TABLE "performance"."perf_interviews"
  ADD COLUMN "status" "performance"."PerfInterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
  ADD COLUMN "organizer_open_id" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "scheduled_start_at" TIMESTAMP(3),
  ADD COLUMN "scheduled_end_at" TIMESTAMP(3),
  ADD COLUMN "calendar_id" TEXT,
  ADD COLUMN "calendar_event_id" TEXT,
  ADD COLUMN "result_notes" TEXT;

-- 回填：有旧纪要视为已完成；组织者取参与人列表首项
UPDATE "performance"."perf_interviews"
SET
  "status" = CASE
    WHEN COALESCE("content", "conclusion", "employee_feedback") IS NOT NULL THEN 'COMPLETED'::"performance"."PerfInterviewStatus"
    ELSE 'SCHEDULED'::"performance"."PerfInterviewStatus"
  END,
  "organizer_open_id" = COALESCE("participant_open_ids"[1], 'legacy'),
  "result_notes" = COALESCE("conclusion", "content");

ALTER TABLE "performance"."perf_interviews"
  ALTER COLUMN "organizer_open_id" DROP DEFAULT;

CREATE INDEX "perf_interviews_status_idx" ON "performance"."perf_interviews"("status");
