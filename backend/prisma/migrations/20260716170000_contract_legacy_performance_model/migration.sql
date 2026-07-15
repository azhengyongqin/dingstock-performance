-- Ticket 21：只有全量迁移 readiness 通过后才允许切换，并在同一事务收缩旧结构。
DO $$
DECLARE
  cycle_count INTEGER;
  ready_run_id INTEGER;
BEGIN
  SELECT count(*) INTO cycle_count
  FROM "performance"."perf_cycles";

  SELECT "id" INTO ready_run_id
  FROM "performance"."perf_legacy_migration_runs"
  WHERE "cycle_id" IS NULL
    AND "dry_run" = false
  -- 只认最后一次正式全量批次，避免更早的成功报告遮蔽后续失败。
  ORDER BY "id" DESC
  LIMIT 1;

  -- 空数据库可以正常安装全套 migration；只要存在业务周期，就必须有正式全量 readiness 证据。
  IF cycle_count > 0 AND (
    ready_run_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM "performance"."perf_legacy_migration_runs" AS latest_run
      WHERE latest_run."id" = ready_run_id
        AND latest_run."status" = 'COMPLETED'
        AND COALESCE((latest_run."readiness_report"->>'ready')::boolean, false) = true
    )
  ) THEN
    RAISE EXCEPTION 'PERFORMANCE_CUTOVER_NOT_READY: no completed full migration with readiness.ready=true';
  END IF;

  -- readiness 通过后才把迁移账本中的周期配置目标设为唯一读指针。
  IF ready_run_id IS NOT NULL THEN
    UPDATE "performance"."perf_cycles" AS cycle
    SET "current_config_version_id" = item."target_id"
    FROM "performance"."perf_legacy_migration_items" AS item
    WHERE item."run_id" = ready_run_id
      AND item."source_type" = 'CYCLE_CONFIGURATION'
      AND item."status" = 'MIGRATED'
      AND item."target_type" = 'PerfCycleConfigVersion'
      AND item."source_business_key" = 'perf_cycles:' || cycle."id"::text
      AND cycle."current_config_version_id" IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM "performance"."perf_cycles"
    WHERE "current_config_version_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'PERFORMANCE_CUTOVER_CYCLE_WITHOUT_CONFIG: every cycle must bind a current config version';
  END IF;
END $$;

-- Ticket 20 正常情况下已生成结果版本；这里把仍仅存在旧投影的历史结果补成
-- 最后一条不可变版本，确保 contract 删除 perf_results 后不会丢失员工历史与确认事实。
INSERT INTO "performance"."perf_result_versions" (
  "participant_id", "version", "final_level", "employee_explanation",
  "source_calibration_id", "result_snapshot", "published_by_open_id",
  "published_at", "confirmed_at", "confirmed_by_open_id", "created_at"
)
SELECT
  result."participant_id",
  COALESCE((
    SELECT max(version."version")
    FROM "performance"."perf_result_versions" AS version
    WHERE version."participant_id" = result."participant_id"
  ), 0) + 1,
  result."final_level"::text::"performance"."PerfRatingSymbol",
  '历史绩效等级 ' || result."final_level"::text,
  (
    SELECT calibration."id"
    FROM "performance"."perf_calibrations" AS calibration
    WHERE calibration."participant_id" = result."participant_id"
      AND calibration."invalidated_at" IS NULL
    ORDER BY calibration."id" DESC
    LIMIT 1
  ),
  jsonb_build_object(
    'cycle', jsonb_build_object('id', cycle."id", 'name', cycle."name"),
    'manager', jsonb_build_object(
      'compositeScore', NULL,
      'level', result."final_level"::text,
      'dimensions', COALESCE(result."dimension_results", '[]'::jsonb),
      'comments', '[]'::jsonb
    ),
    'self', jsonb_build_object('level', NULL, 'items', '[]'::jsonb),
    -- 旧投影无法证明晋升结论的员工可见配置，迁移时安全默认隐藏。
    'promotion', NULL
  ),
  'system:migration',
  result."created_at",
  CASE WHEN result."confirmed_by_employee" THEN result."confirmed_at" END,
  CASE WHEN result."confirmed_by_employee" THEN participant."employee_open_id" END,
  result."created_at"
FROM "performance"."perf_results" AS result
JOIN "performance"."perf_participants" AS participant
  ON participant."id" = result."participant_id"
JOIN "performance"."perf_cycles" AS cycle
  ON cycle."id" = participant."cycle_id"
WHERE result."invalidated_at" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "performance"."perf_result_versions" AS current_version
    WHERE current_version."participant_id" = result."participant_id"
      AND current_version."superseded_at" IS NULL
      AND current_version."invalidated_at" IS NULL
  );

-- 旧参与者进度态折叠为结果生命周期；人工评估进度由任务与统一提交派生。
-- readiness 已验证状态映射；contract 再按同一组结果/校准/申诉事实复核，防止报告后数据漂移。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "performance"."perf_participants" AS participant
    WHERE participant."status"::text = 'ARCHIVED'
      AND NOT EXISTS (
        SELECT 1 FROM "performance"."perf_result_versions" AS version
        WHERE version."participant_id" = participant."id"
          AND version."superseded_at" IS NULL
          AND version."invalidated_at" IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM "performance"."perf_calibrations" AS calibration
        WHERE calibration."participant_id" = participant."id"
          AND calibration."invalidated_at" IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'PERFORMANCE_CUTOVER_AMBIGUOUS_PARTICIPANT_STATUS: legacy ARCHIVED lacks provable result or calibration facts';
  END IF;
END $$;

UPDATE "performance"."perf_participants" AS participant
SET "status" = CASE
  WHEN participant."status"::text = 'WITHDRAWN' THEN 'WITHDRAWN'::"performance"."PerfParticipantStatus"
  WHEN participant."status"::text = 'NO_RESULT' THEN 'NO_RESULT'::"performance"."PerfParticipantStatus"
  WHEN participant."status"::text = 'APPEALING' OR EXISTS (
    SELECT 1 FROM "performance"."perf_appeals" AS appeal
    WHERE appeal."participant_id" = participant."id"
      AND appeal."status"::text <> 'RESOLVED'
      AND appeal."invalidated_at" IS NULL
  ) THEN 'APPEALING'::"performance"."PerfParticipantStatus"
  WHEN participant."status"::text = 'RE_CONFIRMING' THEN 'RE_CONFIRMING'::"performance"."PerfParticipantStatus"
  WHEN EXISTS (
    SELECT 1 FROM "performance"."perf_result_versions" AS version
    WHERE version."participant_id" = participant."id"
      AND version."superseded_at" IS NULL
      AND version."invalidated_at" IS NULL
  ) THEN CASE
    WHEN EXISTS (
      SELECT 1 FROM "performance"."perf_result_versions" AS confirmed_version
      WHERE confirmed_version."participant_id" = participant."id"
        AND confirmed_version."superseded_at" IS NULL
        AND confirmed_version."invalidated_at" IS NULL
        AND confirmed_version."confirmed_at" IS NOT NULL
    ) THEN 'CONFIRMED'::"performance"."PerfParticipantStatus"
    ELSE 'RESULT_PUBLISHED'::"performance"."PerfParticipantStatus"
  END
  WHEN EXISTS (
    SELECT 1 FROM "performance"."perf_calibrations" AS calibration
    WHERE calibration."participant_id" = participant."id"
      AND calibration."invalidated_at" IS NULL
  ) THEN 'CALIBRATED'::"performance"."PerfParticipantStatus"
  ELSE 'ACTIVE'::"performance"."PerfParticipantStatus"
END;

ALTER TABLE "performance"."perf_participants"
  ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "performance"."PerfParticipantStatus" RENAME TO "PerfParticipantStatus_legacy";
CREATE TYPE "performance"."PerfParticipantStatus" AS ENUM (
  'ACTIVE', 'CALIBRATED', 'RESULT_PUBLISHED', 'CONFIRMED',
  'APPEALING', 'RE_CONFIRMING', 'NO_RESULT', 'WITHDRAWN'
);
ALTER TABLE "performance"."perf_participants"
  ALTER COLUMN "status" TYPE "performance"."PerfParticipantStatus"
  USING ("status"::text::"performance"."PerfParticipantStatus"),
  ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
DROP TYPE "performance"."PerfParticipantStatus_legacy";

-- 当前配置指针改为复合外键，数据库兜底禁止绑定其他周期的配置版本。
ALTER TABLE "performance"."perf_cycles"
  DROP CONSTRAINT IF EXISTS "perf_cycles_current_config_version_id_fkey";
CREATE UNIQUE INDEX "perf_cycles_current_config_version_id_id_key"
  ON "performance"."perf_cycles"("current_config_version_id", "id");
ALTER TABLE "performance"."perf_cycles"
  ADD CONSTRAINT "perf_cycles_current_config_version_id_id_fkey"
  FOREIGN KEY ("current_config_version_id", "id")
  REFERENCES "performance"."perf_cycle_config_versions"("id", "cycle_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 停止旧周期配置、旧模板、分离答卷以及 JSON 维度评分的所有物理入口。
ALTER TABLE "performance"."perf_cycles"
  DROP COLUMN "start_date",
  DROP COLUMN "end_date",
  DROP COLUMN "template_id",
  DROP COLUMN "windows",
  DROP COLUMN "notification_rules";

DROP TABLE "performance"."perf_self_reviews";
DROP TABLE "performance"."perf_reviews";
DROP TABLE "performance"."perf_manager_reviews";
DROP TABLE "performance"."perf_results";
DROP TABLE "performance"."perf_dimensions";
DROP TABLE "performance"."perf_evaluation_rules";
DROP TABLE "performance"."perf_template_dimensions";
DROP TABLE "performance"."perf_templates";

DROP TYPE "performance"."PerfSelfReviewStatus";
DROP TYPE "performance"."PerfDimensionType";
DROP TYPE "performance"."PerfScoringMethod";

-- 运维与监控只读此最终术语；contract 后 rollback 开关必须永久关闭。
INSERT INTO "performance"."system_configs" (
  "key", "value", "description", "updated_by_open_id", "created_at", "updated_at"
) VALUES (
  'performance.model.cutover',
  '{"phase":"CONTRACTED","readPath":"VERSIONED","writePath":"UNIFIED_SUBMISSION","rollbackEnabled":false}'::jsonb,
  'Ticket 21 新绩效模型正式切换；contract 后禁止回退旧结构',
  'system:migration',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "value" = EXCLUDED."value",
  "description" = EXCLUDED."description",
  "updated_by_open_id" = EXCLUDED."updated_by_open_id",
  "updated_at" = CURRENT_TIMESTAMP;
