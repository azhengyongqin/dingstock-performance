import {
  PERFORMANCE_AUDIT_TARGETS,
  PERFORMANCE_TABLES,
  resetPerformanceData,
  type ResetPerformanceQueryClient,
} from './reset-performance-data';

class ControlledClient implements ResetPerformanceQueryClient {
  readonly writes: string[] = [];
  readonly commands: string[] = [];

  constructor(
    private readonly actualPerfTables = [...PERFORMANCE_TABLES],
    private readonly preservedBefore = new Map([
      ['lark_users', '2'],
      ['role_grants', '1'],
      ['system_configs', '1'],
    ]),
    private readonly preservedAfter = preservedBefore,
  ) {}

  // 测试替身按 SQL 同步分支返回；接口仍保持与 pg Client 相同的 Promise 契约。
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    const normalized = text.replace(/\s+/g, ' ').trim();
    this.commands.push(normalized);
    if (/^(ALTER|DELETE|TRUNCATE|BEGIN|COMMIT|ROLLBACK)/.test(normalized)) {
      this.writes.push(normalized);
    }
    if (normalized.includes("table_name LIKE 'perf\\_%'")) {
      return Promise.resolve(
        this.result(
          [...this.actualPerfTables]
            .sort()
            .map((table_name) => ({ table_name })),
        ),
      );
    }
    if (normalized.includes("table_name LIKE 'lark\\_%'")) {
      return Promise.resolve(
        this.result(
          [...this.preservedBefore.keys()]
            .sort()
            .map((table_name) => ({ table_name })),
        ),
      );
    }
    const count = normalized.match(/COUNT\(\*\).*"performance"\."([^"]+)"/);
    if (count) {
      const table = count[1];
      const afterTransaction = this.commands.includes('BEGIN');
      const source = afterTransaction
        ? this.preservedAfter
        : this.preservedBefore;
      return Promise.resolve(
        this.result([{ row_count: source.get(table) ?? '3' }]),
      );
    }
    if (normalized.startsWith('DELETE FROM "performance"."audit_logs"')) {
      expect(values).toEqual([[...PERFORMANCE_AUDIT_TARGETS]]);
      return Promise.resolve({ rows: [], rowCount: 2 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  }

  private result<T extends Record<string, unknown>>(rows: T[]) {
    return { rows, rowCount: rows.length };
  }
}

describe('绩效数据重置公开脚本接缝', () => {
  it('数据库 perf_* 表与固定白名单不一致时拒绝且没有任何写操作', async () => {
    const client = new ControlledClient([
      ...PERFORMANCE_TABLES,
      'perf_unreviewed_new_table',
    ]);

    await expect(resetPerformanceData(client)).rejects.toThrow(
      '绩效表白名单与数据库不一致',
    );
    expect(client.writes).toEqual([]);
  });

  it('事务内受保护表计数变化时回滚', async () => {
    const client = new ControlledClient(
      [...PERFORMANCE_TABLES],
      new Map([
        ['lark_users', '2'],
        ['role_grants', '1'],
        ['system_configs', '1'],
      ]),
      new Map([
        ['lark_users', '1'],
        ['role_grants', '1'],
        ['system_configs', '1'],
      ]),
    );

    await expect(resetPerformanceData(client)).rejects.toThrow(
      '受保护表行数发生变化',
    );
    expect(client.writes.at(-1)).toBe('ROLLBACK');
    expect(client.writes).not.toContain('COMMIT');
  });

  it('只清理固定绩效审计、导出任务和全部白名单 perf_* 表', async () => {
    const client = new ControlledClient();

    const result = await resetPerformanceData(client);

    expect(result.removedAuditLogs).toBe(2);
    expect(client.writes).toContain('BEGIN');
    expect(client.writes).toContain('COMMIT');
    const truncate = client.writes.find((command) =>
      command.startsWith('TRUNCATE TABLE'),
    );
    expect(truncate).toContain('"performance"."report_export_tasks"');
    for (const table of PERFORMANCE_TABLES) {
      expect(truncate).toContain(`"performance"."${table}"`);
    }
    expect(truncate).not.toMatch(/lark_|role_grants|system_configs/);
  });
});
