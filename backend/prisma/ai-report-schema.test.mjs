import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const schema = readFileSync(new URL('./schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL(
    './migrations/20260715213000_adapt_ai_report_async_reference/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

test('AI 报告保存直接参考等级、输入快照和领取修订', () => {
  assert.match(schema, /referenceLevel\s+PerfRatingSymbol\?/);
  assert.match(schema, /inputSnapshot\s+Json\?/);
  assert.match(schema, /inputRevision\s+String\?/);
  assert.match(schema, /processingRevision\s+String\?/);
  assert.match(schema, /attemptCount\s+Int\s+@default\(0\)/);
});

test('AI 异步任务按状态与可领取时间建立队列索引', () => {
  assert.match(schema, /@@index\(\[status, availableAt\]\)/);
  assert.match(
    migration,
    /CREATE INDEX "perf_ai_reports_status_available_at_idx"[\s\S]*\("status", "available_at"\)/,
  );
  assert.match(migration, /perf_ai_reports_attempt_count_check/);
  assert.match(
    migration,
    /perf_ai_reports_processing_revision_check[\s\S]*"processing_revision" = "input_revision"/,
  );
});

test('AI 输入更新在原 1:1 报告上重排，不新增人工阶段提交或阶段权重表', () => {
  assert.match(schema, /participantId\s+Int\s+@unique/);
  assert.match(
    schema,
    /AI 独立异步参考报告；不进入参与者状态机，也不参与人工阶段跨阶段加权/,
  );
  assert.doesNotMatch(migration, /perf_stage_results/);
  assert.doesNotMatch(migration, /perf_evaluation_submissions/);
});
