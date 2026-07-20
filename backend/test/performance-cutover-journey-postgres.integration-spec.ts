import { Client } from 'pg';

const dedicatedDatabaseUrl = process.env.PERFORMANCE_CUTOVER_TEST_DATABASE_URL;
const describeWithDedicatedDatabase = dedicatedDatabaseUrl
  ? describe
  : describe.skip;

/**
 * Contract 迁移的 PostgreSQL 验收测试。
 *
 * 专用测试库必须先执行全部 Prisma migration；本测试只读系统目录，不修改库内数据。
 */
describeWithDedicatedDatabase('新版评估维度数据库契约', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: dedicatedDatabaseUrl });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
  });

  it('只保留维度、字段与两层回答表', async () => {
    const result = await client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'performance'
         AND table_name IN (
           'perf_form_fields',
           'perf_evaluation_dimension_answers',
           'perf_evaluation_field_answers',
           'perf_form_items',
           'perf_evaluation_item_results',
           'perf_legacy_migration_runs',
           'perf_legacy_migration_items'
         )
       ORDER BY table_name`,
    );

    expect(result.rows.map((row) => row.table_name)).toEqual([
      'perf_evaluation_dimension_answers',
      'perf_evaluation_field_answers',
      'perf_form_fields',
    ]);
  });

  it('旧阶段模式、约束档位与晋升运行时列已删除', async () => {
    const result = await client.query<{
      table_name: string;
      column_name: string;
    }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'performance'
         AND (
           column_name IN (
             'self_stage_mode', 'peer_stage_mode', 'manager_stage_mode',
             'ai_stage_mode', 'constraint_profiles', 'mode',
             'is_promotion_enabled', 'promotion_summary'
           )
           OR (table_name = 'perf_form_fields' AND column_name = 'required')
         )
       ORDER BY table_name, column_name`,
    );

    expect(result.rows).toEqual([]);
  });

  it('字段枚举不再接受评级或分数类型', async () => {
    const result = await client.query<{ enumlabel: string }>(
      `SELECT value.enumlabel
       FROM pg_type AS type
       JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
       JOIN pg_enum AS value ON value.enumtypid = type.oid
       WHERE namespace.nspname = 'performance'
         AND type.typname = 'PerfFormFieldType'
       ORDER BY value.enumsortorder`,
    );

    expect(result.rows.map((row) => row.enumlabel)).toEqual([
      'SHORT_TEXT',
      'LONG_TEXT',
      'MARKDOWN',
      'SINGLE_SELECT',
      'MULTI_SELECT',
      'ATTACHMENT',
      'LINK',
    ]);
  });
});
