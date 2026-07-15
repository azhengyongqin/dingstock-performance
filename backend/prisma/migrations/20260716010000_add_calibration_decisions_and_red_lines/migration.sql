-- Ticket 13：逐员工显式校准决定、首次评估锁与 append-only 红线事实。
CREATE TYPE "performance"."PerfCalibrationDecision" AS ENUM ('KEEP', 'ADJUST');
CREATE TYPE "performance"."PerfRedLineAction" AS ENUM ('CONFIRM', 'REVOKE');

ALTER TABLE "performance"."perf_participants"
  ADD COLUMN "evaluation_locked_at" TIMESTAMP(3);

-- 迁移前只要已有校准记录，就视为已经发生首次校准；回填最早决定时间并收口旧状态。
UPDATE "performance"."perf_participants" AS participant
SET
  "evaluation_locked_at" = first_calibration."created_at",
  "status" = CASE
    WHEN participant."status" IN ('REVIEWED', 'AI_DONE')
      THEN 'CALIBRATED'::"performance"."PerfParticipantStatus"
    ELSE participant."status"
  END
FROM (
  SELECT "participant_id", MIN("created_at") AS "created_at"
  FROM "performance"."perf_calibrations"
  GROUP BY "participant_id"
) AS first_calibration
WHERE participant."id" = first_calibration."participant_id"
  AND participant."evaluation_locked_at" IS NULL;

ALTER TABLE "performance"."perf_calibrations"
  ADD COLUMN "decision" "performance"."PerfCalibrationDecision" NOT NULL DEFAULT 'ADJUST',
  ADD COLUMN "input_revision" TEXT,
  ADD COLUMN "is_legacy" BOOLEAN;

-- 迁移前记录显式标记为历史兼容；迁移后触发器禁止新增 legacy 记录。
UPDATE "performance"."perf_calibrations"
SET "is_legacy" = TRUE;

ALTER TABLE "performance"."perf_calibrations"
  ALTER COLUMN "decision" DROP DEFAULT,
  ALTER COLUMN "is_legacy" SET NOT NULL,
  ALTER COLUMN "is_legacy" SET DEFAULT FALSE;

ALTER TABLE "performance"."perf_calibrations"
  ALTER COLUMN "reason" DROP NOT NULL;

ALTER TABLE "performance"."perf_calibrations"
  ADD CONSTRAINT "perf_calibrations_decision_shape_check"
  CHECK (
    (
      "is_legacy" = TRUE
      AND "input_revision" IS NULL
    )
    OR (
      "is_legacy" = FALSE
      AND "input_revision" IS NOT NULL
      AND (
        (
          "decision" = 'KEEP'
          AND "before_level" IS NOT NULL
        )
        OR
        (
          "decision" = 'ADJUST'
          AND "reason" IS NOT NULL
          AND btrim("reason") <> ''
        )
      )
    )
  ),
  ADD CONSTRAINT "perf_calibrations_input_revision_check"
  CHECK (
    "input_revision" IS NULL
    OR "input_revision" ~ '^[0-9a-f]{64}$'
  );

CREATE OR REPLACE FUNCTION "performance"."reject_new_legacy_calibration"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."is_legacy" THEN
    RAISE EXCEPTION 'new calibration records cannot be marked as legacy';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "perf_calibrations_reject_new_legacy"
BEFORE INSERT ON "performance"."perf_calibrations"
FOR EACH ROW EXECUTE FUNCTION "performance"."reject_new_legacy_calibration"();

CREATE TABLE "performance"."perf_red_line_findings" (
  "id" SERIAL NOT NULL,
  "participant_id" INTEGER NOT NULL,
  "action" "performance"."PerfRedLineAction" NOT NULL,
  "finding_type" TEXT NOT NULL,
  "facts" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "revoke_of_id" INTEGER,
  "operator_open_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "perf_red_line_findings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_red_line_findings_event_shape_check" CHECK (
    ("action" = 'CONFIRM' AND "revoke_of_id" IS NULL)
    OR ("action" = 'REVOKE' AND "revoke_of_id" IS NOT NULL)
  ),
  CONSTRAINT "perf_red_line_findings_required_text_check" CHECK (
    btrim("finding_type") <> ''
    AND btrim("facts") <> ''
    AND btrim("reason") <> ''
    AND btrim("operator_open_id") <> ''
  ),
  CONSTRAINT "perf_red_line_findings_evidence_check" CHECK (
    (jsonb_typeof("evidence") = 'array' AND jsonb_array_length("evidence") > 0)
    OR
    (jsonb_typeof("evidence") = 'object' AND "evidence" <> '{}'::jsonb)
  )
);

CREATE UNIQUE INDEX "perf_red_line_findings_revoke_of_id_key"
  ON "performance"."perf_red_line_findings"("revoke_of_id");
CREATE INDEX "perf_red_line_findings_participant_id_action_created_at_idx"
  ON "performance"."perf_red_line_findings"("participant_id", "action", "created_at");

ALTER TABLE "performance"."perf_red_line_findings"
  ADD CONSTRAINT "perf_red_line_findings_participant_id_fkey"
  FOREIGN KEY ("participant_id") REFERENCES "performance"."perf_participants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "perf_red_line_findings_revoke_of_id_fkey"
  FOREIGN KEY ("revoke_of_id") REFERENCES "performance"."perf_red_line_findings"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "performance"."validate_red_line_revocation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  confirmed_participant_id INTEGER;
  confirmed_action "performance"."PerfRedLineAction";
BEGIN
  IF NEW."action" = 'REVOKE' THEN
    SELECT "participant_id", "action"
      INTO confirmed_participant_id, confirmed_action
    FROM "performance"."perf_red_line_findings"
    WHERE "id" = NEW."revoke_of_id"
    FOR KEY SHARE;

    IF confirmed_participant_id IS NULL
      OR confirmed_action <> 'CONFIRM'
      OR confirmed_participant_id <> NEW."participant_id" THEN
      RAISE EXCEPTION 'red-line revocation must reference a confirmation of the same participant';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "perf_red_line_findings_validate_revocation"
BEFORE INSERT ON "performance"."perf_red_line_findings"
FOR EACH ROW EXECUTE FUNCTION "performance"."validate_red_line_revocation"();

CREATE OR REPLACE FUNCTION "performance"."reject_append_only_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; UPDATE/DELETE is forbidden', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "perf_calibrations_append_only"
BEFORE UPDATE OR DELETE ON "performance"."perf_calibrations"
FOR EACH ROW EXECUTE FUNCTION "performance"."reject_append_only_mutation"();

CREATE TRIGGER "perf_red_line_findings_append_only"
BEFORE UPDATE OR DELETE ON "performance"."perf_red_line_findings"
FOR EACH ROW EXECUTE FUNCTION "performance"."reject_append_only_mutation"();

-- 所有结果写路径（含旧申诉代码）共享这一硬约束，避免有效红线被并发覆盖为非 C。
CREATE OR REPLACE FUNCTION "performance"."enforce_active_red_line_result"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."final_level" <> 'C' AND EXISTS (
    SELECT 1
    FROM "performance"."perf_red_line_findings" AS confirmed
    WHERE confirmed."participant_id" = NEW."participant_id"
      AND confirmed."action" = 'CONFIRM'
      AND NOT EXISTS (
        SELECT 1
        FROM "performance"."perf_red_line_findings" AS revoked
        WHERE revoked."revoke_of_id" = confirmed."id"
          AND revoked."action" = 'REVOKE'
      )
  ) THEN
    RAISE EXCEPTION 'active red-line finding requires final level C';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "perf_results_enforce_active_red_line"
BEFORE INSERT OR UPDATE OF "final_level" ON "performance"."perf_results"
FOR EACH ROW EXECUTE FUNCTION "performance"."enforce_active_red_line_result"();
