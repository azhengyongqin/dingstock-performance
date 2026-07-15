import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { loadAppConfig } from '../src/config/configuration';

/** Ticket 21 contract migration：真实执行门禁、状态收缩、删表和复合外键。 */
describe('Ticket 21 PostgreSQL contract migration', () => {
  jest.setTimeout(15_000);

  const pool = new Pool({ connectionString: loadAppConfig().database.url });
  const schemas: string[] = [];
  const migrationTemplate = readFileSync(
    join(
      process.cwd(),
      'prisma/migrations/20260716170000_contract_legacy_performance_model/migration.sql',
    ),
    'utf8',
  );

  const prepareExpandedSchema = async (
    suffix: string,
    ready: boolean,
    latestRunFailed = false,
  ) => {
    const schema = `ticket21_contract_${process.pid}_${Date.now()}_${suffix}`;
    schemas.push(schema);
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`
      CREATE TYPE "${schema}"."PerfParticipantStatus" AS ENUM (
        'ACTIVE', 'PENDING_SELF_REVIEW', 'SELF_SUBMITTED', 'RETURNED', 'REVIEWED',
        'AI_DONE', 'CALIBRATED', 'RESULT_PUSHED', 'RESULT_PUBLISHED', 'CONFIRMED',
        'APPEALING', 'RE_CONFIRMING', 'NO_RESULT', 'WITHDRAWN', 'ARCHIVED'
      );
      CREATE TYPE "${schema}"."PerfSelfReviewStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'RETURNED');
      CREATE TYPE "${schema}"."PerfDimensionType" AS ENUM ('REGULAR', 'PROMOTION', 'TEXT', 'METRIC');
      CREATE TYPE "${schema}"."PerfScoringMethod" AS ENUM ('LEVEL', 'SCORE', 'CONCLUSION', 'TEXT');
      CREATE TYPE "${schema}"."PerfRatingSymbol" AS ENUM ('S', 'A', 'B', 'C');

      CREATE TABLE "${schema}"."perf_cycle_config_versions" (
        id INTEGER PRIMARY KEY,
        cycle_id INTEGER NOT NULL,
        UNIQUE (id, cycle_id)
      );
      CREATE TABLE "${schema}"."perf_cycles" (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        current_config_version_id INTEGER,
        start_date DATE,
        end_date DATE,
        template_id INTEGER,
        windows JSONB,
        notification_rules JSONB
      );
      CREATE TABLE "${schema}"."perf_participants" (
        id INTEGER PRIMARY KEY,
        cycle_id INTEGER NOT NULL,
        employee_open_id TEXT NOT NULL,
        status "${schema}"."PerfParticipantStatus" NOT NULL DEFAULT 'PENDING_SELF_REVIEW'
      );
      CREATE TABLE "${schema}"."perf_calibrations" (
        id SERIAL PRIMARY KEY,
        participant_id INTEGER NOT NULL,
        invalidated_at TIMESTAMP(3)
      );
      CREATE TABLE "${schema}"."perf_result_versions" (
        id SERIAL PRIMARY KEY,
        participant_id INTEGER NOT NULL,
        version INTEGER NOT NULL,
        final_level "${schema}"."PerfRatingSymbol" NOT NULL,
        employee_explanation TEXT,
        source_calibration_id INTEGER,
        result_snapshot JSONB NOT NULL,
        published_by_open_id TEXT NOT NULL,
        published_at TIMESTAMP(3) NOT NULL,
        superseded_at TIMESTAMP(3),
        confirmed_at TIMESTAMP(3),
        confirmed_by_open_id TEXT,
        created_at TIMESTAMP(3) NOT NULL,
        invalidated_at TIMESTAMP(3),
        invalidated_by_rollback_id INTEGER
      );
      CREATE TABLE "${schema}"."perf_appeals" (
        id SERIAL PRIMARY KEY,
        participant_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        invalidated_at TIMESTAMP(3)
      );
      CREATE TABLE "${schema}"."perf_results" (
        id SERIAL PRIMARY KEY,
        participant_id INTEGER NOT NULL UNIQUE,
        final_level TEXT NOT NULL,
        dimension_results JSONB,
        confirmed_by_employee BOOLEAN NOT NULL DEFAULT false,
        confirmed_at TIMESTAMP(3),
        created_at TIMESTAMP(3) NOT NULL DEFAULT NOW(),
        invalidated_at TIMESTAMP(3)
      );
      CREATE TABLE "${schema}"."perf_legacy_migration_runs" (
        id INTEGER PRIMARY KEY,
        cycle_id INTEGER,
        dry_run BOOLEAN NOT NULL,
        status TEXT NOT NULL,
        readiness_report JSONB,
        completed_at TIMESTAMP(3)
      );
      CREATE TABLE "${schema}"."perf_legacy_migration_items" (
        id INTEGER PRIMARY KEY,
        run_id INTEGER NOT NULL,
        source_type TEXT NOT NULL,
        source_business_key TEXT NOT NULL,
        target_type TEXT,
        target_id INTEGER,
        status TEXT NOT NULL
      );
      CREATE TABLE "${schema}"."system_configs" (
        id SERIAL PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        value JSONB NOT NULL,
        description TEXT,
        updated_by_open_id TEXT,
        created_at TIMESTAMP(3) NOT NULL,
        updated_at TIMESTAMP(3) NOT NULL
      );

      CREATE TABLE "${schema}"."perf_templates" (id INTEGER PRIMARY KEY);
      CREATE TABLE "${schema}"."perf_template_dimensions" (id INTEGER PRIMARY KEY);
      CREATE TABLE "${schema}"."perf_evaluation_rules" (id INTEGER PRIMARY KEY);
      CREATE TABLE "${schema}"."perf_dimensions" (
        id INTEGER PRIMARY KEY,
        type "${schema}"."PerfDimensionType",
        scoring_method "${schema}"."PerfScoringMethod"
      );
      CREATE TABLE "${schema}"."perf_self_reviews" (
        id INTEGER PRIMARY KEY,
        status "${schema}"."PerfSelfReviewStatus"
      );
      CREATE TABLE "${schema}"."perf_reviews" (id INTEGER PRIMARY KEY);
      CREATE TABLE "${schema}"."perf_manager_reviews" (id INTEGER PRIMARY KEY);

      INSERT INTO "${schema}"."perf_cycle_config_versions" VALUES (101, 1), (202, 2);
      INSERT INTO "${schema}"."perf_cycles" (id, name) VALUES (1, '2026 H1');
      INSERT INTO "${schema}"."perf_participants" VALUES
        (11, 1, 'ou_11', 'PENDING_SELF_REVIEW'),
        (12, 1, 'ou_12', 'RESULT_PUSHED'),
        (13, 1, 'ou_13', 'ARCHIVED'),
        (14, 1, 'ou_14', 'CONFIRMED');
      INSERT INTO "${schema}"."perf_results"
        (participant_id, final_level, dimension_results, confirmed_by_employee, confirmed_at)
      VALUES (12, 'A', '[]', true, NOW());
      INSERT INTO "${schema}"."perf_calibrations" (participant_id)
      VALUES (13);
      INSERT INTO "${schema}"."perf_result_versions" (
        participant_id, version, final_level, result_snapshot,
        published_by_open_id, published_at, superseded_at, confirmed_at,
        confirmed_by_open_id, created_at, invalidated_at
      ) VALUES
        (14, 1, 'B', '{}', 'ou_hr', NOW(), NOW(), NOW(), 'ou_14', NOW(), NOW()),
        (14, 2, 'A', '{}', 'ou_hr', NOW(), NULL, NULL, NULL, NOW(), NULL);
    `);
    if (ready) {
      await pool.query(`
        INSERT INTO "${schema}"."perf_legacy_migration_runs"
          (id, cycle_id, dry_run, status, readiness_report, completed_at)
        VALUES (8, NULL, false, 'COMPLETED', '{"ready":true,"blockers":[]}', NOW());
        INSERT INTO "${schema}"."perf_legacy_migration_items"
          (id, run_id, source_type, source_business_key, target_type, target_id, status)
        VALUES (9, 8, 'CYCLE_CONFIGURATION', 'perf_cycles:1', 'PerfCycleConfigVersion', 101, 'MIGRATED');
      `);
    }
    if (latestRunFailed) {
      await pool.query(`
        INSERT INTO "${schema}"."perf_legacy_migration_runs"
          (id, cycle_id, dry_run, status, readiness_report, completed_at)
        VALUES (10, NULL, false, 'FAILED', '{"ready":false,"blockers":["FAILED_ITEM"]}', NOW());
      `);
    }
    return schema;
  };

  afterAll(async () => {
    for (const schema of schemas) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await pool.end();
  });

  it('存在业务周期但没有正式全量 readiness 时在任何删表前失败', async () => {
    const schema = await prepareExpandedSchema('blocked', false);
    const migration = migrationTemplate.replaceAll(
      '"performance"',
      `"${schema}"`,
    );

    await expect(pool.query(migration)).rejects.toThrow(
      /PERFORMANCE_CUTOVER_NOT_READY/,
    );
    const legacyTable = await pool.query<{ name: string | null }>(
      `SELECT to_regclass('"${schema}"."perf_self_reviews"')::text AS name`,
    );
    expect(legacyTable.rows[0].name).not.toBeNull();
  });

  it('更早批次通过但最新正式全量批次失败时仍阻断 contract', async () => {
    const schema = await prepareExpandedSchema('latest_failed', true, true);
    const migration = migrationTemplate.replaceAll(
      '"performance"',
      `"${schema}"`,
    );

    await expect(pool.query(migration)).rejects.toThrow(
      /PERFORMANCE_CUTOVER_NOT_READY/,
    );
  });

  it('readiness 通过后回填读指针、收缩旧结构并拒绝跨周期配置', async () => {
    const schema = await prepareExpandedSchema('ready', true);
    const migration = migrationTemplate.replaceAll(
      '"performance"',
      `"${schema}"`,
    );
    await pool.query(migration);

    const state = await pool.query<{
      current_config_version_id: number;
      statuses: string[];
      cutover: Record<string, unknown>;
      legacy_table: string | null;
      legacy_enum: string | null;
    }>(`
      SELECT cycle.current_config_version_id,
        (SELECT array_agg(status::text ORDER BY id)
         FROM "${schema}"."perf_participants"
         WHERE cycle_id = cycle.id) AS statuses,
        (SELECT value FROM "${schema}"."system_configs" WHERE key = 'performance.model.cutover') AS cutover,
        to_regclass('"${schema}"."perf_self_reviews"')::text AS legacy_table,
        to_regtype('"${schema}"."PerfSelfReviewStatus"')::text AS legacy_enum
      FROM "${schema}"."perf_cycles" cycle
      WHERE cycle.id = 1
    `);
    expect(state.rows[0]).toMatchObject({
      current_config_version_id: 101,
      statuses: ['ACTIVE', 'CONFIRMED', 'CALIBRATED', 'RESULT_PUBLISHED'],
      cutover: expect.objectContaining({
        phase: 'CONTRACTED',
        readPath: 'VERSIONED',
        writePath: 'UNIFIED_SUBMISSION',
        rollbackEnabled: false,
      }),
      legacy_table: null,
      legacy_enum: null,
    });
    const oldResult = await pool.query<{ name: string | null }>(
      `SELECT to_regclass('"${schema}"."perf_results"')::text AS name`,
    );
    expect(oldResult.rows[0].name).toBeNull();
    const migratedVersion = await pool.query<{
      final_level: string;
      confirmed_by_open_id: string | null;
    }>(`
      SELECT final_level, confirmed_by_open_id
      FROM "${schema}"."perf_result_versions"
      WHERE participant_id = 12
    `);
    expect(migratedVersion.rows).toEqual([
      { final_level: 'A', confirmed_by_open_id: 'ou_12' },
    ]);
    await expect(
      pool.query(
        `UPDATE "${schema}"."perf_cycles" SET current_config_version_id = 202 WHERE id = 1`,
      ),
    ).rejects.toThrow();
  });
});
