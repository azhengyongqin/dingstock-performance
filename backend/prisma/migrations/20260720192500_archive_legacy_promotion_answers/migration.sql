-- 在旧评估项 contract 删除前，把 PROMOTION 答案迁入独立只读归档。
-- 本迁移也兼容已执行 contract 的环境：源表不存在时跳过旧项，仅补存活结果快照中的历史投影。

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type AS type
    JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
    WHERE namespace.nspname = 'performance'
      AND type.typname = 'PerfLegacyPromotionArchiveSource'
  ) THEN
    CREATE TYPE "performance"."PerfLegacyPromotionArchiveSource"
      AS ENUM ('EVALUATION_ITEM_RESULT', 'RESULT_VERSION_SNAPSHOT');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "performance"."perf_legacy_promotion_archives" (
  "id" SERIAL NOT NULL,
  "cycle_id" INTEGER NOT NULL,
  "participant_id" INTEGER NOT NULL,
  "source_type" "performance"."PerfLegacyPromotionArchiveSource" NOT NULL,
  "source_record_id" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "source_created_at" TIMESTAMP(3),
  "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "perf_legacy_promotion_archives_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_legacy_promotion_archives_payload_object_check"
    CHECK (jsonb_typeof("payload") = 'object'),
  CONSTRAINT "perf_legacy_promotion_archives_cycle_id_fkey"
    FOREIGN KEY ("cycle_id") REFERENCES "performance"."perf_cycles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "perf_legacy_promotion_archives_participant_cycle_fkey"
    FOREIGN KEY ("participant_id", "cycle_id")
    REFERENCES "performance"."perf_participants"("id", "cycle_id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "perf_legacy_promotion_archives_source_key"
  ON "performance"."perf_legacy_promotion_archives"("source_type", "source_record_id");
CREATE INDEX IF NOT EXISTS "perf_legacy_promotion_archives_participant_source_idx"
  ON "performance"."perf_legacy_promotion_archives"("participant_id", "source_type");
CREATE INDEX IF NOT EXISTS "perf_legacy_promotion_archives_cycle_id_idx"
  ON "performance"."perf_legacy_promotion_archives"("cycle_id");

-- 动态 SQL 避免已执行 contract 的数据库在 parse 阶段因旧源表不存在而失败。
DO $$
BEGIN
  IF to_regclass('performance.perf_evaluation_item_results') IS NOT NULL THEN
    EXECUTE $archive$
      INSERT INTO "performance"."perf_legacy_promotion_archives" (
        "cycle_id", "participant_id", "source_type", "source_record_id",
        "payload", "source_created_at", "archived_at"
      )
      SELECT
        submission."cycle_id",
        submission."participant_id",
        'EVALUATION_ITEM_RESULT'::"performance"."PerfLegacyPromotionArchiveSource",
        item."id",
        jsonb_build_object(
          'submissionId', submission."id",
          'formSnapshotId', item."form_snapshot_id",
          'stage', submission."stage"::text,
          'status', submission."status"::text,
          'reviewerOpenId', submission."reviewer_open_id",
          'submittedAt', submission."submitted_at",
          'subformKey', item."subform_key",
          'dimensionKey', item."dimension_key",
          'itemKey', item."item_key",
          'itemType', item."item_type"::text,
          'rawLevel', item."raw_level"::text,
          'rawScore', item."raw_score",
          'calculationScore', item."calculation_score",
          'value', item."value"
        ),
        item."created_at",
        CURRENT_TIMESTAMP
      FROM "performance"."perf_evaluation_item_results" AS item
      JOIN "performance"."perf_evaluation_submissions" AS submission
        ON submission."id" = item."submission_id"
       AND submission."form_snapshot_id" = item."form_snapshot_id"
      JOIN "performance"."perf_cycle_form_snapshots" AS snapshot
        ON snapshot."id" = item."form_snapshot_id"
      WHERE item."subform_key" = 'subform:PROMOTION'
         OR EXISTS (
           SELECT 1
           FROM jsonb_array_elements(COALESCE(snapshot."content"->'subforms', '[]'::jsonb)) AS subform
           WHERE subform->>'type' = 'PROMOTION'
             AND subform->>'key' = item."subform_key"
         )
      ON CONFLICT ("source_type", "source_record_id") DO NOTHING
    $archive$;
  END IF;
END $$;

-- 已执行旧 DROP 的环境只能从仍存活的历史结果快照补回员工可见投影；
-- 未曾进入结果快照的旧答案无法无备份恢复，不能在此伪造成完整历史。
INSERT INTO "performance"."perf_legacy_promotion_archives" (
  "cycle_id", "participant_id", "source_type", "source_record_id",
  "payload", "source_created_at", "archived_at"
)
SELECT
  participant."cycle_id",
  result."participant_id",
  'RESULT_VERSION_SNAPSHOT'::"performance"."PerfLegacyPromotionArchiveSource",
  result."id",
  jsonb_build_object(
    'resultVersionId', result."id",
    'version', result."version",
    'promotion', result."result_snapshot"->'promotion'
  ),
  result."created_at",
  CURRENT_TIMESTAMP
FROM "performance"."perf_result_versions" AS result
JOIN "performance"."perf_participants" AS participant
  ON participant."id" = result."participant_id"
WHERE jsonb_typeof(result."result_snapshot") = 'object'
  AND result."result_snapshot" ? 'promotion'
  AND result."result_snapshot"->'promotion' <> 'null'::jsonb
ON CONFLICT ("source_type", "source_record_id") DO NOTHING;

CREATE OR REPLACE FUNCTION "performance"."guard_legacy_promotion_archive_append_only"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'legacy promotion archive is append-only';
END;
$$;

DROP TRIGGER IF EXISTS "perf_legacy_promotion_archives_append_only"
  ON "performance"."perf_legacy_promotion_archives";
CREATE TRIGGER "perf_legacy_promotion_archives_append_only"
BEFORE UPDATE OR DELETE ON "performance"."perf_legacy_promotion_archives"
FOR EACH ROW EXECUTE FUNCTION "performance"."guard_legacy_promotion_archive_append_only"();
