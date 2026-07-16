-- DropIndex
DROP INDEX "performance"."perf_appeals_participant_id_idx";

-- RenameForeignKey
ALTER TABLE "performance"."perf_appeals" RENAME CONSTRAINT "perf_appeals_invalidation_rollback_fkey" TO "perf_appeals_invalidated_by_rollback_id_fkey";

-- RenameForeignKey
ALTER TABLE "performance"."perf_appeals" RENAME CONSTRAINT "perf_appeals_resolution_calibration_participant_fkey" TO "perf_appeals_resolution_calibration_id_participant_id_fkey";

-- RenameForeignKey
ALTER TABLE "performance"."perf_appeals" RENAME CONSTRAINT "perf_appeals_result_version_participant_fkey" TO "perf_appeals_result_version_id_participant_id_fkey";

-- RenameForeignKey
ALTER TABLE "performance"."perf_calibrations" RENAME CONSTRAINT "perf_calibrations_invalidation_rollback_fkey" TO "perf_calibrations_invalidated_by_rollback_id_fkey";

-- RenameForeignKey
ALTER TABLE "performance"."perf_result_versions" RENAME CONSTRAINT "perf_result_versions_invalidation_rollback_fkey" TO "perf_result_versions_invalidated_by_rollback_id_fkey";
