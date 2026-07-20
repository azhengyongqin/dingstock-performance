-- 20260716011825 是在其所依赖的 160300/160500/160900 之后生成的后补重命名迁移，
-- 但目录名会让 fresh migrate deploy 把它提前执行。本 bridge 只补齐该早期时点的源名对象，
-- 成熟数据库中若已有真实源/目标外键则严格 no-op。
DO $$
DECLARE
  bridge RECORD;
  source_constraint RECORD;
  target_constraint RECORD;
  bridge_comment CONSTANT TEXT := 'fresh-migrate-bridge:20260716011825';
BEGIN
  IF to_regclass('performance.perf_appeals') IS NULL
    OR to_regclass('performance.perf_calibrations') IS NULL THEN
    RAISE EXCEPTION 'FRESH_MIGRATE_BRIDGE_INVALID_STATE: prerequisite tables are missing';
  END IF;

  -- fresh 早期时点尚未创建结果版本表；占位表只为让旧 rename 语句完整通过。
  IF to_regclass('performance.perf_result_versions') IS NULL THEN
    CREATE TABLE "performance"."perf_result_versions" (
      "__fresh_migrate_bridge" BOOLEAN NOT NULL DEFAULT TRUE
    );
    COMMENT ON TABLE "performance"."perf_result_versions"
      IS 'fresh-migrate-bridge:20260716011825:placeholder';
  ELSIF obj_description(
    to_regclass('performance.perf_result_versions'),
    'pg_class'
  ) = 'fresh-migrate-bridge:20260716011825:placeholder' THEN
    RAISE EXCEPTION 'FRESH_MIGRATE_BRIDGE_INVALID_STATE: stale placeholder table exists';
  END IF;

  FOR bridge IN
    SELECT * FROM (VALUES
      ('perf_appeals', 'perf_appeals_invalidation_rollback_fkey', 'perf_appeals_invalidated_by_rollback_id_fkey'),
      ('perf_appeals', 'perf_appeals_resolution_calibration_participant_fkey', 'perf_appeals_resolution_calibration_id_participant_id_fkey'),
      ('perf_appeals', 'perf_appeals_result_version_participant_fkey', 'perf_appeals_result_version_id_participant_id_fkey'),
      ('perf_calibrations', 'perf_calibrations_invalidation_rollback_fkey', 'perf_calibrations_invalidated_by_rollback_id_fkey'),
      ('perf_result_versions', 'perf_result_versions_invalidation_rollback_fkey', 'perf_result_versions_invalidated_by_rollback_id_fkey')
    ) AS expected(table_name, source_name, target_name)
  LOOP
    source_constraint := NULL;
    target_constraint := NULL;

    SELECT constraint_row.oid, constraint_row.contype,
           obj_description(constraint_row.oid, 'pg_constraint') AS comment
      INTO source_constraint
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'performance'
      AND relation.relname = bridge.table_name
      AND constraint_row.conname = bridge.source_name;

    SELECT constraint_row.oid, constraint_row.contype,
           obj_description(constraint_row.oid, 'pg_constraint') AS comment
      INTO target_constraint
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'performance'
      AND relation.relname = bridge.table_name
      AND constraint_row.conname = bridge.target_name;

    IF source_constraint.oid IS NOT NULL AND target_constraint.oid IS NOT NULL THEN
      RAISE EXCEPTION
        'FRESH_MIGRATE_BRIDGE_INVALID_STATE: both source and target constraints exist on %.%',
        bridge.table_name, bridge.source_name;
    END IF;

    IF source_constraint.oid IS NOT NULL THEN
      IF source_constraint.contype NOT IN ('f', 'c') THEN
        RAISE EXCEPTION
          'FRESH_MIGRATE_BRIDGE_INVALID_STATE: unexpected source constraint type on %.%',
          bridge.table_name, bridge.source_name;
      END IF;
      CONTINUE;
    END IF;

    IF target_constraint.oid IS NOT NULL THEN
      IF target_constraint.contype <> 'f' THEN
        RAISE EXCEPTION
          'FRESH_MIGRATE_BRIDGE_INVALID_STATE: non-FK target constraint already exists on %.%',
          bridge.table_name, bridge.target_name;
      END IF;
      -- 已执行 20260716011825 的成熟库只会命中此分支。
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I CHECK (TRUE) NOT VALID',
      'performance', bridge.table_name, bridge.source_name
    );
    EXECUTE format(
      'COMMENT ON CONSTRAINT %I ON %I.%I IS %L',
      bridge.source_name, 'performance', bridge.table_name, bridge_comment
    );
  END LOOP;
END $$;
