import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client, Pool } from 'pg';
import { loadAppConfig } from '../src/config/configuration';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  PERFORMANCE_TABLES,
  resetPerformanceData,
} from '../src/scripts/reset-performance-data';
import { seedBaselineData } from '../src/scripts/seed-baseline-data';

type BaselineShape = {
  formTemplates: number;
  formVersions: number;
  humanSubforms: number;
  promotionSubforms: number;
  configTemplates: number;
  configVersions: number;
  cycles: number;
};

type BridgeConstraintState = {
  table_name: string;
  conname: string;
  contype: string;
  definition: string;
  comment: string | null;
};

/**
 * 真实运维接缝：fresh migrate deploy 后依次执行生产 reset 核心和两次 seed 核心。
 * 每次都使用独立数据库，既不读写开发库业务数据，也不通过 skip 隐藏环境问题。
 */
describe('fresh PostgreSQL 绩效数据 reset + baseline seed 验收', () => {
  jest.setTimeout(120_000);

  const baseUrl = loadAppConfig().database.url;
  const databaseName = `baseline_reset_seed_${process.pid}_${Date.now()}`;
  const tempUrlObject = new URL(baseUrl);
  tempUrlObject.pathname = `/${databaseName}`;
  tempUrlObject.searchParams.delete('schema');
  const tempUrl = tempUrlObject.toString();
  const adminPool = new Pool({ connectionString: baseUrl });

  let prisma: PrismaClient | undefined;
  let resetClient: Client | undefined;

  beforeAll(async () => {
    await adminPool.query(`CREATE DATABASE "${databaseName}"`);
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: tempUrl },
      stdio: 'pipe',
    });
    execFileSync(
      'pnpm',
      [
        'exec',
        'prisma',
        'migrate',
        'diff',
        '--exit-code',
        '--from-config-datasource',
        '--to-schema',
        'prisma/schema.prisma',
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: tempUrl },
        stdio: 'pipe',
      },
    );
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: tempUrl }),
    });
    resetClient = new Client({ connectionString: tempUrl });
    await prisma.$connect();
    await resetClient.connect();
  });

  afterAll(async () => {
    if (resetClient) await resetClient.end();
    if (prisma) await prisma.$disconnect();
    await adminPool.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1',
      [databaseName],
    );
    await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await adminPool.end();
  });

  async function readBaselineShape(): Promise<BaselineShape> {
    const result = await resetClient!.query<BaselineShape>(`
      SELECT
        (SELECT count(*)::int FROM "performance"."perf_form_templates") AS "formTemplates",
        (SELECT count(*)::int FROM "performance"."perf_form_template_versions") AS "formVersions",
        (SELECT count(*)::int FROM "performance"."perf_form_subforms"
          WHERE "type"::text IN ('SELF', 'PEER', 'MANAGER')) AS "humanSubforms",
        (SELECT count(*)::int FROM "performance"."perf_form_subforms"
          WHERE "type"::text = 'PROMOTION') AS "promotionSubforms",
        (SELECT count(*)::int FROM "performance"."perf_config_templates") AS "configTemplates",
        (SELECT count(*)::int FROM "performance"."perf_config_template_versions") AS "configVersions",
        (SELECT count(*)::int FROM "performance"."perf_cycles") AS "cycles"
    `);
    return result.rows[0];
  }

  async function readBridgeConstraintState() {
    const result = await resetClient!.query<BridgeConstraintState>(`
      SELECT relation.relname AS table_name,
             constraint_row.conname,
             constraint_row.contype,
             pg_get_constraintdef(constraint_row.oid) AS definition,
             obj_description(constraint_row.oid, 'pg_constraint') AS comment
      FROM pg_constraint AS constraint_row
      JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'performance'
        AND constraint_row.conname IN (
          'perf_appeals_invalidated_by_rollback_id_fkey',
          'perf_appeals_resolution_calibration_id_participant_id_fkey',
          'perf_appeals_result_version_id_participant_id_fkey',
          'perf_calibrations_invalidated_by_rollback_id_fkey',
          'perf_result_versions_invalidated_by_rollback_id_fkey'
        )
      ORDER BY relation.relname, constraint_row.conname
    `);
    return result.rows;
  }

  async function expectProtectedSentinels() {
    await expect(
      prisma!.larkUser.findUnique({
        where: { open_id: 'ou_reset_seed_sentinel' },
        select: { open_id: true, name: true, department_ids: true },
      }),
    ).resolves.toEqual({
      open_id: 'ou_reset_seed_sentinel',
      name: '受保护用户',
      department_ids: ['od_protected'],
    });
    await expect(
      prisma!.roleGrant.findFirst({
        where: { userOpenId: 'ou_reset_seed_sentinel', role: 'ADMIN' },
        select: { userOpenId: true, role: true, orgScope: true },
      }),
    ).resolves.toEqual({
      userOpenId: 'ou_reset_seed_sentinel',
      role: 'ADMIN',
      orgScope: ['od_protected'],
    });
    await expect(
      prisma!.systemConfig.findUnique({
        where: { key: 'test.reset-seed.protected-sentinel' },
        select: { key: true, value: true, description: true },
      }),
    ).resolves.toEqual({
      key: 'test.reset-seed.protected-sentinel',
      value: { keep: true, marker: 'protected-content' },
      description: '保护内容不可被重置或基线脚本改写',
    });
  }

  it('精确重置绩效数据、保留哨兵，并幂等重建新版基线', async () => {
    const incompleteMigrations = await resetClient!.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM "public"."_prisma_migrations"
      WHERE "finished_at" IS NULL OR "rolled_back_at" IS NOT NULL
    `);
    expect(incompleteMigrations.rows[0].count).toBe(0);

    const bridgeMigrationPaths = [
      '20260716011000_prepare_misordered_constraint_rename',
      '20260716020000_cleanup_misordered_constraint_rename_bridge',
      '20260720204000_normalize_misordered_constraint_names',
    ].map((migration) =>
      join(process.cwd(), 'prisma', 'migrations', migration, 'migration.sql'),
    );
    const matureStateBefore = await readBridgeConstraintState();
    expect(matureStateBefore).toHaveLength(5);
    for (const path of bridgeMigrationPaths) {
      await resetClient!.query(readFileSync(path, 'utf8'));
    }
    expect(await readBridgeConstraintState()).toEqual(matureStateBefore);
    const sentinelState = await resetClient!.query<{
      marker_columns: number;
      sentinel_comments: number;
    }>(`
      SELECT
        (SELECT count(*)::int FROM information_schema.columns
          WHERE table_schema = 'performance'
            AND table_name = 'perf_result_versions'
            AND column_name = '__fresh_migrate_bridge') AS marker_columns,
        (SELECT count(*)::int FROM pg_constraint
          WHERE obj_description(oid, 'pg_constraint') =
            'fresh-migrate-bridge:20260716011825') AS sentinel_comments
    `);
    expect(sentinelState.rows[0]).toEqual({
      marker_columns: 0,
      sentinel_comments: 0,
    });

    // 源名和目标名同时存在属于不可猜测的混合态，bridge 必须拒绝而不是删改真实外键。
    await resetClient!.query(`
      ALTER TABLE "performance"."perf_appeals"
        ADD CONSTRAINT "perf_appeals_invalidation_rollback_fkey"
        FOREIGN KEY ("invalidated_by_rollback_id")
        REFERENCES "performance"."perf_cycle_rollbacks"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    try {
      await expect(
        resetClient!.query(readFileSync(bridgeMigrationPaths[0], 'utf8')),
      ).rejects.toThrow(/both source and target constraints exist/);
    } finally {
      await resetClient!.query(`
        ALTER TABLE "performance"."perf_appeals"
          DROP CONSTRAINT "perf_appeals_invalidation_rollback_fkey"
      `);
    }
    expect(await readBridgeConstraintState()).toEqual(matureStateBefore);

    await prisma!.larkUser.create({
      data: {
        open_id: 'ou_reset_seed_sentinel',
        name: '受保护用户',
        department_ids: ['od_protected'],
      },
    });
    await prisma!.roleGrant.create({
      data: {
        userOpenId: 'ou_reset_seed_sentinel',
        role: 'ADMIN',
        orgScope: ['od_protected'],
      },
    });
    await prisma!.systemConfig.create({
      data: {
        key: 'test.reset-seed.protected-sentinel',
        value: { keep: true, marker: 'protected-content' },
        description: '保护内容不可被重置或基线脚本改写',
      },
    });

    // 先构造真实当前基线，确保 reset 验收不是对空表的假阳性。
    await seedBaselineData(prisma!);
    const baselineCycle = await prisma!.perfCycle.findFirstOrThrow({
      where: { name: '2026年中绩效评定' },
      select: { id: true },
    });
    await prisma!.reportExportTask.create({
      data: {
        cycleId: baselineCycle.id,
        type: 'reset-seed-acceptance',
        operatorOpenId: 'ou_reset_seed_sentinel',
      },
    });
    await prisma!.auditLog.createMany({
      data: [
        {
          operatorOpenId: 'ou_reset_seed_sentinel',
          action: 'cycle.test',
          targetType: 'perf_cycle',
          targetId: String(baselineCycle.id),
        },
        {
          operatorOpenId: 'ou_reset_seed_sentinel',
          action: 'lark.test',
          targetType: 'lark_user',
          targetId: 'ou_reset_seed_sentinel',
        },
      ],
    });

    const resetResult = await resetPerformanceData(resetClient!);
    expect(resetResult.removedAuditLogs).toBe(1);
    for (const table of PERFORMANCE_TABLES) {
      const count = await resetClient!.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM "performance"."${table}"`,
      );
      expect(count.rows[0].count).toBe(0);
    }
    await expect(prisma!.reportExportTask.count()).resolves.toBe(0);
    await expect(
      prisma!.auditLog.findMany({ select: { targetType: true } }),
    ).resolves.toEqual([{ targetType: 'lark_user' }]);
    await expectProtectedSentinels();

    await seedBaselineData(prisma!);
    const firstSeedShape = await readBaselineShape();
    expect(firstSeedShape).toEqual({
      formTemplates: 2,
      formVersions: 2,
      humanSubforms: 6,
      promotionSubforms: 0,
      configTemplates: 1,
      configVersions: 1,
      cycles: 1,
    });

    await seedBaselineData(prisma!);
    await expect(readBaselineShape()).resolves.toEqual(firstSeedShape);
    await expectProtectedSentinels();
  });
});
