-- 20260716011825 已把 bridge 源名约束改成目标名；在真实表/外键迁移开始前精确清理哨兵。
DO $$
DECLARE
  bridge RECORD;
  target_constraint RECORD;
  bridge_comment CONSTANT TEXT := 'fresh-migrate-bridge:20260716011825';
  placeholder_comment CONSTANT TEXT := 'fresh-migrate-bridge:20260716011825:placeholder';
BEGIN
  FOR bridge IN
    SELECT * FROM (VALUES
      ('perf_appeals', 'perf_appeals_invalidated_by_rollback_id_fkey'),
      ('perf_appeals', 'perf_appeals_resolution_calibration_id_participant_id_fkey'),
      ('perf_appeals', 'perf_appeals_result_version_id_participant_id_fkey'),
      ('perf_calibrations', 'perf_calibrations_invalidated_by_rollback_id_fkey')
    ) AS expected(table_name, target_name)
  LOOP
    target_constraint := NULL;
    SELECT constraint_row.oid, constraint_row.contype,
           obj_description(constraint_row.oid, 'pg_constraint') AS comment
      INTO target_constraint
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'performance'
      AND relation.relname = bridge.table_name
      AND constraint_row.conname = bridge.target_name;

    IF target_constraint.oid IS NULL THEN
      RAISE EXCEPTION
        'FRESH_MIGRATE_BRIDGE_INVALID_STATE: renamed target constraint is missing on %.%',
        bridge.table_name, bridge.target_name;
    ELSIF target_constraint.contype = 'c'
      AND target_constraint.comment = bridge_comment THEN
      EXECUTE format(
        'ALTER TABLE %I.%I DROP CONSTRAINT %I',
        'performance', bridge.table_name, bridge.target_name
      );
    ELSIF target_constraint.contype = 'f' THEN
      -- 成熟库中的真实外键绝不允许 bridge 清理。
      CONTINUE;
    ELSE
      RAISE EXCEPTION
        'FRESH_MIGRATE_BRIDGE_INVALID_STATE: target constraint is not an owned sentinel on %.%',
        bridge.table_name, bridge.target_name;
    END IF;
  END LOOP;

  IF to_regclass('performance.perf_result_versions') IS NULL THEN
    RAISE EXCEPTION 'FRESH_MIGRATE_BRIDGE_INVALID_STATE: result version bridge table is missing';
  END IF;

  IF obj_description(
    to_regclass('performance.perf_result_versions'),
    'pg_class'
  ) = placeholder_comment THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'performance'
        AND table_name = 'perf_result_versions'
        AND column_name = '__fresh_migrate_bridge'
    ) THEN
      RAISE EXCEPTION 'FRESH_MIGRATE_BRIDGE_INVALID_STATE: placeholder marker column is missing';
    END IF;
    DROP TABLE "performance"."perf_result_versions";
  ELSE
    -- 如果 160300 在某个环境已先执行，只能删除明确带 comment 的哨兵约束。
    SELECT constraint_row.oid, constraint_row.contype,
           obj_description(constraint_row.oid, 'pg_constraint') AS comment
      INTO target_constraint
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'performance'
      AND relation.relname = 'perf_result_versions'
      AND constraint_row.conname = 'perf_result_versions_invalidated_by_rollback_id_fkey';

    IF target_constraint.oid IS NULL THEN
      RAISE EXCEPTION
        'FRESH_MIGRATE_BRIDGE_INVALID_STATE: result-version target constraint is missing';
    ELSIF target_constraint.contype = 'c'
      AND target_constraint.comment = bridge_comment THEN
      ALTER TABLE "performance"."perf_result_versions"
        DROP CONSTRAINT "perf_result_versions_invalidated_by_rollback_id_fkey";
    ELSIF target_constraint.contype <> 'f' THEN
      RAISE EXCEPTION
        'FRESH_MIGRATE_BRIDGE_INVALID_STATE: result-version target is not an owned sentinel or FK';
    END IF;
  END IF;
END $$;
