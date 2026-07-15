import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { loadAppConfig } from '../src/config/configuration';

/**
 * 该专用测试只由 pnpm test:postgres 运行。它创建随机隔离 schema，
 * 结束后 DROP CASCADE，不依赖或修改 performance 业务 schema。
 */
describe('Ticket 13 PostgreSQL 事务与约束集成', () => {
  jest.setTimeout(15_000);

  const schema = `ticket13_it_${process.pid}_${Date.now()}`;
  const connectionString = loadAppConfig().database.url;
  const first = new Pool({ connectionString });
  const second = new Pool({ connectionString });
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
      const character = sql[index];
      if (character === ';' && !inDollarBlock) {
        if (current.trim()) statements.push(current.trim());
        current = '';
        continue;
      }
      current += character;
    }
    if (current.trim()) statements.push(current.trim());
    return statements;
  };

  beforeAll(async () => {
    await first.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    await first.query(`
      CREATE TYPE "${schema}"."PerfParticipantStatus"
      AS ENUM ('REVIEWED', 'AI_DONE', 'CALIBRATED')
    `);
    await first.query(`
      CREATE TABLE "${schema}"."perf_participants" (
        "id" INTEGER PRIMARY KEY,
        "status" "${schema}"."PerfParticipantStatus" NOT NULL
      )
    `);
    await first.query(`
      CREATE TABLE "${schema}"."perf_calibrations" (
        "id" SERIAL PRIMARY KEY,
        "participant_id" INTEGER NOT NULL REFERENCES "${schema}"."perf_participants"("id"),
        "before_level" TEXT,
        "after_level" TEXT NOT NULL,
        "reason" TEXT NOT NULL,
        "operator_open_id" TEXT NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await first.query(`
      CREATE TABLE "${schema}"."perf_results" (
        "id" SERIAL PRIMARY KEY,
        "participant_id" INTEGER NOT NULL,
        "final_level" TEXT NOT NULL
      )
    `);
    await first.query(`
      INSERT INTO "${schema}"."perf_participants" ("id", "status")
      VALUES (7, 'REVIEWED')
    `);
    await first.query(`
      INSERT INTO "${schema}"."perf_calibrations"
        ("participant_id", "before_level", "after_level", "reason", "operator_open_id", "created_at")
      VALUES
        (7, 'B', 'A', '迁移前历史调整', 'ou_hr', '2026-07-15T08:00:00Z')
    `);

    // 直接执行真实迁移，只把固定业务 schema 替换为本次随机隔离 schema。
    const migration = readFileSync(
      join(
        process.cwd(),
        'prisma/migrations/20260716010000_add_calibration_decisions_and_red_lines/migration.sql',
      ),
      'utf8',
    ).replaceAll('"performance"', `"${schema}"`);
    for (const statement of splitSqlStatements(migration)) {
      await first.query(statement);
    }
    await first.query(`
      INSERT INTO "${schema}"."perf_participants" ("id", "status")
      VALUES (8, 'REVIEWED')
    `);
  });

  afterAll(async () => {
    if (schemaCreated) {
      await first.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
    await Promise.all([first.end(), second.end()]);
  });

  it('回填历史锁，并验证首条决定与评估锁同事务回滚及 FOR UPDATE 阻塞', async () => {
    const legacy = await first.query<{
      status: string;
      evaluation_locked_at: Date | null;
      is_legacy: boolean;
    }>(`
      SELECT participant."status", participant."evaluation_locked_at", calibration."is_legacy"
      FROM "${schema}"."perf_participants" AS participant
      JOIN "${schema}"."perf_calibrations" AS calibration
        ON calibration."participant_id" = participant."id"
      WHERE participant."id" = 7
    `);
    expect(legacy.rows[0]).toMatchObject({
      status: 'CALIBRATED',
      // 业务列为 timestamp without time zone；测试连接位于 Asia/Shanghai，pg 读取后换算为 UTC。
      evaluation_locked_at: new Date('2026-07-15T00:00:00.000Z'),
      is_legacy: true,
    });

    const rollbackClient = await first.connect();
    await rollbackClient.query('BEGIN');
    await rollbackClient.query(`
      INSERT INTO "${schema}"."perf_calibrations"
        ("participant_id", "decision", "before_level", "after_level", "input_revision", "operator_open_id")
      VALUES (8, 'KEEP', 'B', 'B', repeat('a', 64), 'ou_leader')
    `);
    await rollbackClient.query(`
      UPDATE "${schema}"."perf_participants"
      SET "evaluation_locked_at" = NOW()
      WHERE "id" = 8
    `);
    await rollbackClient.query('ROLLBACK');
    rollbackClient.release();
    const rollbackState = await first.query<{
      decisions: string;
      evaluation_locked_at: Date | null;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM "${schema}"."perf_calibrations" WHERE "participant_id" = 8) AS "decisions",
        "evaluation_locked_at"
      FROM "${schema}"."perf_participants" WHERE "id" = 8
    `);
    expect(Number(rollbackState.rows[0].decisions)).toBe(0);
    expect(rollbackState.rows[0].evaluation_locked_at).toBeNull();

    const holder = await first.connect();
    const contender = await second.connect();
    await holder.query('BEGIN');
    await holder.query(`
      SELECT "id" FROM "${schema}"."perf_participants"
      WHERE "id" = 8 FOR UPDATE
    `);
    await contender.query('BEGIN');
    await contender.query(`SET LOCAL lock_timeout = '150ms'`);
    await expect(
      contender.query(`
        SELECT "id" FROM "${schema}"."perf_participants"
        WHERE "id" = 8 FOR UPDATE
      `),
    ).rejects.toThrow();
    await contender.query('ROLLBACK');
    await holder.query('COMMIT');
    contender.release();
    holder.release();
  });

  it('允许 ADJUST 后 KEEP 回到 MANAGER 等级，并拒绝空原因与红线下非 C 结果', async () => {
    await first.query(`
      INSERT INTO "${schema}"."perf_calibrations"
        ("participant_id", "decision", "before_level", "after_level", "input_revision", "operator_open_id")
      VALUES (8, 'KEEP', 'A', 'B', repeat('b', 64), 'ou_leader')
    `);
    await expect(
      first.query(`
        INSERT INTO "${schema}"."perf_calibrations"
          ("participant_id", "decision", "before_level", "after_level", "reason", "input_revision", "operator_open_id")
        VALUES (8, 'ADJUST', 'B', 'A', '   ', repeat('c', 64), 'ou_leader')
      `),
    ).rejects.toThrow();

    await first.query(`
      INSERT INTO "${schema}"."perf_red_line_findings"
        ("participant_id", "action", "finding_type", "facts", "evidence", "reason", "operator_open_id")
      VALUES
        (8, 'CONFIRM', 'SERIOUS_VIOLATION', '已核实事实', '[{"fileToken":"evidence"}]', '制度红线', 'ou_hr')
    `);
    await expect(
      first.query(`
        INSERT INTO "${schema}"."perf_results" ("participant_id", "final_level")
        VALUES (8, 'A')
      `),
    ).rejects.toThrow('active red-line finding requires final level C');
    await expect(
      first.query(`
        INSERT INTO "${schema}"."perf_results" ("participant_id", "final_level")
        VALUES (8, 'C')
      `),
    ).resolves.toMatchObject({ rowCount: 1 });
  });
});
