import { Pool } from 'pg';
import { loadAppConfig } from '../src/config/configuration';

/** Ticket 17 PostgreSQL seam：验证整体退回核心写集合的事务原子性与周期行锁并发边界。 */
describe('Ticket 17 PostgreSQL 周期整体退回集成', () => {
  jest.setTimeout(15_000);

  const schema = `ticket17_it_${process.pid}_${Date.now()}`;
  const connectionString = loadAppConfig().database.url;
  const first = new Pool({ connectionString });
  const second = new Pool({ connectionString });
  let schemaCreated = false;

  beforeAll(async () => {
    await first.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    await first.query(`
      CREATE TYPE "${schema}"."cycle_status" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE');
      CREATE TABLE "${schema}"."cycles" (
        id INTEGER PRIMARY KEY,
        status "${schema}"."cycle_status" NOT NULL
      );
      CREATE TABLE "${schema}"."participants" (
        id INTEGER PRIMARY KEY,
        cycle_id INTEGER NOT NULL REFERENCES "${schema}"."cycles"(id),
        status TEXT NOT NULL,
        evaluation_locked_at TIMESTAMP(3)
      );
      CREATE TABLE "${schema}"."rollbacks" (
        id SERIAL PRIMARY KEY,
        cycle_id INTEGER NOT NULL REFERENCES "${schema}"."cycles"(id),
        target_status "${schema}"."cycle_status" NOT NULL,
        reason TEXT NOT NULL,
        impact_summary JSONB NOT NULL,
        operator_open_id TEXT NOT NULL
      );
      CREATE TABLE "${schema}"."calibrations" (
        id SERIAL PRIMARY KEY,
        participant_id INTEGER NOT NULL REFERENCES "${schema}"."participants"(id),
        invalidated_at TIMESTAMP(3),
        invalidated_by_rollback_id INTEGER REFERENCES "${schema}"."rollbacks"(id)
      );
      CREATE TABLE "${schema}"."result_versions" (
        id SERIAL PRIMARY KEY,
        participant_id INTEGER NOT NULL REFERENCES "${schema}"."participants"(id),
        confirmed_at TIMESTAMP(3),
        invalidated_at TIMESTAMP(3),
        invalidated_by_rollback_id INTEGER REFERENCES "${schema}"."rollbacks"(id)
      );
      CREATE TABLE "${schema}"."appeals" (
        id SERIAL PRIMARY KEY,
        participant_id INTEGER NOT NULL REFERENCES "${schema}"."participants"(id),
        invalidated_at TIMESTAMP(3),
        invalidated_by_rollback_id INTEGER REFERENCES "${schema}"."rollbacks"(id)
      );
      CREATE TABLE "${schema}"."notification_events" (
        id SERIAL PRIMARY KEY,
        dedupe_key TEXT NOT NULL UNIQUE,
        rollback_id INTEGER NOT NULL REFERENCES "${schema}"."rollbacks"(id),
        receiver_open_id TEXT NOT NULL
      );
      CREATE TABLE "${schema}"."audit_logs" (
        id SERIAL PRIMARY KEY,
        rollback_id INTEGER NOT NULL REFERENCES "${schema}"."rollbacks"(id),
        operator_open_id TEXT NOT NULL
      );
      INSERT INTO "${schema}"."cycles" (id, status) VALUES (17, 'ACTIVE'), (18, 'ACTIVE');
      INSERT INTO "${schema}"."participants" (id, cycle_id, status, evaluation_locked_at)
      VALUES
        (101, 17, 'CALIBRATED', NOW()),
        (102, 17, 'RESULT_PUBLISHED', NOW()),
        (103, 17, 'APPEALING', NOW()),
        (104, 17, 'RE_CONFIRMING', NOW()),
        (105, 17, 'CONFIRMED', NOW()),
        (106, 17, 'REVIEWED', NULL),
        (201, 18, 'CONFIRMED', NOW());
      INSERT INTO "${schema}"."calibrations" (participant_id)
        SELECT id FROM "${schema}"."participants" WHERE cycle_id IN (17, 18) AND evaluation_locked_at IS NOT NULL;
      INSERT INTO "${schema}"."result_versions" (participant_id, confirmed_at)
        VALUES (102, NULL), (103, NULL), (104, NULL), (105, NOW()), (201, NOW());
      INSERT INTO "${schema}"."appeals" (participant_id) VALUES (103), (104), (201);
    `);
  });

  afterAll(async () => {
    if (schemaCreated) await first.query(`DROP SCHEMA "${schema}" CASCADE`);
    await Promise.all([first.end(), second.end()]);
  });

  it('失效、解锁、状态、审计与精准通知在同一事务提交，重复通知键被数据库拒绝', async () => {
    await first.query('BEGIN');
    await first.query(
      `SELECT id FROM "${schema}"."cycles" WHERE id = 17 FOR UPDATE`,
    );
    const rollback = await first.query<{ id: number }>(`
      INSERT INTO "${schema}"."rollbacks"
        (cycle_id, target_status, reason, impact_summary, operator_open_id)
      VALUES (17, 'DRAFT', '配置严重错误', '{"participantCount":6}', 'ou_admin')
      RETURNING id
    `);
    const rollbackId = rollback.rows[0].id;
    for (const table of ['calibrations', 'result_versions', 'appeals']) {
      await first.query(
        `
        UPDATE "${schema}"."${table}" AS item
        SET invalidated_at = NOW(), invalidated_by_rollback_id = $1
        FROM "${schema}"."participants" AS participant
        WHERE item.participant_id = participant.id AND participant.cycle_id = 17
      `,
        [rollbackId],
      );
    }
    await first.query(`
      UPDATE "${schema}"."participants"
      SET evaluation_locked_at = NULL,
          status = CASE WHEN status = 'REVIEWED' THEN status ELSE 'REVIEWED' END
      WHERE cycle_id = 17
    `);
    await first.query(
      `UPDATE "${schema}"."cycles" SET status = 'DRAFT' WHERE id = 17`,
    );
    await first.query(
      `
      INSERT INTO "${schema}"."notification_events" (dedupe_key, rollback_id, receiver_open_id)
      SELECT 'result-invalidated:' || $1::integer || ':' || participant.id, $1::integer, participant.id::text
      FROM "${schema}"."participants" AS participant
      WHERE participant.id IN (102, 103, 104, 105)
    `,
      [rollbackId],
    );
    await first.query(
      `INSERT INTO "${schema}"."audit_logs" (rollback_id, operator_open_id) VALUES ($1, 'ou_admin')`,
      [rollbackId],
    );
    await first.query('COMMIT');

    const state = await first.query<{
      status: string;
      locked: string;
      invalid_calibrations: string;
      invalid_results: string;
      invalid_appeals: string;
      notifications: string;
      audits: string;
    }>(
      `
      SELECT cycle.status,
        (SELECT COUNT(*) FROM "${schema}"."participants" WHERE cycle_id = 17 AND evaluation_locked_at IS NOT NULL) AS locked,
        (SELECT COUNT(*) FROM "${schema}"."calibrations" WHERE invalidated_by_rollback_id = $1) AS invalid_calibrations,
        (SELECT COUNT(*) FROM "${schema}"."result_versions" WHERE invalidated_by_rollback_id = $1) AS invalid_results,
        (SELECT COUNT(*) FROM "${schema}"."appeals" WHERE invalidated_by_rollback_id = $1) AS invalid_appeals,
        (SELECT COUNT(*) FROM "${schema}"."notification_events" WHERE rollback_id = $1) AS notifications,
        (SELECT COUNT(*) FROM "${schema}"."audit_logs" WHERE rollback_id = $1) AS audits
      FROM "${schema}"."cycles" AS cycle WHERE cycle.id = 17
    `,
      [rollbackId],
    );
    expect(state.rows[0]).toMatchObject({
      status: 'DRAFT',
      locked: '0',
      invalid_calibrations: '5',
      invalid_results: '4',
      invalid_appeals: '2',
      notifications: '4',
      audits: '1',
    });
    await expect(
      first.query(
        `
      INSERT INTO "${schema}"."notification_events" (dedupe_key, rollback_id, receiver_open_id)
      VALUES ('result-invalidated:${rollbackId}:102', $1, '102')
    `,
        [rollbackId],
      ),
    ).rejects.toThrow();
  });

  it('事务回滚不会留下部分失效；周期行锁会阻止并发第二次退回', async () => {
    const holder = await first.connect();
    const contender = await second.connect();
    await holder.query('BEGIN');
    await holder.query(
      `SELECT id FROM "${schema}"."cycles" WHERE id = 18 FOR UPDATE`,
    );
    await contender.query('BEGIN');
    await contender.query(`SET LOCAL lock_timeout = '150ms'`);
    await expect(
      contender.query(
        `SELECT id FROM "${schema}"."cycles" WHERE id = 18 FOR UPDATE`,
      ),
    ).rejects.toThrow();
    await contender.query('ROLLBACK');
    await holder.query('ROLLBACK');
    contender.release();
    holder.release();

    const state = await first.query(`
      SELECT status,
        (SELECT COUNT(*) FROM "${schema}"."rollbacks" WHERE cycle_id = 18) AS rollbacks,
        (SELECT COUNT(*) FROM "${schema}"."calibrations" WHERE participant_id = 201 AND invalidated_at IS NOT NULL) AS invalid_calibrations
      FROM "${schema}"."cycles" WHERE id = 18
    `);
    expect(state.rows[0]).toMatchObject({
      status: 'ACTIVE',
      rollbacks: '0',
      invalid_calibrations: '0',
    });
  });
});
