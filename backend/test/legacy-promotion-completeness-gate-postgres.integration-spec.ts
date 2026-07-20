import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { loadAppConfig } from '../src/config/configuration';

type Evidence =
  'dimension' | 'snapshot' | 'result' | 'archive' | 'all' | 'none';

/** completeness gate 的真实 PG 接缝：以 Prisma 迁移账本顺序判断旧晋升归档是否完整。 */
describe('旧晋升归档完整性 PostgreSQL gate', () => {
  jest.setTimeout(30_000);
  const pool = new Pool({ connectionString: loadAppConfig().database.url });
  const schemas: string[] = [];
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma/migrations/20260720200000_gate_legacy_promotion_archive_completeness/migration.sql',
    ),
    'utf8',
  );

  async function prepare(
    suffix: string,
    order: 'fresh' | 'post-contract',
    evidence: Evidence,
  ) {
    const schema = `promotion_gate_${process.pid}_${Date.now()}_${suffix}`;
    schemas.push(schema);
    await pool.query(`
      CREATE SCHEMA "${schema}";
      CREATE TABLE "${schema}"."_prisma_migrations" (
        id VARCHAR(36) PRIMARY KEY,
        checksum VARCHAR(64) NOT NULL,
        finished_at TIMESTAMPTZ,
        migration_name VARCHAR(255) NOT NULL,
        logs TEXT,
        rolled_back_at TIMESTAMPTZ,
        started_at TIMESTAMPTZ NOT NULL,
        applied_steps_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE "${schema}"."perf_form_dimensions" (type TEXT NOT NULL);
      CREATE TABLE "${schema}"."perf_cycle_form_snapshots" (content JSONB NOT NULL);
      CREATE TABLE "${schema}"."perf_result_versions" (result_snapshot JSONB NOT NULL);
      CREATE TABLE "${schema}"."perf_legacy_promotion_archives" (source_type TEXT NOT NULL);
    `);
    const archiveAt =
      order === 'fresh' ? '2026-07-20T19:25:00Z' : '2026-07-20T19:35:00Z';
    const contractAt =
      order === 'fresh' ? '2026-07-20T19:30:00Z' : '2026-07-20T19:30:00Z';
    await pool.query(
      `INSERT INTO "${schema}"."_prisma_migrations"
         (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES
         ('archive', 'archive', '20260720192500_archive_legacy_promotion_answers', $1::timestamptz, $1::timestamptz, 1),
         ('contract', 'contract', '20260720193000_contract_evaluation_dimension_model', $2::timestamptz, $2::timestamptz, 1)`,
      [archiveAt, contractAt],
    );
    if (evidence === 'dimension' || evidence === 'all') {
      await pool.query(
        `INSERT INTO "${schema}"."perf_form_dimensions" VALUES ('LEGACY_PROMOTION')`,
      );
    }
    if (evidence === 'snapshot' || evidence === 'all') {
      await pool.query(
        `INSERT INTO "${schema}"."perf_cycle_form_snapshots" VALUES ('{"subforms":[{"type":"PROMOTION"}]}'::jsonb)`,
      );
    }
    if (evidence === 'result' || evidence === 'all') {
      await pool.query(
        `INSERT INTO "${schema}"."perf_result_versions" VALUES ('{"promotion":{"visible":true}}'::jsonb)`,
      );
    }
    if (evidence === 'archive' || evidence === 'all') {
      await pool.query(
        `INSERT INTO "${schema}"."perf_legacy_promotion_archives" VALUES ('RESULT_VERSION_SNAPSHOT')`,
      );
    }
    return schema;
  }

  async function applyGate(schema: string) {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL search_path TO "${schema}"`);
      await client.query(migration.replaceAll('"performance"', `"${schema}"`));
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  afterAll(async () => {
    for (const schema of schemas) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await pool.end();
  });

  it('fresh 顺序即使存在旧晋升证据也允许通过', async () => {
    const schema = await prepare('fresh', 'fresh', 'all');
    await expect(applyGate(schema)).resolves.toBeUndefined();
  });

  it('contract 后补归档但不存在任何旧晋升证据时允许通过', async () => {
    const schema = await prepare('empty', 'post-contract', 'none');
    await expect(applyGate(schema)).resolves.toBeUndefined();
  });

  it.each(['dimension', 'snapshot', 'result', 'archive'] as const)(
    'contract 后补归档且存在 %s 证据时要求从备份恢复',
    async (evidence) => {
      const schema = await prepare(evidence, 'post-contract', evidence);
      await expect(applyGate(schema)).rejects.toThrow(
        /contract 前数据库备份恢复.*按顺序重新执行/,
      );
    },
  );
});
