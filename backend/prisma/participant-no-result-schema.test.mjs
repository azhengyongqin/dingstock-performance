import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync(
  new URL('./schema.prisma', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL(
    './migrations/20260715230000_add_participant_no_result/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

test('参与者状态枚举包含独立的 NO_RESULT 终态', () => {
  assert.match(
    schema,
    /enum PerfParticipantStatus\s*{[\s\S]*NO_RESULT[\s\S]*}/,
  );
  assert.match(
    migration,
    /ALTER TYPE "performance"\."PerfParticipantStatus" ADD VALUE 'NO_RESULT'/,
  );
});
