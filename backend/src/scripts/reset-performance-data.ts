/**
 * 精确重置开发期绩效业务数据。
 *
 * 安全边界：只允许清理本文件列出的 perf_* 表、绩效导出任务和绩效目标审计日志；
 * lark_*、role_grants、system_configs 会在事务前后核对行数，任何变化都会回滚。
 */
import { Client } from 'pg';
import { loadAppConfig } from '../config/configuration';

const PERFORMANCE_TABLES = [
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

const PERFORMANCE_AUDIT_TARGETS = [
  'perf_appeal',
  'perf_config_template_version',
  'perf_cycle',
  'perf_form_template_version',
  'perf_participant',
  'perf_result_version',
  'perf_reviewer_assignment',
] as const;

type CountRow = { table_name: string; row_count: string };

const quotedPerformanceTables = PERFORMANCE_TABLES.map(
  (table) => `"performance"."${table}"`,
).join(', ');

async function readCounts(client: Client, tables: readonly string[]) {
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

async function main() {
  const client = new Client({ connectionString: loadAppConfig().database.url });
  await client.connect();

  try {
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
      console.log(
        JSON.stringify(
          {
            performanceBefore,
            removedAuditLogs: removedAudits.rowCount,
            preservedBefore,
            preservedAfter,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    await client.end();
  }
}

void main();
