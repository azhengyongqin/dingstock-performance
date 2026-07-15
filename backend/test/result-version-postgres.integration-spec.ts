import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { loadAppConfig } from '../src/config/configuration';

/** Ticket 14 的数据库缝隙：不可变快照、唯一当前版本与发布事务原子性。 */
describe('Ticket 14 PostgreSQL 结果版本约束', () => {
  jest.setTimeout(15_000);

  const schema = `ticket14_it_${process.pid}_${Date.now()}`;
  const pool = new Pool({ connectionString: loadAppConfig().database.url });
  let schemaCreated = false;

  const splitSqlStatements = (sql: string) => {
    const statements: string[] = [];
    let current = '';
    let inDollarBlock = false;
    for (let index = 0; index < sql.length; index += 1) {
      if (sql.slice(index, index + 2) === '$$') {
        inDollarBlock = !inDollarBlock;
        current += '$$';
        index += 1;
        continue;
      }
      if (sql[index] === ';' && !inDollarBlock) {
        if (current.trim()) statements.push(current.trim());
        current = '';
        continue;
      }
      current += sql[index];
    }
    if (current.trim()) statements.push(current.trim());
    return statements;
  };

  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    await pool.query(`
      CREATE TYPE "${schema}"."PerfParticipantStatus"
      AS ENUM ('CALIBRATED', 'RESULT_PUSHED', 'CONFIRMED')
    `);
    await pool.query(`
      CREATE TYPE "${schema}"."PerfNotificationEventType"
      AS ENUM ('TASK_OPENED', 'TASK_REMINDER_DUE', 'CYCLE_START_FAILED')
    `);
    await pool.query(`
      CREATE TYPE "${schema}"."PerfRatingSymbol" AS ENUM ('S', 'A', 'B', 'C')
    `);
    await pool.query(`
      CREATE TABLE "${schema}"."perf_cycles" (
        "id" INTEGER PRIMARY KEY,
        "name" TEXT NOT NULL
      );
      CREATE TABLE "${schema}"."perf_participants" (
        "id" INTEGER PRIMARY KEY,
        "cycle_id" INTEGER NOT NULL REFERENCES "${schema}"."perf_cycles"("id"),
        "employee_open_id" TEXT NOT NULL,
        "status" "${schema}"."PerfParticipantStatus" NOT NULL
      );
      CREATE TABLE "${schema}"."perf_calibrations" (
        "id" SERIAL PRIMARY KEY,
        "participant_id" INTEGER NOT NULL REFERENCES "${schema}"."perf_participants"("id")
      );
      CREATE TABLE "${schema}"."perf_results" (
        "id" SERIAL PRIMARY KEY,
        "participant_id" INTEGER NOT NULL,
        "final_level" TEXT NOT NULL,
        "dimension_results" JSONB,
        "confirmed_at" TIMESTAMP(3),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE "${schema}"."perf_red_line_findings" (
        "id" SERIAL PRIMARY KEY,
        "participant_id" INTEGER NOT NULL,
        "action" TEXT NOT NULL,
        "revoke_of_id" INTEGER
      );
      CREATE TABLE "${schema}"."perf_notification_events" (
        "id" SERIAL PRIMARY KEY,
        "type" "${schema}"."PerfNotificationEventType" NOT NULL,
        "dedupe_key" TEXT NOT NULL UNIQUE
      );
    `);
    await pool.query(`
      CREATE OR REPLACE FUNCTION "${schema}"."enforce_active_red_line_result"()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$
    `);
    await pool.query(`
      INSERT INTO "${schema}"."perf_cycles" ("id", "name")
      VALUES (1, '2026 上半年绩效');
      INSERT INTO "${schema}"."perf_participants"
        ("id", "cycle_id", "employee_open_id", "status")
      VALUES (7, 1, 'ou_employee', 'RESULT_PUSHED');
      INSERT INTO "${schema}"."perf_calibrations" ("participant_id") VALUES (7);
      INSERT INTO "${schema}"."perf_results"
        ("participant_id", "final_level", "dimension_results")
      VALUES (7, 'B', '[]');
    `);

    const migration = readFileSync(
      join(
        process.cwd(),
        'prisma/migrations/20260716030000_add_immutable_result_versions/migration.sql',
      ),
      'utf8',
    ).replaceAll('"performance"', `"${schema}"`);
    for (const statement of splitSqlStatements(migration)) {
      await pool.query(statement);
    }
  });

  afterAll(async () => {
    if (schemaCreated) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  });

  it('回填历史安全快照，并拒绝覆盖或删除已发布业务内容', async () => {
    const migrated = await pool.query<{
      version: number;
      final_level: string;
      published_by_open_id: string;
    }>(`
      SELECT "version", "final_level", "published_by_open_id"
      FROM "${schema}"."perf_result_versions"
      WHERE "participant_id" = 7
    `);
    expect(migrated.rows[0]).toMatchObject({
      version: 1,
      final_level: 'B',
      published_by_open_id: 'system:migration',
    });

    await expect(
      pool.query(`
        UPDATE "${schema}"."perf_result_versions"
        SET "final_level" = 'A' WHERE "participant_id" = 7
      `),
    ).rejects.toThrow('business snapshot is immutable');
    await expect(
      pool.query(`
        DELETE FROM "${schema}"."perf_result_versions"
        WHERE "participant_id" = 7
      `),
    ).rejects.toThrow('DELETE is forbidden');
  });

  it('确认与替代均只能回填一次，且同一参与者只有一个当前版本', async () => {
    await pool.query(`
      UPDATE "${schema}"."perf_result_versions"
      SET "confirmed_at" = NOW(), "confirmed_by_open_id" = 'ou_employee'
      WHERE "participant_id" = 7
    `);
    await expect(
      pool.query(`
        UPDATE "${schema}"."perf_result_versions"
        SET "confirmed_by_open_id" = 'ou_other'
        WHERE "participant_id" = 7
      `),
    ).rejects.toThrow('confirmation can only be set once');
    await expect(
      pool.query(`
        INSERT INTO "${schema}"."perf_result_versions" (
          "participant_id", "version", "final_level", "result_snapshot", "published_by_open_id"
        ) VALUES (7, 2, 'A', '{}', 'ou_hr')
      `),
    ).rejects.toThrow('perf_result_versions_current_key');

    await pool.query(`
      UPDATE "${schema}"."perf_result_versions"
      SET "superseded_at" = NOW() WHERE "participant_id" = 7
    `);
    await pool.query(`
      INSERT INTO "${schema}"."perf_result_versions" (
        "participant_id", "version", "final_level", "result_snapshot", "published_by_open_id"
      ) VALUES (7, 2, 'A', '{}', 'ou_hr')
    `);
    await expect(
      pool.query(`
        UPDATE "${schema}"."perf_result_versions"
        SET "superseded_at" = NOW() WHERE "participant_id" = 7 AND "version" = 1
      `),
    ).rejects.toThrow('superseded_at can only be set once');
  });

  it('结果版本、参与者状态与通知事件在发布事务回滚时全部撤销', async () => {
    const client = await pool.connect();
    await client.query('BEGIN');
    await client.query(`
      UPDATE "${schema}"."perf_result_versions"
      SET "superseded_at" = NOW()
      WHERE "participant_id" = 7 AND "version" = 2
    `);
    await client.query(`
      INSERT INTO "${schema}"."perf_result_versions" (
        "participant_id", "version", "final_level", "result_snapshot", "published_by_open_id"
      ) VALUES (7, 3, 'S', '{}', 'ou_hr')
    `);
    await client.query(`
      UPDATE "${schema}"."perf_participants"
      SET "status" = 'RESULT_PUBLISHED' WHERE "id" = 7
    `);
    await client.query(`
      INSERT INTO "${schema}"."perf_notification_events" ("type", "dedupe_key")
      VALUES ('RESULT_PUBLISHED', 'result-published:3:ou_employee')
    `);
    await client.query('ROLLBACK');
    client.release();

    const state = await pool.query<{
      versions: string;
      events: string;
      status: string;
      superseded_at: Date | null;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM "${schema}"."perf_result_versions") AS "versions",
        (SELECT COUNT(*) FROM "${schema}"."perf_notification_events") AS "events",
        participant."status",
        version."superseded_at"
      FROM "${schema}"."perf_participants" AS participant
      JOIN "${schema}"."perf_result_versions" AS version
        ON version."participant_id" = participant."id" AND version."version" = 2
      WHERE participant."id" = 7
    `);
    expect(Number(state.rows[0].versions)).toBe(2);
    expect(Number(state.rows[0].events)).toBe(0);
    expect(state.rows[0].status).toBe('RESULT_PUSHED');
    expect(state.rows[0].superseded_at).toBeNull();
  });
});
