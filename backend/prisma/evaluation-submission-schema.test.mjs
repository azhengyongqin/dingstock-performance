import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const schema = readFileSync(new URL('./schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL(
    './migrations/20260715032802_add_unified_evaluation_submissions/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const structuralChangeMigration = readFileSync(
  new URL(
    './migrations/20260716110000_preserve_structurally_invalidated_submissions/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

test('统一评估提交模型承载 SELF/PEER/MANAGER 且共用草稿/生效两态', () => {
  assert.match(schema, /model PerfEvaluationSubmission\s*{/);
  assert.match(
    schema,
    /model PerfEvaluationSubmission[\s\S]*stage\s+PerfEvaluationTaskType/,
  );
  assert.match(
    schema,
    /model PerfEvaluationSubmission[\s\S]*status\s+PerfReviewStatus\s+@default\(DRAFT\)/,
  );
});

test('结构变更失效态保留旧提交与原答案，同时不占用当前草稿/生效唯一槽位', () => {
  assert.match(
    schema,
    /enum PerfReviewStatus\s*{[\s\S]*INVALIDATED[\s\S]*}/,
  );
  assert.match(
    structuralChangeMigration,
    /ALTER TYPE "performance"\."PerfReviewStatus" ADD VALUE 'INVALIDATED'/,
  );
  assert.match(
    migration,
    /WHERE "status" = 'SUBMITTED'/,
  );
  assert.match(migration, /WHERE "status" = 'DRAFT'/);
});

test('评估项结果关系化子表按 formSnapshotId + key 定位，且同一提交内 itemKey 唯一', () => {
  assert.match(schema, /model PerfEvaluationItemResult\s*{/);
  assert.match(
    schema,
    /model PerfEvaluationItemResult[\s\S]*@@unique\(\[submissionId, itemKey\]\)/,
  );
  assert.match(schema, /rawLevel\s+PerfRatingSymbol\?/);
  assert.match(schema, /rawScore\s+Decimal\?\s+@map\("raw_score"\)\s+@db\.Decimal\(5, 2\)/);
  assert.match(
    schema,
    /calculationScore\s+Decimal\?\s+@map\("calculation_score"\)\s+@db\.Decimal\(5, 2\)/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "perf_evaluation_item_results_submission_id_item_key_key"\s+ON [^\n]+\("submission_id", "item_key"\)/,
  );
});

test('部分唯一索引保证同一 (participant, stage, reviewer) 至多一份 SUBMITTED 与至多一份 DRAFT', () => {
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "perf_evaluation_submissions_active_submitted_key"\s*\n\s*ON "performance"\."perf_evaluation_submissions"\("participant_id", "stage", "reviewer_open_id"\)\s*\n\s*WHERE "status" = 'SUBMITTED'/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "perf_evaluation_submissions_active_draft_key"\s*\n\s*ON "performance"\."perf_evaluation_submissions"\("participant_id", "stage", "reviewer_open_id"\)\s*\n\s*WHERE "status" = 'DRAFT'/,
  );
  // 两个索引各自独立按 status 过滤，因此同一三元组可以同时存在一份 SUBMITTED 和一份 DRAFT，
  // 但任一状态内都不能出现第二份——这正是「保留上次有效提交 + 一份可选编辑草稿」的落地方式。
  assert.notEqual(
    migration.indexOf('perf_evaluation_submissions_active_submitted_key'),
    migration.indexOf('perf_evaluation_submissions_active_draft_key'),
  );
});

test('AI 不落人工提交表，且仅 PEER 提交关联评审员指派', () => {
  assert.match(
    migration,
    /CONSTRAINT "perf_evaluation_submissions_stage_not_ai_check" CHECK \("stage" <> 'AI'\)/,
  );
  assert.match(
    migration,
    /CONSTRAINT "perf_evaluation_submissions_peer_assignment_check" CHECK \(\s*\n\s*\("stage" = 'PEER' AND "reviewer_assignment_id" IS NOT NULL\)\s*\n\s*OR \("stage" <> 'PEER' AND "reviewer_assignment_id" IS NULL\)/,
  );
});

test('复合外键锁定表单快照与评审员指派归属，阻止跨快照或伪造归属写入', () => {
  assert.match(
    migration,
    /FOREIGN KEY \("submission_id", "form_snapshot_id"\) REFERENCES "performance"\."perf_evaluation_submissions"\("id", "form_snapshot_id"\)/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("reviewer_assignment_id", "participant_id", "reviewer_open_id"\) REFERENCES "performance"\."perf_reviewer_assignments"\("id", "participant_id", "reviewer_open_id"\)/,
  );
});

test('评估项结果随提交行级联删除，且不建答案历史表（无独立版本号/历史字段）', () => {
  assert.match(
    migration,
    /ALTER TABLE "performance"\."perf_evaluation_item_results" ADD CONSTRAINT "perf_evaluation_item_results_submission_id_form_snapshot_i_fkey"[\s\S]*ON DELETE CASCADE/,
  );
  assert.doesNotMatch(schema, /model PerfEvaluationSubmission[\s\S]{0,4000}history/i);
});

test('触发器保证自评填写人必须是员工本人、上级评估填写人必须匹配 Leader 快照', () => {
  assert.match(migration, /validate_perf_evaluation_submission_reviewer/);
  assert.match(migration, /NEW\."stage" = 'SELF'/);
  assert.match(migration, /participant_employee_open_id IS DISTINCT FROM NEW\."reviewer_open_id"/);
  assert.match(migration, /NEW\."stage" = 'MANAGER'/);
  assert.match(
    migration,
    /participant_leader_open_id IS NULL OR participant_leader_open_id IS DISTINCT FROM NEW\."reviewer_open_id"/,
  );
});

test('计分项原始输入互斥：raw_level 与 raw_score 不能同时非空', () => {
  assert.match(
    migration,
    /CONSTRAINT "perf_evaluation_item_results_raw_value_exclusive_check" CHECK \(\s*\n\s*"raw_level" IS NULL OR "raw_score" IS NULL/,
  );
});
