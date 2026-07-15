import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(
  new URL(
    './migrations/20260716070000_allow_active_cycle_config_version_clone/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

test('ACTIVE 只允许追加 current+1 且同来源的周期配置版本', () => {
  assert.match(migration, /cycle_status = 'ACTIVE'/);
  assert.match(migration, /NEW\."version" <> current_version \+ 1/);
  assert.match(
    migration,
    /NEW\."source_config_template_version_id"\s+IS DISTINCT FROM current_source_config_template_version_id/,
  );
  assert.match(migration, /cannot be modified in place/);
});

test('来源模板归档后仍可延续既有周期版本链，但不能用于普通复制', () => {
  assert.match(migration, /source_version\."status" IN \('PUBLISHED', 'ARCHIVED'\)/);
  assert.match(migration, /source_version\."status" = 'PUBLISHED'/);
});
