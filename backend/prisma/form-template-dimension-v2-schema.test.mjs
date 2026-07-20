import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync(
  new URL('./schema.prisma', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL(
    './migrations/20260720143000_expand_dimension_scoring_and_form_fields/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const draftMigration = readFileSync(
  new URL(
    './migrations/20260720150000_allow_incomplete_form_template_drafts/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

test('计分方式与稳定业务 key 直接归属评估维度', () => {
  assert.match(
    schema,
    /enum PerfFormScoringMethod\s*{[\s\S]*RATING[\s\S]*SCORE/,
  );
  assert.match(
    schema,
    /model PerfFormDimension\s*{[\s\S]*businessKey\s+String[\s\S]*scoringMethod\s+PerfFormScoringMethod\?/,
  );
  assert.match(schema, /@@unique\(\[subformId, businessKey\]\)/);
  assert.match(
    draftMigration,
    /DROP CONSTRAINT IF EXISTS "perf_form_dimensions_scoring_method_check"/,
  );
});

test('表单字段持有稳定 key、必填规则和条件等级', () => {
  assert.match(
    schema,
    /enum PerfFormFieldRequiredRule\s*{[\s\S]*OPTIONAL[\s\S]*ALWAYS[\s\S]*CONDITIONAL/,
  );
  assert.match(
    schema,
    /model PerfFormItem\s*{[\s\S]*businessKey\s+String[\s\S]*requiredRule\s+PerfFormFieldRequiredRule[\s\S]*requiredLevels\s+PerfRatingSymbol\[\]/,
  );
  assert.match(
    draftMigration,
    /DROP CONSTRAINT IF EXISTS "perf_form_items_required_levels_check"/,
  );
});

test('草稿可以暂时不完整，计分与条件必填完整性在发布时校验', () => {
  assert.match(schema, /scoringMethod\s+PerfFormScoringMethod\?/);
  assert.match(schema, /requiredLevels\s+PerfRatingSymbol\[\]/);
  assert.match(draftMigration, /草稿允许暂时缺少计分方式或条件必填等级/);
});

test('迁移为已有开发数据生成一次性 key，后续版本由应用层显式继承', () => {
  assert.match(
    migration,
    /UPDATE "performance"\."perf_form_dimensions"[\s\S]*gen_random_uuid\(\)::text/,
  );
  assert.match(
    migration,
    /UPDATE "performance"\."perf_form_items"[\s\S]*gen_random_uuid\(\)::text/,
  );
  assert.match(migration, /perf_form_dimensions_subform_id_business_key_key/);
});
