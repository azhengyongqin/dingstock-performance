import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync(new URL('./schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('./migrations/20260720193000_contract_evaluation_dimension_model/migration.sql', import.meta.url),
  'utf8',
);

test('表单契约只保留计分/非计分维度和只读旧晋升维度', () => {
  assert.match(schema, /enum PerfFormDimensionType\s*{[\s\S]*SCORING[\s\S]*NON_SCORING[\s\S]*LEGACY_PROMOTION/);
  assert.match(schema, /model PerfFormDimension\s*{[\s\S]*type\s+PerfFormDimensionType[\s\S]*scoringMethod\s+PerfFormScoringMethod\?/);
  assert.doesNotMatch(schema, /PerfFormDimensionKind/);
});

test('字段模型只有七类非计分字段并持有稳定 key 与必填规则', () => {
  assert.match(schema, /enum PerfFormFieldType\s*{[\s\S]*SHORT_TEXT[\s\S]*LINK/);
  assert.doesNotMatch(schema, /enum PerfFormFieldType\s*{[\s\S]*\bRATING\b/);
  assert.match(schema, /model PerfFormField\s*{[\s\S]*businessKey\s+String[\s\S]*requiredRule\s+PerfFormFieldRequiredRule[\s\S]*requiredLevels\s+PerfRatingSymbol\[\]/);
  assert.match(schema, /@@map\("perf_form_fields"\)/);
  assert.doesNotMatch(schema, /model PerfFormItem\s*{/);
});

test('contract migration 删除隐藏计分行并把旧物理表收敛为字段表', () => {
  assert.match(migration, /DELETE FROM "performance"\."perf_form_items" WHERE "type" IN \('RATING', 'SCORE'\)/);
  assert.match(migration, /RENAME TO "perf_form_fields"/);
  assert.match(migration, /DROP TYPE IF EXISTS "performance"\."PerfFormItemType"/);
});
