import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadAppConfig } from '../src/config/configuration';

/** Ticket 19 PostgreSQL seam：验证归档快照、永久状态、终态保留与周期行锁。 */
describe('Ticket 19 PostgreSQL 周期归档集成', () => {
  jest.setTimeout(15_000);

  const schema = `ticket19_it_${process.pid}_${Date.now()}`;
  const connectionString = loadAppConfig().database.url;
  const first = new Pool({ connectionString });
  const second = new Pool({ connectionString });
  let schemaCreated = false;

  beforeAll(async () => {
    await first.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    // 只搭建 Ticket 19 迁移的前置表/枚举；归档表、函数和触发器必须来自真实 migration。
    await first.query(`
      CREATE TYPE "${schema}"."PerfCycleStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'ARCHIVED');
      CREATE TYPE "${schema}"."PerfParticipantStatus" AS ENUM (
        'PENDING_SELF_REVIEW', 'SELF_SUBMITTED', 'RETURNED', 'REVIEWED', 'AI_DONE',
        'CALIBRATED', 'RESULT_PUSHED', 'RESULT_PUBLISHED', 'CONFIRMED', 'APPEALING',
        'RE_CONFIRMING', 'NO_RESULT', 'ARCHIVED'
      );
      CREATE TABLE "${schema}"."perf_cycles" (
        id INTEGER PRIMARY KEY,
        status "${schema}"."PerfCycleStatus" NOT NULL,
        deleted_at TIMESTAMP(3)
      );
      CREATE TABLE "${schema}"."perf_participants" (
        id INTEGER PRIMARY KEY,
        cycle_id INTEGER NOT NULL REFERENCES "${schema}"."perf_cycles"(id),
        status "${schema}"."PerfParticipantStatus" NOT NULL
      );
    `);
    const migrationPath = join(
      __dirname,
      '../prisma/migrations/20260716130000_add_cycle_archive_snapshot/migration.sql',
    );
    const migrationSql = readFileSync(migrationPath, 'utf8').replaceAll(
      '"performance"',
      `"${schema}"`,
    );
    await first.query(migrationSql);

    await first.query(`
      INSERT INTO "${schema}"."perf_cycles" (id, status) VALUES (19, 'ACTIVE'), (20, 'ACTIVE'), (21, 'ACTIVE');
      INSERT INTO "${schema}"."perf_participants" (id, cycle_id, status) VALUES
        (191, 19, 'CONFIRMED'), (192, 19, 'NO_RESULT'), (193, 19, 'WITHDRAWN');
    `);
  });

  afterAll(async () => {
    if (schemaCreated) await first.query(`DROP SCHEMA "${schema}" CASCADE`);
    await Promise.all([first.end(), second.end()]);
  });

  it('状态与归档快照同事务提交，参与者三种终态保持且历史可读', async () => {
    await first.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await first.query(
      `SELECT id FROM "${schema}"."perf_cycles" WHERE id = 19 FOR UPDATE`,
    );
    await first.query(
      `UPDATE "${schema}"."perf_cycles" SET status = 'ARCHIVED' WHERE id = 19 AND status = 'ACTIVE'`,
    );
    await first.query(`
      INSERT INTO "${schema}"."perf_cycle_archives" (cycle_id, operator_open_id, summary, check_result)
      VALUES (19, 'ou_admin', '{"participantCount":3,"confirmedCount":1,"noResultCount":1,"withdrawnCount":1}', '{"revision":"abc","blockers":[]}')
    `);
    await first.query('COMMIT');

    const history = await first.query(`
      SELECT cycle.status, archive.operator_open_id, archive.summary,
        array_agg(participant.status::text ORDER BY participant.id) AS participant_statuses
      FROM "${schema}"."perf_cycles" cycle
      JOIN "${schema}"."perf_cycle_archives" archive ON archive.cycle_id = cycle.id
      JOIN "${schema}"."perf_participants" participant ON participant.cycle_id = cycle.id
      WHERE cycle.id = 19
      GROUP BY cycle.status, archive.operator_open_id, archive.summary
    `);
    expect(history.rows[0]).toMatchObject({
      status: 'ARCHIVED',
      operator_open_id: 'ou_admin',
      summary: expect.objectContaining({
        participantCount: 3,
        withdrawnCount: 1,
      }),
      participant_statuses: ['CONFIRMED', 'NO_RESULT', 'WITHDRAWN'],
    });
    await expect(
      first.query(
        `UPDATE "${schema}"."perf_cycles" SET status = 'DRAFT' WHERE id = 19`,
      ),
    ).rejects.toThrow();
    await expect(
      first.query(
        `DELETE FROM "${schema}"."perf_cycle_archives" WHERE cycle_id = 19`,
      ),
    ).rejects.toThrow();
  });

  it('缺少快照的 ARCHIVED 转换在提交时整体失败', async () => {
    await first.query('BEGIN');
    await first.query(
      `UPDATE "${schema}"."perf_cycles" SET status = 'ARCHIVED' WHERE id = 20`,
    );
    await expect(first.query('COMMIT')).rejects.toThrow();
    await first.query('ROLLBACK');
    const cycle = await first.query(
      `SELECT status FROM "${schema}"."perf_cycles" WHERE id = 20`,
    );
    expect(cycle.rows[0].status).toBe('ACTIVE');
  });

  it('周期行锁串行化并发归档，第二个事务不能同时转换', async () => {
    const holder = await first.connect();
    const contender = await second.connect();
    await holder.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await holder.query(
      `SELECT id FROM "${schema}"."perf_cycles" WHERE id = 21 FOR UPDATE`,
    );
    await contender.query('BEGIN');
    await contender.query(`SET LOCAL lock_timeout = '150ms'`);
    await expect(
      contender.query(
        `SELECT id FROM "${schema}"."perf_cycles" WHERE id = 21 FOR UPDATE`,
      ),
    ).rejects.toThrow();
    await contender.query('ROLLBACK');
    await holder.query('ROLLBACK');
    contender.release();
    holder.release();
  });
});
