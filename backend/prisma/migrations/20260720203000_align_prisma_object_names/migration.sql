-- 旧迁移中的手工对象名与 Prisma 7 当前从 schema 推导出的名称不一致。
-- 仅重命名对象，不改变约束、索引列或数据语义，使 migrate diff 可作为稳定验收门禁。
ALTER TABLE "performance"."perf_evaluation_dimension_answers"
  RENAME CONSTRAINT "perf_evaluation_dimension_answers_submission_id_form_snapshot_f"
  TO "perf_evaluation_dimension_answers_submission_id_form_snaps_fkey";

ALTER TABLE "performance"."perf_legacy_promotion_archives"
  RENAME CONSTRAINT "perf_legacy_promotion_archives_participant_cycle_fkey"
  TO "perf_legacy_promotion_archives_participant_id_cycle_id_fkey";

ALTER INDEX "performance"."perf_evaluation_dimension_answers_form_snapshot_id_dimension_ke"
  RENAME TO "perf_evaluation_dimension_answers_form_snapshot_id_dimensio_idx";

ALTER INDEX "performance"."perf_evaluation_dimension_answers_submission_id_dimension_key_k"
  RENAME TO "perf_evaluation_dimension_answers_submission_id_dimension_k_key";

ALTER INDEX "performance"."perf_form_dimensions_subform_id_kind_idx"
  RENAME TO "perf_form_dimensions_subform_id_type_idx";

ALTER INDEX "performance"."perf_legacy_promotion_archives_participant_source_idx"
  RENAME TO "perf_legacy_promotion_archives_participant_id_source_type_idx";

ALTER INDEX "performance"."perf_legacy_promotion_archives_source_key"
  RENAME TO "perf_legacy_promotion_archives_source_type_source_record_id_key";
