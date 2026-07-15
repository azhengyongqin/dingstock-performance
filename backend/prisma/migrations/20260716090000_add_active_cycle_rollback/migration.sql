-- Ticket 17：超级管理员整体退回 ACTIVE 周期，保留并显式失效后续结果链。
ALTER TYPE "performance"."PerfNotificationEventType"
  ADD VALUE IF NOT EXISTS 'RESULT_INVALIDATED';

-- 结果发布与退回通知都属于周期事件，不绑定人工任务或阶段。
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
      "type" IN ('CYCLE_START_FAILED', 'RESULT_PUBLISHED', 'RESULT_INVALIDATED')
      AND "cycle_id" IS NOT NULL AND "task_id" IS NULL
      AND "stage" IS NULL AND "opened_at" IS NULL AND "deadline_at" IS NULL
    )
  );

CREATE TABLE "performance"."perf_cycle_rollbacks" (
  "id" SERIAL NOT NULL,
  "cycle_id" INTEGER NOT NULL,
  "target_status" "performance"."PerfCycleStatus" NOT NULL,
  "reason" TEXT NOT NULL,
  "impact_summary" JSONB NOT NULL,
  "operator_open_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "perf_cycle_rollbacks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_cycle_rollbacks_target_status_check"
    CHECK ("target_status" IN ('DRAFT', 'SCHEDULED')),
  CONSTRAINT "perf_cycle_rollbacks_reason_check"
    CHECK (btrim("reason") <> ''),
  CONSTRAINT "perf_cycle_rollbacks_impact_summary_check"
    CHECK (jsonb_typeof("impact_summary") = 'object'),
  CONSTRAINT "perf_cycle_rollbacks_operator_check"
    CHECK (btrim("operator_open_id") <> '')
);

CREATE INDEX "perf_cycle_rollbacks_cycle_id_created_at_idx"
  ON "performance"."perf_cycle_rollbacks"("cycle_id", "created_at");
CREATE INDEX "perf_cycle_rollbacks_operator_open_id_idx"
  ON "performance"."perf_cycle_rollbacks"("operator_open_id");

ALTER TABLE "performance"."perf_cycle_rollbacks"
  ADD CONSTRAINT "perf_cycle_rollbacks_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "performance"."perf_cycles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "performance"."perf_calibrations"
  ADD COLUMN "invalidated_at" TIMESTAMP(3),
  ADD COLUMN "invalidated_by_rollback_id" INTEGER;
ALTER TABLE "performance"."perf_results"
  ADD COLUMN "invalidated_at" TIMESTAMP(3),
  ADD COLUMN "invalidated_by_rollback_id" INTEGER;
ALTER TABLE "performance"."perf_result_versions"
  ADD COLUMN "invalidated_at" TIMESTAMP(3),
  ADD COLUMN "invalidated_by_rollback_id" INTEGER;
ALTER TABLE "performance"."perf_appeals"
  ADD COLUMN "invalidated_at" TIMESTAMP(3),
  ADD COLUMN "invalidated_by_rollback_id" INTEGER;

ALTER TABLE "performance"."perf_calibrations"
  ADD CONSTRAINT "perf_calibrations_invalidation_pair_check"
    CHECK (("invalidated_at" IS NULL) = ("invalidated_by_rollback_id" IS NULL)),
  ADD CONSTRAINT "perf_calibrations_invalidation_rollback_fkey"
    FOREIGN KEY ("invalidated_by_rollback_id") REFERENCES "performance"."perf_cycle_rollbacks"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance"."perf_results"
  ADD CONSTRAINT "perf_results_invalidation_pair_check"
    CHECK (("invalidated_at" IS NULL) = ("invalidated_by_rollback_id" IS NULL)),
  ADD CONSTRAINT "perf_results_invalidation_rollback_fkey"
    FOREIGN KEY ("invalidated_by_rollback_id") REFERENCES "performance"."perf_cycle_rollbacks"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance"."perf_result_versions"
  ADD CONSTRAINT "perf_result_versions_invalidation_pair_check"
    CHECK (("invalidated_at" IS NULL) = ("invalidated_by_rollback_id" IS NULL)),
  ADD CONSTRAINT "perf_result_versions_invalidation_rollback_fkey"
    FOREIGN KEY ("invalidated_by_rollback_id") REFERENCES "performance"."perf_cycle_rollbacks"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance"."perf_appeals"
  ADD CONSTRAINT "perf_appeals_invalidation_pair_check"
    CHECK (("invalidated_at" IS NULL) = ("invalidated_by_rollback_id" IS NULL)),
  ADD CONSTRAINT "perf_appeals_invalidation_rollback_fkey"
    FOREIGN KEY ("invalidated_by_rollback_id") REFERENCES "performance"."perf_cycle_rollbacks"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "perf_calibrations_participant_id_invalidated_at_idx"
  ON "performance"."perf_calibrations"("participant_id", "invalidated_at");
CREATE INDEX "perf_calibrations_invalidated_by_rollback_id_idx"
  ON "performance"."perf_calibrations"("invalidated_by_rollback_id");
CREATE INDEX "perf_results_invalidated_by_rollback_id_idx"
  ON "performance"."perf_results"("invalidated_by_rollback_id");
CREATE INDEX "perf_result_versions_participant_id_invalidated_at_idx"
  ON "performance"."perf_result_versions"("participant_id", "invalidated_at");
CREATE INDEX "perf_result_versions_invalidated_by_rollback_id_idx"
  ON "performance"."perf_result_versions"("invalidated_by_rollback_id");
CREATE INDEX "perf_appeals_participant_id_invalidated_at_idx"
  ON "performance"."perf_appeals"("participant_id", "invalidated_at");
CREATE INDEX "perf_appeals_invalidated_by_rollback_id_idx"
  ON "performance"."perf_appeals"("invalidated_by_rollback_id");

-- 退回失效版本后，重新激活可发布新的当前版本。
DROP INDEX "performance"."perf_result_versions_current_key";
CREATE UNIQUE INDEX "perf_result_versions_current_key"
  ON "performance"."perf_result_versions"("participant_id")
  WHERE "superseded_at" IS NULL AND "invalidated_at" IS NULL;

-- 每轮有效结果只允许一次申诉；周期退回后的历史申诉不阻止新结果再次申诉。
DROP INDEX "performance"."perf_appeals_current_participant_key";
CREATE UNIQUE INDEX "perf_appeals_current_participant_key"
  ON "performance"."perf_appeals"("participant_id")
  WHERE NOT "is_legacy" AND "invalidated_at" IS NULL;

CREATE OR REPLACE FUNCTION "performance"."reject_second_appeal"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."is_legacy" THEN
    RAISE EXCEPTION 'new appeal cannot be marked legacy';
  END IF;
  PERFORM 1 FROM "performance"."perf_participants"
  WHERE "id" = NEW."participant_id" FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM "performance"."perf_appeals"
    WHERE "participant_id" = NEW."participant_id"
      AND "invalidated_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'participant already has an active appeal chain';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER "perf_calibrations_append_only" ON "performance"."perf_calibrations";
CREATE OR REPLACE FUNCTION "performance"."guard_calibration_invalidation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'perf_calibrations is append-only; DELETE is forbidden';
  END IF;
  IF (to_jsonb(NEW) - 'invalidated_at' - 'invalidated_by_rollback_id')
      IS DISTINCT FROM
     (to_jsonb(OLD) - 'invalidated_at' - 'invalidated_by_rollback_id') THEN
    RAISE EXCEPTION 'perf_calibrations business decision is append-only';
  END IF;
  IF OLD."invalidated_at" IS NOT NULL
    OR NEW."invalidated_at" IS NULL
    OR NEW."invalidated_by_rollback_id" IS NULL THEN
    RAISE EXCEPTION 'calibration invalidation can only be set once';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "perf_calibrations_append_only"
BEFORE UPDATE OR DELETE ON "performance"."perf_calibrations"
FOR EACH ROW EXECUTE FUNCTION "performance"."guard_calibration_invalidation"();

CREATE OR REPLACE FUNCTION "performance"."guard_result_version_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'perf_result_versions is immutable; DELETE is forbidden';
  END IF;
  IF NEW."id" <> OLD."id"
    OR NEW."participant_id" <> OLD."participant_id"
    OR NEW."version" <> OLD."version"
    OR NEW."final_level" <> OLD."final_level"
    OR NEW."employee_explanation" IS DISTINCT FROM OLD."employee_explanation"
    OR NEW."source_calibration_id" IS DISTINCT FROM OLD."source_calibration_id"
    OR NEW."result_snapshot" IS DISTINCT FROM OLD."result_snapshot"
    OR NEW."published_by_open_id" <> OLD."published_by_open_id"
    OR NEW."published_at" <> OLD."published_at"
    OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'perf_result_versions business snapshot is immutable';
  END IF;
  IF OLD."superseded_at" IS NOT NULL
    AND NEW."superseded_at" IS DISTINCT FROM OLD."superseded_at" THEN
    RAISE EXCEPTION 'result version superseded_at can only be set once';
  END IF;
  IF OLD."confirmed_at" IS NOT NULL
    AND (NEW."confirmed_at" IS DISTINCT FROM OLD."confirmed_at"
      OR NEW."confirmed_by_open_id" IS DISTINCT FROM OLD."confirmed_by_open_id") THEN
    RAISE EXCEPTION 'result version confirmation can only be set once';
  END IF;
  IF OLD."invalidated_at" IS NOT NULL
    AND (NEW."invalidated_at" IS DISTINCT FROM OLD."invalidated_at"
      OR NEW."invalidated_by_rollback_id" IS DISTINCT FROM OLD."invalidated_by_rollback_id") THEN
    RAISE EXCEPTION 'result version invalidation can only be set once';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "performance"."guard_appeal_binding_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."participant_id" <> OLD."participant_id"
    OR NEW."result_version_id" <> OLD."result_version_id"
    OR NEW."reason" <> OLD."reason"
    OR NEW."attachments" IS DISTINCT FROM OLD."attachments"
    OR NEW."is_legacy" <> OLD."is_legacy"
    OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'appeal source binding is immutable';
  END IF;
  IF OLD."invalidated_at" IS NOT NULL
    AND (NEW."invalidated_at" IS DISTINCT FROM OLD."invalidated_at"
      OR NEW."invalidated_by_rollback_id" IS DISTINCT FROM OLD."invalidated_by_rollback_id") THEN
    RAISE EXCEPTION 'appeal invalidation can only be set once';
  END IF;
  IF OLD."status" = 'RESOLVED'
    AND NEW."invalidated_at" IS NOT DISTINCT FROM OLD."invalidated_at"
    AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'resolved appeal is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "perf_cycle_rollbacks_append_only"
BEFORE UPDATE OR DELETE ON "performance"."perf_cycle_rollbacks"
FOR EACH ROW EXECUTE FUNCTION "performance"."reject_append_only_mutation"();
