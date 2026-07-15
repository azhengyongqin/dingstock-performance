import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const schema = readFileSync(new URL('./schema.prisma', import.meta.url), 'utf8')
const migration = readFileSync(
  new URL('./migrations/20260716170000_contract_legacy_performance_model/migration.sql', import.meta.url),
  'utf8'
)

test('Ticket 21 收缩后 Prisma schema 不再暴露旧模板、旧答卷与 JSON 维度模型', () => {
  for (const legacyDeclaration of [
    'model PerfTemplate ',
    'model PerfTemplateDimension ',
    'model PerfEvaluationRule ',
    'model PerfDimension ',
    'model PerfSelfReview ',
    'model PerfReview ',
    'model PerfManagerReview ',
    'model PerfResult ',
    'enum PerfSelfReviewStatus ',
    'enum PerfDimensionType ',
    'enum PerfScoringMethod '
  ]) {
    assert.doesNotMatch(schema, new RegExp(legacyDeclaration))
  }
  assert.doesNotMatch(schema, /\btemplateId\s+Int\?/)
  assert.doesNotMatch(schema, /\bwindows\s+Json\?/)
  assert.doesNotMatch(schema, /\bdimensionScores\s+Json\?/)
})

test('收缩 migration 先验证全量 readiness 与新模型绑定，再删除旧表和枚举', () => {
  assert.match(migration, /PERFORMANCE_CUTOVER_NOT_READY/)
  assert.match(migration, /IF cycle_count > 0 AND \(/)
  assert.match(migration, /ORDER BY "id" DESC/)
  assert.match(migration, /PERFORMANCE_CUTOVER_CYCLE_WITHOUT_CONFIG/)
  assert.match(migration, /perf_legacy_migration_runs/)
  assert.match(migration, /DROP TABLE "performance"\."perf_results"/)
  assert.match(migration, /DROP TABLE "performance"\."perf_manager_reviews"/)
  assert.match(migration, /DROP TYPE "performance"\."PerfSelfReviewStatus"/)
})
