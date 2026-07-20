-- 旧晋升归档完整性门禁。
-- 归档 migration 若在 contract 后才执行，已删除的旧 item 答案无法被 SQL 恢复；
-- 只要仍有旧晋升证据，就必须阻断 deploy 并要求从 contract 前备份重跑。

DO $$
DECLARE
  migration_table REGCLASS;
  archive_finished_at TIMESTAMPTZ;
  contract_started_at TIMESTAMPTZ;
  archive_completed_before_contract BOOLEAN := false;
  has_legacy_dimension BOOLEAN := false;
  has_cycle_snapshot BOOLEAN := false;
  has_result_snapshot BOOLEAN := false;
  has_result_snapshot_archive BOOLEAN := false;
BEGIN
  -- Prisma 通常把账本放在 public；to_regclass 先按当前 search_path 解析，
  -- 再回退到 catalog 查找，以兼容测试 schema 与既有数据库的实际布局。
  migration_table := to_regclass('"_prisma_migrations"');
  IF migration_table IS NULL THEN
    SELECT relation.oid::REGCLASS
    INTO migration_table
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE relation.relname = '_prisma_migrations'
      AND relation.relkind IN ('r', 'p')
    ORDER BY (namespace.nspname = 'public') DESC, namespace.nspname
    LIMIT 1;
  END IF;

  IF migration_table IS NULL THEN
    RAISE EXCEPTION '无法定位 Prisma _prisma_migrations 迁移账本，拒绝判断旧晋升归档完整性';
  END IF;

  EXECUTE format(
    'SELECT '
      'MAX(finished_at) FILTER (WHERE migration_name = $1 AND rolled_back_at IS NULL), '
      'MIN(started_at) FILTER (WHERE migration_name = $2 AND rolled_back_at IS NULL) '
      'FROM %s',
    migration_table
  )
  INTO archive_finished_at, contract_started_at
  USING
    '20260720192500_archive_legacy_promotion_answers',
    '20260720193000_contract_evaluation_dimension_model';

  archive_completed_before_contract :=
    archive_finished_at IS NOT NULL
    AND contract_started_at IS NOT NULL
    AND archive_finished_at <= contract_started_at;

  IF archive_completed_before_contract THEN
    RETURN;
  END IF;

  IF to_regclass('"performance"."perf_form_dimensions"') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS ('
      '  SELECT 1 FROM "performance"."perf_form_dimensions" '
      '  WHERE "type"::text = ''LEGACY_PROMOTION'''
      ')'
    INTO has_legacy_dimension;
  END IF;

  IF to_regclass('"performance"."perf_cycle_form_snapshots"') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS ('
      '  SELECT 1 '
      '  FROM "performance"."perf_cycle_form_snapshots" AS snapshot '
      '  CROSS JOIN LATERAL jsonb_array_elements('
      '    CASE WHEN jsonb_typeof(snapshot."content"->''subforms'') = ''array'' '
      '      THEN snapshot."content"->''subforms'' ELSE ''[]''::jsonb END'
      '  ) AS subform '
      '  WHERE subform->>''type'' = ''PROMOTION'''
      ')'
    INTO has_cycle_snapshot;
  END IF;

  IF to_regclass('"performance"."perf_result_versions"') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS ('
      '  SELECT 1 FROM "performance"."perf_result_versions" '
      '  WHERE jsonb_typeof("result_snapshot") = ''object'' '
      '    AND "result_snapshot" ? ''promotion'' '
      '    AND "result_snapshot"->''promotion'' <> ''null''::jsonb'
      ')'
    INTO has_result_snapshot;
  END IF;

  IF to_regclass('"performance"."perf_legacy_promotion_archives"') IS NOT NULL THEN
    EXECUTE
      'SELECT EXISTS ('
      '  SELECT 1 FROM "performance"."perf_legacy_promotion_archives" '
      '  WHERE "source_type"::text = ''RESULT_VERSION_SNAPSHOT'''
      ')'
    INTO has_result_snapshot_archive;
  END IF;

  IF has_legacy_dimension
    OR has_cycle_snapshot
    OR has_result_snapshot
    OR has_result_snapshot_archive
  THEN
    RAISE EXCEPTION USING
      MESSAGE = '检测到旧晋升证据，但归档 migration 未在 contract 前完整执行；必须从 contract 前数据库备份恢复，并按顺序重新执行全部 migration，禁止把结果快照补录伪装为完整答案归档',
      HINT = '恢复 20260720193000_contract_evaluation_dimension_model 执行前的数据库备份，再运行 prisma migrate deploy。';
  END IF;
END $$;
