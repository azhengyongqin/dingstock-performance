import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync(
  new URL('./schema.prisma', import.meta.url),
  'utf8',
);
const archiveMigration = readFileSync(
  new URL(
    './migrations/20260720192500_archive_legacy_promotion_answers/migration.sql',
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

test('旧晋升使用独立 append-only 归档且不恢复旧评估项运行时模型', () => {
  assert.match(
    schema,
    /model PerfLegacyPromotionArchive\s*{[\s\S]*payload\s+Json[\s\S]*archivedAt\s+DateTime/,
  );
  assert.match(schema, /@@unique\(\[sourceType, sourceRecordId\]\)/);
  assert.doesNotMatch(schema, /model PerfEvaluationItemResult\s*{/);
  assert.match(archiveMigration, /perf_legacy_promotion_archives_append_only/);
  assert.match(
    contractMigration,
    /DROP TABLE IF EXISTS "performance"\."perf_evaluation_item_results"/,
  );
});

test('归档迁移兼容旧源表存在或已删除，并保留历史结果快照投影', () => {
  assert.match(
    archiveMigration,
    /to_regclass\('performance\.perf_evaluation_item_results'\) IS NOT NULL/,
  );
  assert.match(archiveMigration, /item\."subform_key" = 'subform:PROMOTION'/);
  assert.match(archiveMigration, /RESULT_VERSION_SNAPSHOT/);
  assert.match(archiveMigration, /result\."result_snapshot"->'promotion'/);
  assert.match(
    archiveMigration,
    /ON CONFLICT \("source_type", "source_record_id"\) DO NOTHING/g,
  );
});
