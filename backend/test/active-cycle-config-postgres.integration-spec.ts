import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { loadAppConfig } from '../src/config/configuration';

/** Ticket 16 的 PostgreSQL 边界：ACTIVE 追加版本、归档来源延续和不可原地覆盖。 */
describe('Ticket 16 PostgreSQL 活动周期配置版本约束', () => {
  jest.setTimeout(15_000);

  const schema = `ticket16_it_${process.pid}_${Date.now()}`;
  const pool = new Pool({ connectionString: loadAppConfig().database.url });
  let schemaCreated = false;

  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    await pool.query(
      `CREATE TYPE "${schema}"."PerfCycleStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'ARCHIVED')`,
    );
    await pool.query(
      `CREATE TYPE "${schema}"."PerfConfigTemplateVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED')`,
    );
    await pool.query(`
      CREATE TABLE "${schema}"."perf_config_template_versions" (
        "id" INTEGER PRIMARY KEY,
        "status" "${schema}"."PerfConfigTemplateVersionStatus" NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE "${schema}"."perf_cycles" (
        "id" INTEGER PRIMARY KEY,
        "status" "${schema}"."PerfCycleStatus" NOT NULL,
        "current_config_version_id" INTEGER
      )
    `);
    await pool.query(`
      CREATE TABLE "${schema}"."perf_cycle_config_versions" (
        "id" SERIAL PRIMARY KEY,
        "cycle_id" INTEGER NOT NULL,
        "version" INTEGER NOT NULL,
        "source_config_template_version_id" INTEGER,
        "created_by_open_id" TEXT NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE ("cycle_id", "version")
      )
    `);
    await pool.query(
      `INSERT INTO "${schema}"."perf_config_template_versions" VALUES (11, 'ARCHIVED'), (12, 'PUBLISHED')`,
    );
    await pool.query(
      `INSERT INTO "${schema}"."perf_cycles" VALUES (8, 'ACTIVE', NULL)`,
    );
    await pool.query(`
      INSERT INTO "${schema}"."perf_cycle_config_versions"
        ("cycle_id", "version", "source_config_template_version_id", "created_by_open_id")
      VALUES (8, 2, 11, 'ou_hr')
    `);
    await pool.query(
      `UPDATE "${schema}"."perf_cycles" SET "current_config_version_id" = 1 WHERE "id" = 8`,
    );

    const migration = readFileSync(
      join(
        process.cwd(),
        'prisma/migrations/20260716070000_allow_active_cycle_config_version_clone/migration.sql',
      ),
      'utf8',
    ).replaceAll('"performance"', `"${schema}"`);
    await pool.query(migration);
    await pool.query(`
      CREATE TRIGGER "perf_cycle_config_versions_guard_mutation"
      BEFORE INSERT OR UPDATE OR DELETE ON "${schema}"."perf_cycle_config_versions"
      FOR EACH ROW EXECUTE FUNCTION "${schema}"."guard_cycle_config_version_mutation"()
    `);
  });

  afterAll(async () => {
    if (schemaCreated) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  });

  it('允许沿用已归档来源追加 current+1，但拒绝跳号、换来源和原地修改', async () => {
    await expect(
      pool.query(`
        INSERT INTO "${schema}"."perf_cycle_config_versions"
          ("cycle_id", "version", "source_config_template_version_id", "created_by_open_id")
        VALUES (8, 3, 11, 'ou_hr')
      `),
    ).resolves.toMatchObject({ rowCount: 1 });

    await expect(
      pool.query(`
        INSERT INTO "${schema}"."perf_cycle_config_versions"
          ("cycle_id", "version", "source_config_template_version_id", "created_by_open_id")
        VALUES (8, 4, 11, 'ou_hr')
      `),
    ).rejects.toThrow('must extend the current version');
    await expect(
      pool.query(`
        INSERT INTO "${schema}"."perf_cycle_config_versions"
          ("cycle_id", "version", "source_config_template_version_id", "created_by_open_id")
        VALUES (8, 3, 12, 'ou_hr')
      `),
    ).rejects.toThrow('must extend the current version');
    await expect(
      pool.query(
        `UPDATE "${schema}"."perf_cycle_config_versions" SET "created_by_open_id" = 'ou_other' WHERE "id" = 1`,
      ),
    ).rejects.toThrow('cannot be modified in place');
  });
});
