-- Ticket 11：AI 只作为独立异步参考。输入修订与运行修订分离，防止旧任务覆盖新输入。
ALTER TABLE "performance"."perf_ai_reports"
  ADD COLUMN "reference_level" "performance"."PerfRatingSymbol",
  ADD COLUMN "input_snapshot" JSONB,
  ADD COLUMN "input_revision" TEXT,
  ADD COLUMN "processing_revision" TEXT,
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "started_at" TIMESTAMP(3);

-- 升级时不能继续认领缺少输入修订的旧运行任务；保留记录并转为可人工重排的失败态。
UPDATE "performance"."perf_ai_reports"
SET "status" = 'FAILED',
    "error_message" = COALESCE("error_message", '模型升级后需按当前有效输入重新生成')
WHERE "status" = 'GENERATING';

ALTER TABLE "performance"."perf_ai_reports"
  ADD CONSTRAINT "perf_ai_reports_attempt_count_check"
    CHECK ("attempt_count" >= 0),
  ADD CONSTRAINT "perf_ai_reports_input_revision_check"
    CHECK ("input_revision" IS NULL OR char_length("input_revision") = 64),
  ADD CONSTRAINT "perf_ai_reports_input_snapshot_revision_pair_check"
    CHECK (("input_snapshot" IS NULL) = ("input_revision" IS NULL)),
  ADD CONSTRAINT "perf_ai_reports_processing_revision_check"
    CHECK (
      ("status" = 'GENERATING'
        AND "input_revision" IS NOT NULL
        AND "processing_revision" = "input_revision"
        AND "started_at" IS NOT NULL)
      OR
      ("status" <> 'GENERATING'
        AND "processing_revision" IS NULL
        AND "started_at" IS NULL)
    );

DROP INDEX IF EXISTS "performance"."perf_ai_reports_status_idx";
CREATE INDEX "perf_ai_reports_status_available_at_idx"
  ON "performance"."perf_ai_reports"("status", "available_at");
