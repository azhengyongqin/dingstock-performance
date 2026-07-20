import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const schema = readFileSync(new URL('./schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL(
    './migrations/20260715170000_add_stage_results/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const contractMigration = readFileSync(
  new URL(
    './migrations/20260720193000_contract_evaluation_dimension_model/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

test('阶段结果按参与者、阶段和配置版本唯一保存', () => {
  assert.match(schema, /enum PerfStageResultStatus\s*{[\s\S]*READY[\s\S]*NO_DATA/);
  assert.match(schema, /model PerfStageResult\s*{/);
  assert.match(
    schema,
    /model PerfStageResult[\s\S]*@@unique\(\[participantId, stage, cycleConfigVersionId\]\)/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "perf_stage_results_participant_id_stage_cycle_config_versio_key"[\s\S]*\("participant_id", "stage", "cycle_config_version_id"\)/,
  );
});

test('无数据结果不能伪造零分或等级，有数据结果必须完整', () => {
  assert.match(
    migration,
    /"status" = 'NO_DATA'[\s\S]*"reviewer_count" = 0[\s\S]*"composite_score" IS NULL[\s\S]*"initial_level" IS NULL[\s\S]*"stage_level" IS NULL/,
  );
  assert.match(
    migration,
    /"status" = 'READY'[\s\S]*"reviewer_count" > 0[\s\S]*"composite_score" IS NOT NULL[\s\S]*"initial_level" IS NOT NULL[\s\S]*"stage_level" IS NOT NULL/,
  );
});

test('阶段结果锁定参与者、配置版本和周期的复合归属', () => {
  assert.match(
    migration,
    /FOREIGN KEY \("participant_id", "cycle_id"\)[\s\S]*REFERENCES "performance"\."perf_participants"\("id", "cycle_id"\)/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("cycle_config_version_id", "cycle_id"\)[\s\S]*REFERENCES "performance"\."perf_cycle_config_versions"\("id", "cycle_id"\)/,
  );
  assert.equal(
    (migration.match(/ON DELETE RESTRICT ON UPDATE CASCADE/g) ?? []).length,
    3,
  );
});

test('数据库约束分数范围和可解释 JSON 形状，并删除旧阶段模式', () => {
  assert.match(
    migration,
    /"composite_score" IS NULL OR "composite_score" BETWEEN 0 AND 100/,
  );
  assert.doesNotMatch(schema, /PerfStageResultMode/);
  assert.doesNotMatch(schema, /model PerfStageResult\s*{[\s\S]*\n\s+mode\s/);
  assert.match(contractMigration, /DROP COLUMN IF EXISTS "mode"/);
  assert.match(migration, /jsonb_typeof\("constraint_reasons"\) = 'array'/);
  assert.match(migration, /jsonb_typeof\("calculation_detail"\) = 'object'/);
});

test('维度结果和 360°关系聚合关系化保存，并随父结果重算替换', () => {
  assert.match(schema, /model PerfStageDimensionResult\s*{/);
  assert.match(schema, /model PerfPeerRelationAggregate\s*{/);
  assert.match(
    schema,
    /model PerfStageDimensionResult[\s\S]*@@unique\(\[stageResultId, dimensionKey\]\)/,
  );
  assert.match(
    schema,
    /model PerfPeerRelationAggregate[\s\S]*@@unique\(\[stageDimensionResultId, relation\]\)/,
  );
  assert.match(
    migration,
    /perf_stage_dimension_results_stage_result_id_fkey[\s\S]*ON DELETE CASCADE/,
  );
  assert.match(
    migration,
    /perf_peer_relation_aggregates_stage_dimension_result_id_fkey[\s\S]*ON DELETE CASCADE/,
  );
  assert.match(
    migration,
    /perf_peer_relation_aggregates_relation_check"[\s\S]*"relation" <> 'LEADER'/,
  );
});
