import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync(new URL('./schema.prisma', import.meta.url), 'utf8');
const submissionMigration = readFileSync(
  new URL('./migrations/20260715032802_add_unified_evaluation_submissions/migration.sql', import.meta.url),
  'utf8',
);
const answerMigration = readFileSync(
  new URL('./migrations/20260720170000_add_dimension_and_field_answers/migration.sql', import.meta.url),
  'utf8',
);
const contractMigration = readFileSync(
  new URL('./migrations/20260720193000_contract_evaluation_dimension_model/migration.sql', import.meta.url),
  'utf8',
);

test('统一人工提交承载三类答卷并保留草稿/生效/失效状态', () => {
  assert.match(schema, /model PerfEvaluationSubmission\s*{[\s\S]*stage\s+PerfEvaluationTaskType[\s\S]*status\s+PerfReviewStatus\s+@default\(DRAFT\)/);
  assert.match(schema, /enum PerfReviewStatus\s*{[\s\S]*DRAFT[\s\S]*SUBMITTED[\s\S]*INVALIDATED/);
  assert.match(submissionMigration, /perf_evaluation_submissions_active_submitted_key/);
  assert.match(submissionMigration, /perf_evaluation_submissions_active_draft_key/);
});

test('作答只使用维度与字段两层关系模型', () => {
  assert.match(schema, /model PerfEvaluationDimensionAnswer\s*{[\s\S]*@@unique\(\[submissionId, dimensionKey\]\)/);
  assert.match(schema, /model PerfEvaluationFieldAnswer\s*{[\s\S]*@@unique\(\[dimensionAnswerId, fieldKey\]\)/);
  assert.doesNotMatch(schema, /model PerfEvaluationItemResult\s*{/);
  assert.match(contractMigration, /DROP TABLE IF EXISTS "performance"\."perf_evaluation_item_results"/);
});

test('维度作答保留原始输入、计算分与派生等级', () => {
  assert.match(schema, /rawLevel\s+PerfRatingSymbol\?/);
  assert.match(schema, /rawScore\s+Decimal\?[\s\S]*@db\.Decimal\(5, 2\)/);
  assert.match(schema, /calculationScore\s+Decimal\?[\s\S]*@db\.Decimal\(5, 2\)/);
  assert.match(schema, /derivedLevel\s+PerfRatingSymbol\?/);
  assert.match(answerMigration, /perf_evaluation_dimension_answers_scoring_payload_check/);
});

test('复合外键阻止回答跨提交快照挂载，并级联删除回答', () => {
  assert.match(answerMigration, /FOREIGN KEY \("submission_id", "form_snapshot_id"\)[\s\S]*ON DELETE CASCADE/);
  assert.match(answerMigration, /perf_evaluation_field_answers_dimension_answer_id_fkey[\s\S]*ON DELETE CASCADE/);
});

test('AI 不落人工提交表，PEER 才关联评审员指派', () => {
  assert.match(submissionMigration, /perf_evaluation_submissions_stage_not_ai_check/);
  assert.match(submissionMigration, /perf_evaluation_submissions_peer_assignment_check/);
});
