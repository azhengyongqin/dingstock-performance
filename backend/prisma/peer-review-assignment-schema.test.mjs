import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const schema = readFileSync(new URL('./schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL(
    './migrations/20260715143000_harden_peer_reviewer_assignments/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

test('评审员指派与参与者使用 cycleId 复合外键，阻止跨周期伪造归属', () => {
  assert.match(
    schema,
    /model PerfReviewerAssignment[\s\S]*participant\s+PerfParticipant\s+@relation\(fields: \[participantId, cycleId\], references: \[id, cycleId\], onDelete: Cascade\)/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("participant_id", "cycle_id"\)\s+REFERENCES "performance"\."perf_participants"\("id", "cycle_id"\)/,
  );
});

test('数据库只允许四类 360°计算关系且禁止把员工本人或考核 Leader 指派为评审员', () => {
  assert.match(migration, /perf_reviewer_assignments_relation_check/);
  assert.match(migration, /"relation" <> 'LEADER'/);
  assert.match(migration, /validate_perf_reviewer_assignment/);
  assert.match(migration, /participant_employee_open_id IS NOT DISTINCT FROM NEW\."reviewer_open_id"/);
  assert.match(migration, /participant_leader_open_id IS NOT DISTINCT FROM NEW\."reviewer_open_id"/);
});

test('同一参与者与评审员至多存在一条未替换的有效指派', () => {
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "perf_reviewer_assignments_active_reviewer_key"[\s\S]*WHERE "status" <> 'REPLACED'/,
  );
});

test('迁移修复非法或重复指派时同步写入系统审计', () => {
  assert.match(migration, /reviewer\.migration_replace/);
  assert.match(migration, /system:migration:ticket-07/);
  assert.match(migration, /INSERT INTO "performance"\."audit_logs"/);
});
