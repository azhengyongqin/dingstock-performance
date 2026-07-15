import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { loadAppConfig } from '../src/config/configuration';

/** Ticket 20 数据库边界：幂等来源键、checksum、批次终态与回滚形状。 */
describe('Ticket 20 PostgreSQL 迁移账本约束', () => {
  jest.setTimeout(15_000);

  const schema = `ticket20_it_${process.pid}_${Date.now()}`;
  const first = new Pool({ connectionString: loadAppConfig().database.url });
  const second = new Pool({ connectionString: loadAppConfig().database.url });
  let schemaCreated = false;

  beforeAll(async () => {
    await first.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    await first.query(`
      CREATE TYPE "${schema}"."PerfParticipantStatus"
      AS ENUM ('PENDING_SELF_REVIEW', 'CALIBRATED', 'CONFIRMED');
      CREATE TABLE "${schema}"."perf_cycles" ("id" INTEGER PRIMARY KEY);
      CREATE TABLE "${schema}"."legacy_targets" (
        "id" SERIAL PRIMARY KEY,
        "source_key" TEXT NOT NULL
      );
      INSERT INTO "${schema}"."perf_cycles" VALUES (17);
    `);
    const migration = readFileSync(
      join(
        process.cwd(),
        'prisma/migrations/20260716150000_add_legacy_migration_ledger/migration.sql',
      ),
      'utf8',
    ).replaceAll('"performance"', `"${schema}"`);
    await first.query(migration);
  });

  afterAll(async () => {
    if (schemaCreated) await first.query(`DROP SCHEMA "${schema}" CASCADE`);
    await Promise.all([first.end(), second.end()]);
  });

  it('增加 ACTIVE 新态但保留全部旧参与者状态', async () => {
    const values = await first.query<{ enumlabel: string }>(`
      SELECT "enumlabel"
      FROM "pg_enum"
      JOIN "pg_type" ON "pg_type"."oid" = "pg_enum"."enumtypid"
      JOIN "pg_namespace" ON "pg_namespace"."oid" = "pg_type"."typnamespace"
      WHERE "pg_namespace"."nspname" = '${schema}'
        AND "pg_type"."typname" = 'PerfParticipantStatus'
      ORDER BY "pg_enum"."enumsortorder"
    `);
    expect(values.rows.map((row) => row.enumlabel)).toEqual([
      'ACTIVE',
      'PENDING_SELF_REVIEW',
      'CALIBRATED',
      'CONFIRMED',
    ]);
  });

  it('来源业务键跨批次唯一，合法 checksum 可写且目标必须成对', async () => {
    const run = await first.query<{ id: number }>(`
      INSERT INTO "${schema}"."perf_legacy_migration_runs"
        ("run_key", "cycle_id", "dry_run", "updated_at")
      VALUES ('ticket20-it', 17, false, CURRENT_TIMESTAMP)
      RETURNING "id"
    `);
    const runId = run.rows[0].id;
    await expect(
      first.query(
        `INSERT INTO "${schema}"."perf_legacy_migration_items"
          ("run_id", "source_type", "source_business_key", "target_type", "target_id", "checksum", "status", "updated_at")
         VALUES ($1, 'PEER_SUBMISSION', 'perf_reviews:9', 'PerfEvaluationSubmission', 31, $2, 'MIGRATED', CURRENT_TIMESTAMP)`,
        [runId, 'a'.repeat(64)],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      first.query(
        `INSERT INTO "${schema}"."perf_legacy_migration_items"
          ("run_id", "source_type", "source_business_key", "checksum", "status", "updated_at")
         VALUES ($1, 'PEER_SUBMISSION', 'perf_reviews:9', $2, 'FAILED', CURRENT_TIMESTAMP)`,
        [runId, 'a'.repeat(64)],
      ),
    ).rejects.toThrow('duplicate key');
    await expect(
      first.query(
        `INSERT INTO "${schema}"."perf_legacy_migration_items"
          ("run_id", "source_type", "source_business_key", "checksum", "status", "updated_at")
         VALUES ($1, 'MANAGER_SUBMISSION', 'perf_manager_reviews:8', 'bad', 'FAILED', CURRENT_TIMESTAMP)`,
        [runId],
      ),
    ).rejects.toThrow('checksum_check');
    await expect(
      first.query(
        `INSERT INTO "${schema}"."perf_legacy_migration_items"
          ("run_id", "source_type", "source_business_key", "target_type", "checksum", "status", "updated_at")
         VALUES ($1, 'SELF_SUBMISSION', 'perf_self_reviews:7', 'PerfEvaluationSubmission', $2, 'FAILED', CURRENT_TIMESTAMP)`,
        [runId, 'b'.repeat(64)],
      ),
    ).rejects.toThrow('target_pair_check');
  });

  it('并发重跑同一来源键最多一条成功', async () => {
    const runId = (
      await first.query<{ id: number }>(
        `SELECT "id" FROM "${schema}"."perf_legacy_migration_runs" WHERE "run_key"='ticket20-it'`,
      )
    ).rows[0].id;
    const sql = `INSERT INTO "${schema}"."perf_legacy_migration_items"
      ("run_id", "source_type", "source_business_key", "checksum", "status", "updated_at")
      VALUES ($1, 'RESULT_VERSION', 'perf_results:5', $2, 'FAILED', CURRENT_TIMESTAMP)`;
    const results = await Promise.allSettled([
      first.query(sql, [runId, 'c'.repeat(64)]),
      second.query(sql, [runId, 'c'.repeat(64)]),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
  });

  it('来源 advisory lock + 先 claim 后建目标保证并发只创建一个目标', async () => {
    const runId = (
      await first.query<{ id: number }>(
        `SELECT "id" FROM "${schema}"."perf_legacy_migration_runs" WHERE "run_key"='ticket20-it'`,
      )
    ).rows[0].id;
    const migrate = async (pool: Pool) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const sourceKey = 'PEER_SUBMISSION:perf_reviews:claim-20';
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [sourceKey],
        );
        const existing = await client.query<{ target_id: number | null }>(
          `SELECT "target_id" FROM "${schema}"."perf_legacy_migration_items"
           WHERE "source_type"='PEER_SUBMISSION' AND "source_business_key"='perf_reviews:claim-20'`,
        );
        if (existing.rows[0]?.target_id) {
          await client.query('COMMIT');
          return existing.rows[0].target_id;
        }
        const claim = await client.query<{ id: number }>(
          `INSERT INTO "${schema}"."perf_legacy_migration_items"
            ("run_id", "source_type", "source_business_key", "checksum", "status", "updated_at")
           VALUES ($1, 'PEER_SUBMISSION', 'perf_reviews:claim-20', $2, 'SKIPPED', CURRENT_TIMESTAMP)
           RETURNING "id"`,
          [runId, 'd'.repeat(64)],
        );
        const target = await client.query<{ id: number }>(
          `INSERT INTO "${schema}"."legacy_targets" ("source_key")
           VALUES ('perf_reviews:claim-20') RETURNING "id"`,
        );
        await client.query(
          `UPDATE "${schema}"."perf_legacy_migration_items"
           SET "target_type"='PerfEvaluationSubmission', "target_id"=$1,
               "status"='MIGRATED', "updated_at"=CURRENT_TIMESTAMP
           WHERE "id"=$2`,
          [target.rows[0].id, claim.rows[0].id],
        );
        await client.query('COMMIT');
        return target.rows[0].id;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    };

    const targetIds = await Promise.all([migrate(first), migrate(second)]);
    expect(new Set(targetIds).size).toBe(1);
    const targets = await first.query<{ count: string }>(
      `SELECT COUNT(*) AS "count" FROM "${schema}"."legacy_targets"
       WHERE "source_key"='perf_reviews:claim-20'`,
    );
    expect(Number(targets.rows[0].count)).toBe(1);
  });

  it('批次终态时间形状受 CHECK 保护，补偿回滚可原子落账', async () => {
    await expect(
      first.query(`
        UPDATE "${schema}"."perf_legacy_migration_runs"
        SET "status"='COMPLETED'
        WHERE "run_key"='ticket20-it'
      `),
    ).rejects.toThrow('terminal_shape_check');
    await first.query('BEGIN');
    try {
      await first.query(`
        UPDATE "${schema}"."perf_legacy_migration_items"
        SET "status"='ROLLED_BACK', "updated_at"=CURRENT_TIMESTAMP
        WHERE "run_id"=(SELECT "id" FROM "${schema}"."perf_legacy_migration_runs" WHERE "run_key"='ticket20-it')
      `);
      await first.query(`
        UPDATE "${schema}"."perf_legacy_migration_runs"
        SET "status"='ROLLED_BACK', "completed_at"=CURRENT_TIMESTAMP,
            "rolled_back_at"=CURRENT_TIMESTAMP, "updated_at"=CURRENT_TIMESTAMP
        WHERE "run_key"='ticket20-it'
      `);
      await first.query('COMMIT');
    } catch (error) {
      await first.query('ROLLBACK');
      throw error;
    }
    const row = await first.query<{ status: string }>(
      `SELECT "status" FROM "${schema}"."perf_legacy_migration_runs" WHERE "run_key"='ticket20-it'`,
    );
    expect(row.rows[0].status).toBe('ROLLED_BACK');

    const nextRun = await first.query<{ id: number }>(`
      INSERT INTO "${schema}"."perf_legacy_migration_runs"
        ("run_key", "cycle_id", "dry_run", "updated_at")
      VALUES ('ticket20-it-retry', 17, false, CURRENT_TIMESTAMP)
      RETURNING "id"
    `);
    await expect(
      first.query(
        `UPDATE "${schema}"."perf_legacy_migration_items"
         SET "run_id"=$1, "status"='MIGRATED', "updated_at"=CURRENT_TIMESTAMP
         WHERE "source_type"='PEER_SUBMISSION' AND "source_business_key"='perf_reviews:9'`,
        [nextRun.rows[0].id],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  });
});
