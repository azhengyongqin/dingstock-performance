import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { loadAppConfig } from '../src/config/configuration';

/** corrective migration 的真实 PG 接缝：旧 item 表存在时全量归档，不存在时安全补历史快照。 */
describe('旧晋升答案只读归档 PostgreSQL 迁移', () => {
  jest.setTimeout(30_000);
  const pool = new Pool({ connectionString: loadAppConfig().database.url });
  const schemas: string[] = [];
  const template = readFileSync(
    join(
      process.cwd(),
      'prisma/migrations/20260720192500_archive_legacy_promotion_answers/migration.sql',
    ),
    'utf8',
  );

  async function prepare(suffix: string, withLegacyItems: boolean) {
    const schema = `promotion_archive_${process.pid}_${Date.now()}_${suffix}`;
    schemas.push(schema);
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`
      CREATE TYPE "${schema}"."PerfEvaluationTaskType" AS ENUM ('SELF', 'PEER', 'MANAGER', 'AI');
      CREATE TYPE "${schema}"."PerfReviewStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'INVALIDATED');
      CREATE TYPE "${schema}"."PerfFormItemType" AS ENUM ('RATING', 'SCORE', 'LONG_TEXT');
      CREATE TYPE "${schema}"."PerfRatingSymbol" AS ENUM ('S', 'A', 'B', 'C');
      CREATE TABLE "${schema}"."perf_cycles" (id INTEGER PRIMARY KEY);
      CREATE TABLE "${schema}"."perf_participants" (
        id INTEGER PRIMARY KEY,
        cycle_id INTEGER NOT NULL,
        UNIQUE (id, cycle_id)
      );
      CREATE TABLE "${schema}"."perf_cycle_form_snapshots" (
        id INTEGER PRIMARY KEY,
        content JSONB NOT NULL
      );
      CREATE TABLE "${schema}"."perf_evaluation_submissions" (
        id INTEGER PRIMARY KEY,
        cycle_id INTEGER NOT NULL,
        participant_id INTEGER NOT NULL,
        stage "${schema}"."PerfEvaluationTaskType" NOT NULL,
        reviewer_open_id TEXT NOT NULL,
        form_snapshot_id INTEGER NOT NULL,
        status "${schema}"."PerfReviewStatus" NOT NULL,
        submitted_at TIMESTAMP(3),
        UNIQUE (id, form_snapshot_id)
      );
      CREATE TABLE "${schema}"."perf_result_versions" (
        id INTEGER PRIMARY KEY,
        participant_id INTEGER NOT NULL,
        version INTEGER NOT NULL,
        result_snapshot JSONB NOT NULL,
        created_at TIMESTAMP(3) NOT NULL
      );
      INSERT INTO "${schema}"."perf_cycles" VALUES (1);
      INSERT INTO "${schema}"."perf_participants" VALUES (11, 1);
      INSERT INTO "${schema}"."perf_cycle_form_snapshots" VALUES
        (21, '{"subforms":[{"key":"legacy:promotion","type":"PROMOTION"}]}');
      INSERT INTO "${schema}"."perf_evaluation_submissions" VALUES
        (31, 1, 11, 'SELF', 'ou_employee', 21, 'INVALIDATED', NOW());
      INSERT INTO "${schema}"."perf_result_versions" VALUES
        (41, 11, 1, '{"promotion":{"visible":true,"items":[{"value":"历史投影"}]}}', NOW());
    `);
    if (withLegacyItems) {
      await pool.query(`
        CREATE TABLE "${schema}"."perf_evaluation_item_results" (
          id INTEGER PRIMARY KEY,
          submission_id INTEGER NOT NULL,
          form_snapshot_id INTEGER NOT NULL,
          subform_key TEXT NOT NULL,
          dimension_key TEXT NOT NULL,
          item_key TEXT NOT NULL,
          item_type "${schema}"."PerfFormItemType" NOT NULL,
          raw_level "${schema}"."PerfRatingSymbol",
          raw_score DECIMAL(5,2),
          calculation_score DECIMAL(5,2),
          value JSONB,
          created_at TIMESTAMP(3) NOT NULL,
          updated_at TIMESTAMP(3) NOT NULL
        );
        INSERT INTO "${schema}"."perf_evaluation_item_results" VALUES
          (51, 31, 21, 'legacy:promotion', 'promotion:statement', 'promotion:text',
           'LONG_TEXT', NULL, NULL, NULL, '"完整旧答案"', NOW(), NOW());
      `);
    }
    const migration = template
      .replaceAll('"performance"', `"${schema}"`)
      .replaceAll(
        "namespace.nspname = 'performance'",
        `namespace.nspname = '${schema}'`,
      )
      .replaceAll(
        'performance.perf_evaluation_item_results',
        `${schema}.perf_evaluation_item_results`,
      );
    await pool.query(migration);
    return schema;
  }

  afterAll(async () => {
    for (const schema of schemas) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await pool.end();
  });

  it('旧源表仍在时同时保留完整 item 答案与结果快照投影', async () => {
    const schema = await prepare('source', true);
    const archived = await pool.query<{
      source_type: string;
      payload: Record<string, unknown>;
    }>(`
      SELECT source_type::text, payload
      FROM "${schema}"."perf_legacy_promotion_archives"
      ORDER BY source_type
    `);

    expect(archived.rows).toHaveLength(2);
    expect(archived.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_type: 'EVALUATION_ITEM_RESULT',
          payload: expect.objectContaining({ value: '完整旧答案' }),
        }),
        expect.objectContaining({
          source_type: 'RESULT_VERSION_SNAPSHOT',
          payload: expect.objectContaining({
            promotion: expect.objectContaining({ visible: true }),
          }),
        }),
      ]),
    );
    await expect(
      pool.query(
        `UPDATE "${schema}"."perf_legacy_promotion_archives" SET payload = '{}'`,
      ),
    ).rejects.toThrow('append-only');
  });

  it('旧源表已被 contract 删除时迁移仍成功并补录存活结果投影', async () => {
    const schema = await prepare('contracted', false);
    const rows = await pool.query<{ source_type: string }>(`
      SELECT source_type::text
      FROM "${schema}"."perf_legacy_promotion_archives"
    `);
    expect(rows.rows).toEqual([{ source_type: 'RESULT_VERSION_SNAPSHOT' }]);
  });
});
