-- bridge 清理后，160500/160900 会以历史源名创建真实外键。
-- 本 corrective migration 在链尾校验列、引用表和删除策略后收敛到 Prisma schema 推导名。
DO $$
DECLARE
  bridge RECORD;
  source_constraint RECORD;
  target_constraint RECORD;
  selected_constraint RECORD;
BEGIN
  FOR bridge IN
    SELECT * FROM (VALUES
      ('perf_appeals', 'perf_appeals_invalidation_rollback_fkey', 'perf_appeals_invalidated_by_rollback_id_fkey', ARRAY['invalidated_by_rollback_id']::TEXT[], 'perf_cycle_rollbacks', ARRAY['id']::TEXT[]),
      ('perf_appeals', 'perf_appeals_resolution_calibration_participant_fkey', 'perf_appeals_resolution_calibration_id_participant_id_fkey', ARRAY['resolution_calibration_id', 'participant_id']::TEXT[], 'perf_calibrations', ARRAY['id', 'participant_id']::TEXT[]),
      ('perf_appeals', 'perf_appeals_result_version_participant_fkey', 'perf_appeals_result_version_id_participant_id_fkey', ARRAY['result_version_id', 'participant_id']::TEXT[], 'perf_result_versions', ARRAY['id', 'participant_id']::TEXT[]),
      ('perf_calibrations', 'perf_calibrations_invalidation_rollback_fkey', 'perf_calibrations_invalidated_by_rollback_id_fkey', ARRAY['invalidated_by_rollback_id']::TEXT[], 'perf_cycle_rollbacks', ARRAY['id']::TEXT[]),
      ('perf_result_versions', 'perf_result_versions_invalidation_rollback_fkey', 'perf_result_versions_invalidated_by_rollback_id_fkey', ARRAY['invalidated_by_rollback_id']::TEXT[], 'perf_cycle_rollbacks', ARRAY['id']::TEXT[])
    ) AS expected(table_name, source_name, target_name, source_columns, referenced_table, referenced_columns)
  LOOP
    source_constraint := NULL;
    target_constraint := NULL;

    SELECT constraint_row.oid, constraint_row.contype,
           referenced_namespace.nspname AS referenced_schema,
           referenced_relation.relname AS referenced_table,
           constraint_row.confdeltype, constraint_row.confupdtype,
           ARRAY(
             SELECT attribute.attname::TEXT
             FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, position)
             JOIN pg_attribute AS attribute
               ON attribute.attrelid = constraint_row.conrelid
              AND attribute.attnum = key_column.attnum
             ORDER BY key_column.position
           ) AS source_columns,
           ARRAY(
             SELECT attribute.attname::TEXT
             FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key_column(attnum, position)
             JOIN pg_attribute AS attribute
               ON attribute.attrelid = constraint_row.confrelid
              AND attribute.attnum = key_column.attnum
             ORDER BY key_column.position
           ) AS referenced_columns
      INTO source_constraint
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    LEFT JOIN pg_class AS referenced_relation ON referenced_relation.oid = constraint_row.confrelid
    LEFT JOIN pg_namespace AS referenced_namespace ON referenced_namespace.oid = referenced_relation.relnamespace
    WHERE namespace.nspname = 'performance'
      AND relation.relname = bridge.table_name
      AND constraint_row.conname = bridge.source_name;

    SELECT constraint_row.oid, constraint_row.contype,
           referenced_namespace.nspname AS referenced_schema,
           referenced_relation.relname AS referenced_table,
           constraint_row.confdeltype, constraint_row.confupdtype,
           ARRAY(
             SELECT attribute.attname::TEXT
             FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, position)
             JOIN pg_attribute AS attribute
               ON attribute.attrelid = constraint_row.conrelid
              AND attribute.attnum = key_column.attnum
             ORDER BY key_column.position
           ) AS source_columns,
           ARRAY(
             SELECT attribute.attname::TEXT
             FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key_column(attnum, position)
             JOIN pg_attribute AS attribute
               ON attribute.attrelid = constraint_row.confrelid
              AND attribute.attnum = key_column.attnum
             ORDER BY key_column.position
           ) AS referenced_columns
      INTO target_constraint
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    LEFT JOIN pg_class AS referenced_relation ON referenced_relation.oid = constraint_row.confrelid
    LEFT JOIN pg_namespace AS referenced_namespace ON referenced_namespace.oid = referenced_relation.relnamespace
    WHERE namespace.nspname = 'performance'
      AND relation.relname = bridge.table_name
      AND constraint_row.conname = bridge.target_name;

    IF source_constraint.oid IS NOT NULL AND target_constraint.oid IS NOT NULL THEN
      RAISE EXCEPTION
        'FRESH_MIGRATE_BRIDGE_INVALID_STATE: both real source and target constraints exist on %.%',
        bridge.table_name, bridge.source_name;
    ELSIF source_constraint.oid IS NULL AND target_constraint.oid IS NULL THEN
      RAISE EXCEPTION
        'FRESH_MIGRATE_BRIDGE_INVALID_STATE: neither real source nor target constraint exists on %.%',
        bridge.table_name, bridge.source_name;
    END IF;

    IF source_constraint.oid IS NOT NULL THEN
      selected_constraint := source_constraint;
    ELSE
      selected_constraint := target_constraint;
    END IF;

    IF selected_constraint.contype <> 'f'
      OR selected_constraint.referenced_schema <> 'performance'
      OR selected_constraint.referenced_table <> bridge.referenced_table
      OR selected_constraint.source_columns IS DISTINCT FROM bridge.source_columns
      OR selected_constraint.referenced_columns IS DISTINCT FROM bridge.referenced_columns
      OR selected_constraint.confdeltype <> 'r'
      OR selected_constraint.confupdtype <> 'c' THEN
      RAISE EXCEPTION
        'FRESH_MIGRATE_BRIDGE_INVALID_STATE: FK definition mismatch on %.%',
        bridge.table_name, COALESCE(bridge.source_name, bridge.target_name);
    END IF;

    IF source_constraint.oid IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE %I.%I RENAME CONSTRAINT %I TO %I',
        'performance', bridge.table_name, bridge.source_name, bridge.target_name
      );
    END IF;
  END LOOP;
END $$;
