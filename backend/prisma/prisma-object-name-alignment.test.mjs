import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    './migrations/20260720203000_align_prisma_object_names/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

test('后续迁移将历史手工对象名收敛到 Prisma schema 推导名', () => {
  for (const expectedName of [
    'perf_evaluation_dimension_answers_submission_id_form_snaps_fkey',
    'perf_legacy_promotion_archives_participant_id_cycle_id_fkey',
    'perf_evaluation_dimension_answers_form_snapshot_id_dimensio_idx',
    'perf_evaluation_dimension_answers_submission_id_dimension_k_key',
    'perf_form_dimensions_subform_id_type_idx',
    'perf_legacy_promotion_archives_participant_id_source_type_idx',
    'perf_legacy_promotion_archives_source_type_source_record_id_key',
  ]) {
    assert.match(migration, new RegExp(`TO "${expectedName}"`));
  }
});
