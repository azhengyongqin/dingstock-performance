/**
 * 精确重置开发期绩效业务数据。
 *
 * 安全边界：只允许清理本文件列出的 perf_* 表、绩效导出任务和绩效目标审计日志；
 * lark_*、role_grants、system_configs 会在事务前后核对行数，任何变化都会回滚。
 */
import { Client } from 'pg';
import { loadAppConfig } from '../config/configuration';

export const RESET_PERFORMANCE_CONFIRMATION_ENV =
  'RESET_PERFORMANCE_DATA_CONFIRM';
export const RESET_PERFORMANCE_CONFIRMATION = 'DELETE_LOCAL_PERFORMANCE_DATA';

export const PERFORMANCE_TABLES = [
  'perf_ai_reports',
  'perf_appeals',
  'perf_calibrations',
  'perf_config_form_bindings',
  'perf_config_template_versions',
  'perf_config_templates',
  'perf_cycle_archives',
  'perf_cycle_config_versions',
  'perf_cycle_form_snapshots',
  'perf_cycle_rollbacks',
  'perf_cycles',
  'perf_evaluation_dimension_answers',
  'perf_evaluation_field_answers',
  'perf_evaluation_submissions',
  'perf_evaluation_tasks',
  'perf_form_dimensions',
  'perf_form_fields',
  'perf_form_subforms',
  'perf_form_template_versions',
  'perf_form_templates',
  'perf_interviews',
  'perf_legacy_promotion_archives',
  'perf_notification_events',
  'perf_notifications',
  'perf_participants',
  'perf_peer_relation_aggregates',
  'perf_red_line_findings',
  'perf_result_versions',
  'perf_reviewer_assignments',
  'perf_stage_dimension_results',
  'perf_stage_results',
] as const;

export const PERFORMANCE_AUDIT_TARGETS = [
  'perf_appeal',
  'perf_config_template_version',
  'perf_cycle',
  'perf_form_template_version',
  'perf_participant',
  'perf_result_version',
  'perf_reviewer_assignment',
] as const;

type CountRow = { table_name: string; row_count: string };

export type ResetPerformanceQueryClient = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
};

type ResetPerformanceCommandClient = ResetPerformanceQueryClient & {
  connect(): Promise<unknown>;
  end(): Promise<void>;
};

type ResetPerformanceCommandDependencies = {
  loadDatabaseUrl(): string;
  createClient(url: string): ResetPerformanceCommandClient;
  reset(client: ResetPerformanceQueryClient): Promise<unknown>;
};

const commandDependencies: ResetPerformanceCommandDependencies = {
  loadDatabaseUrl: () => loadAppConfig().database.url,
  createClient: (url) => new Client({ connectionString: url }),
  reset: resetPerformanceData,
};

const quotedPerformanceTables = PERFORMANCE_TABLES.map(
  (table) => `"performance"."${table}"`,
).join(', ');

async function readCounts(
  client: ResetPerformanceQueryClient,
  tables: readonly string[],
) {
  const rows: CountRow[] = [];
  for (const table of tables) {
    // 表名来自本文件的固定白名单，绝不接收命令行或环境变量输入。
    const result = await client.query<{ row_count: string }>(
      `SELECT COUNT(*)::text AS row_count FROM "performance"."${table}"`,
    );
    rows.push({ table_name: table, row_count: result.rows[0].row_count });
  }
  return rows;
}

/**
 * 可测试的重置核心：调用方负责连接生命周期；任何校验失败都不会提交部分清理。
 */
export async function resetPerformanceData(
  client: ResetPerformanceQueryClient,
) {
  const actualPerfTables = await client.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'performance' AND table_name LIKE 'perf\\_%' ESCAPE '\\'
       ORDER BY table_name`,
  );
  const actual = actualPerfTables.rows.map((row) => row.table_name);
  const expected = [...PERFORMANCE_TABLES].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `绩效表白名单与数据库不一致，拒绝重置。expected=${expected.join(',')} actual=${actual.join(',')}`,
    );
  }

  const preservedTables = await client.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'performance'
         AND (table_name LIKE 'lark\\_%' ESCAPE '\\' OR table_name IN ('role_grants', 'system_configs'))
       ORDER BY table_name`,
  );
  const preservedNames = preservedTables.rows.map((row) => row.table_name);
  const preservedBefore = await readCounts(client, preservedNames);
  const performanceBefore = await readCounts(client, PERFORMANCE_TABLES);

  await client.query('BEGIN');
  try {
    // 审计表有 append-only 保护；仅在本事务内对固定绩效目标精确删除。
    await client.query(
      'ALTER TABLE "performance"."audit_logs" DISABLE TRIGGER USER',
    );
    const removedAudits = await client.query(
      `DELETE FROM "performance"."audit_logs" WHERE "target_type" = ANY($1::text[])`,
      [[...PERFORMANCE_AUDIT_TARGETS]],
    );
    await client.query(
      'ALTER TABLE "performance"."audit_logs" ENABLE TRIGGER USER',
    );

    // 导出任务通过外键引用周期，必须与全部绩效表放在同一条 TRUNCATE 中。
    await client.query(
      `TRUNCATE TABLE ${quotedPerformanceTables}, "performance"."report_export_tasks" RESTART IDENTITY`,
    );

    const preservedAfter = await readCounts(client, preservedNames);
    if (JSON.stringify(preservedBefore) !== JSON.stringify(preservedAfter)) {
      throw new Error('受保护表行数发生变化，已回滚绩效数据重置');
    }

    await client.query('COMMIT');
    return {
      performanceBefore,
      removedAuditLogs: removedAudits.rowCount,
      preservedBefore,
      preservedAfter,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/**
 * 命令入口安全门禁：生产环境永久禁用；其他环境也必须提供精确确认值。
 * resetPerformanceData 核心不读取环境变量，供隔离 PostgreSQL 验收直接调用。
 */
export async function runResetPerformanceDataCommand(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: ResetPerformanceCommandDependencies = commandDependencies,
) {
  const nodeEnv = env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv === 'production') {
    throw new Error('生产环境永久禁止执行绩效数据重置');
  }
  if (
    env[RESET_PERFORMANCE_CONFIRMATION_ENV] !== RESET_PERFORMANCE_CONFIRMATION
  ) {
    throw new Error(
      `缺少显式确认：请设置 ${RESET_PERFORMANCE_CONFIRMATION_ENV}=${RESET_PERFORMANCE_CONFIRMATION}`,
    );
  }
  if (nodeEnv !== 'development') {
    throw new Error('绩效数据重置仅允许 development 环境执行');
  }

  const client = dependencies.createClient(dependencies.loadDatabaseUrl());
  await client.connect();
  try {
    return await dependencies.reset(client);
  } finally {
    await client.end();
  }
}

async function main() {
  const result = await runResetPerformanceDataCommand();
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
