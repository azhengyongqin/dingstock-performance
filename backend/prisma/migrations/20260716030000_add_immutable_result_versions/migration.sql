-- Ticket 14：不可变员工结果版本、精确确认与可重试通知事件。
ALTER TYPE "performance"."PerfParticipantStatus"
  ADD VALUE IF NOT EXISTS 'RESULT_PUBLISHED';

ALTER TYPE "performance"."PerfNotificationEventType"
  ADD VALUE IF NOT EXISTS 'RESULT_PUBLISHED';

CREATE TABLE "performance"."perf_result_versions" (
  "id" SERIAL NOT NULL,
  "participant_id" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "final_level" "performance"."PerfRatingSymbol" NOT NULL,
  "employee_explanation" TEXT,
  "source_calibration_id" INTEGER,
  "result_snapshot" JSONB NOT NULL,
  "published_by_open_id" TEXT NOT NULL,
  "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "superseded_at" TIMESTAMP(3),
  "confirmed_at" TIMESTAMP(3),
  "confirmed_by_open_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "perf_result_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_result_versions_version_positive_check"
    CHECK ("version" > 0),
  CONSTRAINT "perf_result_versions_snapshot_object_check"
    CHECK (jsonb_typeof("result_snapshot") = 'object'),
  CONSTRAINT "perf_result_versions_publisher_check"
    CHECK (btrim("published_by_open_id") <> ''),
  CONSTRAINT "perf_result_versions_confirmation_pair_check"
    CHECK (("confirmed_at" IS NULL) = ("confirmed_by_open_id" IS NULL))
);

CREATE UNIQUE INDEX "perf_result_versions_participant_id_version_key"
  ON "performance"."perf_result_versions"("participant_id", "version");
CREATE UNIQUE INDEX "perf_result_versions_current_key"
  ON "performance"."perf_result_versions"("participant_id")
  WHERE "superseded_at" IS NULL;
CREATE INDEX "perf_result_versions_participant_id_superseded_at_idx"
  ON "performance"."perf_result_versions"("participant_id", "superseded_at");
CREATE INDEX "perf_result_versions_source_calibration_id_idx"
  ON "performance"."perf_result_versions"("source_calibration_id");

ALTER TABLE "performance"."perf_result_versions"
  ADD CONSTRAINT "perf_result_versions_participant_id_fkey"
  FOREIGN KEY ("participant_id") REFERENCES "performance"."perf_participants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "perf_result_versions_source_calibration_id_fkey"
  FOREIGN KEY ("source_calibration_id") REFERENCES "performance"."perf_calibrations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 旧结果只迁移员工安全可见的最小投影；未知晋升可见性默认不公开。
INSERT INTO "performance"."perf_result_versions" (
  "participant_id",
  "version",
  "final_level",
  "employee_explanation",
  "source_calibration_id",
  "result_snapshot",
  "published_by_open_id",
  "published_at",
  "confirmed_at",
  "confirmed_by_open_id"
)
SELECT
  result."participant_id",
  1,
  result."final_level"::"performance"."PerfRatingSymbol",
  '历史结果迁移',
  calibration."id",
  jsonb_build_object(
    'cycle', jsonb_build_object('id', participant."cycle_id", 'name', cycle."name"),
    'manager', jsonb_build_object(
      'compositeScore', NULL,
      'level', result."final_level",
      'dimensions', COALESCE(result."dimension_results", '[]'::jsonb),
      'comments', '[]'::jsonb
    ),
    'self', jsonb_build_object('level', NULL, 'items', '[]'::jsonb),
    'promotion', NULL
  ),
  'system:migration',
  result."created_at",
  result."confirmed_at",
  CASE WHEN result."confirmed_at" IS NOT NULL THEN participant."employee_open_id" END
FROM "performance"."perf_results" AS result
JOIN "performance"."perf_participants" AS participant
  ON participant."id" = result."participant_id"
JOIN "performance"."perf_cycles" AS cycle
  ON cycle."id" = participant."cycle_id"
LEFT JOIN LATERAL (
  SELECT calibration."id"
  FROM "performance"."perf_calibrations" AS calibration
  WHERE calibration."participant_id" = participant."id"
  ORDER BY calibration."id" DESC
  LIMIT 1
) AS calibration ON TRUE
WHERE result."final_level" IN ('S', 'A', 'B', 'C');

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
    AND (
      NEW."confirmed_at" IS DISTINCT FROM OLD."confirmed_at"
      OR NEW."confirmed_by_open_id" IS DISTINCT FROM OLD."confirmed_by_open_id"
    ) THEN
    RAISE EXCEPTION 'result version confirmation can only be set once';
  END IF;
  IF OLD."superseded_at" IS NULL
    AND NEW."superseded_at" IS NULL
    AND OLD."confirmed_at" IS NOT NULL
    AND NEW."confirmed_at" IS NOT DISTINCT FROM OLD."confirmed_at" THEN
    RAISE EXCEPTION 'result version has no mutable fields';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "perf_result_versions_immutable"
BEFORE UPDATE OR DELETE ON "performance"."perf_result_versions"
FOR EACH ROW EXECUTE FUNCTION "performance"."guard_result_version_immutable"();

CREATE TRIGGER "perf_result_versions_enforce_active_red_line"
BEFORE INSERT OR UPDATE OF "final_level" ON "performance"."perf_result_versions"
FOR EACH ROW EXECUTE FUNCTION "performance"."enforce_active_red_line_result"();
