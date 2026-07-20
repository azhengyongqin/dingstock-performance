import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const schema = readFileSync(new URL('./schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL(
    './migrations/20260714223000_add_cycle_configuration_snapshots/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

test('周期 schema 使用四态生命周期并保存独立配置与表单快照', () => {
  assert.match(
    schema,
    /enum PerfCycleStatus\s*{\s*DRAFT[^}]*SCHEDULED[^}]*ACTIVE[^}]*ARCHIVED[^}]*}/s,
  );
  assert.doesNotMatch(
    schema,
    /enum PerfCycleStatus\s*{[^}]*(PENDING|SELF_REVIEW|REVIEWING|AI_ANALYZING|CALIBRATING|CONFIRMING)/s,
  );
  // 最终契约只保留单一计划启动锚点；历史起止日期已由后续迁移删除。
  assert.doesNotMatch(schema, /\bstartDate\b/);
  assert.doesNotMatch(schema, /\bendDate\b/);
  assert.match(schema, /plannedStartAt\s+DateTime\?/);
  assert.match(schema, /currentConfigVersionId\s+Int\?\s+@unique/);
  assert.match(schema, /model PerfCycleConfigVersion\s*{/);
  assert.match(schema, /model PerfCycleFormSnapshot\s*{/);
  assert.match(schema, /jobLevelPrefixSnapshot\s+PerfJobLevelPrefix\?/);
  assert.match(schema, /formSnapshotId\s+Int\?/);
});

test('迁移保留旧周期并把细粒度状态收敛为四态', () => {
  assert.match(migration, /WHEN 'PENDING' THEN 'DRAFT'/);
  for (const legacyActiveStatus of [
    'SELF_REVIEW',
    'REVIEWING',
    'AI_ANALYZING',
    'CALIBRATING',
    'CONFIRMING',
  ]) {
    assert.match(
      migration,
      new RegExp(`WHEN '${legacyActiveStatus}' THEN 'ACTIVE'`),
    );
  }
  assert.match(migration, /ALTER COLUMN "start_date" DROP NOT NULL/);
  assert.match(migration, /ALTER COLUMN "end_date" DROP NOT NULL/);
});

test('归档表单仍可通过已发布配置的精确绑定复制到周期', () => {
  assert.match(migration, /perf_config_form_bindings/);
  assert.match(
    migration,
    /source_config_template_version_id" = binding\."config_version_id/,
  );
  assert.doesNotMatch(
    migration,
    /form_source\."status" = 'PUBLISHED'/,
  );
});

test('数据库约束保证当前版本和参与人表单绑定属于同一周期及职级前缀', () => {
  assert.match(migration, /guard_cycle_current_config_version/);
  assert.match(migration, /guard_participant_form_snapshot_binding/);
  assert.match(migration, /assert_cycle_schedule_ready/);
  assert.match(
    migration,
    /perf_participants_form_snapshot_pair_check/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "perf_cycle_form_snapshots_cycle_config_version_id_job_level_key"\s+ON [^\n]+\("cycle_config_version_id", "job_level_prefix"\)/,
  );
});
