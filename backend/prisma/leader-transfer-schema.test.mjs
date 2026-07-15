import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const schema = readFileSync(new URL('./schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL(
    './migrations/20260715190000_secure_leader_transfer/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

test('MANAGER 生效答卷跨 Leader 全局唯一，职责转移不能形成双负责人结果', () => {
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "perf_evaluation_submissions_manager_submitted_key"\s*\n\s*ON "performance"\."perf_evaluation_submissions"\("participant_id"\)\s*\n\s*WHERE "stage" = 'MANAGER' AND "status" = 'SUBMITTED'/,
  );
  assert.match(
    schema,
    /MANAGER 阶段还由迁移中的跨填写人部分唯一索引保证每名参与者至多一份生效提交与一份草稿/,
  );
});

test('MANAGER 更新草稿同样跨 Leader 全局唯一，避免转移后读取到双草稿', () => {
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "perf_evaluation_submissions_manager_draft_key"\s*\n\s*ON "performance"\."perf_evaluation_submissions"\("participant_id"\)\s*\n\s*WHERE "stage" = 'MANAGER' AND "status" = 'DRAFT'/,
  );
});
