-- Ticket 20：扩展期只新增新生命周期取值和迁移账本；旧表、旧枚举值及旧读取路径全部保留。
ALTER TYPE "performance"."PerfParticipantStatus" ADD VALUE IF NOT EXISTS 'ACTIVE' BEFORE 'PENDING_SELF_REVIEW';

CREATE TYPE "performance"."PerfLegacyMigrationRunStatus" AS ENUM (
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'ROLLED_BACK'
);

CREATE TYPE "performance"."PerfLegacyMigrationItemStatus" AS ENUM (
  'MIGRATED',
  'SKIPPED',
  'FAILED',
  'ROLLED_BACK'
);

CREATE TABLE "performance"."perf_legacy_migration_runs" (
  "id" SERIAL NOT NULL,
  "run_key" TEXT NOT NULL,
  "cycle_id" INTEGER,
  "dry_run" BOOLEAN NOT NULL DEFAULT TRUE,
  "status" "performance"."PerfLegacyMigrationRunStatus" NOT NULL DEFAULT 'RUNNING',
  "source_counts" JSONB NOT NULL DEFAULT '{}',
  "migrated_counts" JSONB NOT NULL DEFAULT '{}',
  "validation_report" JSONB,
  "shadow_report" JSONB,
  "readiness_report" JSONB,
  "error_message" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "rolled_back_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "perf_legacy_migration_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_legacy_migration_runs_terminal_shape_check" CHECK (
    ("status" IN ('RUNNING') AND "completed_at" IS NULL AND "rolled_back_at" IS NULL)
    OR ("status" IN ('COMPLETED', 'FAILED') AND "completed_at" IS NOT NULL AND "rolled_back_at" IS NULL)
    OR ("status" = 'ROLLED_BACK' AND "completed_at" IS NOT NULL AND "rolled_back_at" IS NOT NULL)
  )
);

CREATE TABLE "performance"."perf_legacy_migration_items" (
  "id" SERIAL NOT NULL,
  "run_id" INTEGER NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_business_key" TEXT NOT NULL,
  "target_type" TEXT,
  "target_id" INTEGER,
  "checksum" CHAR(64) NOT NULL,
  "status" "performance"."PerfLegacyMigrationItemStatus" NOT NULL,
  "detail" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "perf_legacy_migration_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_legacy_migration_items_checksum_check" CHECK ("checksum" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "perf_legacy_migration_items_target_pair_check" CHECK (
    ("target_type" IS NULL AND "target_id" IS NULL)
    OR ("target_type" IS NOT NULL AND "target_id" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "perf_legacy_migration_runs_run_key_key"
  ON "performance"."perf_legacy_migration_runs"("run_key");
CREATE INDEX "perf_legacy_migration_runs_status_created_at_idx"
  ON "performance"."perf_legacy_migration_runs"("status", "created_at");
CREATE INDEX "perf_legacy_migration_runs_cycle_id_status_idx"
  ON "performance"."perf_legacy_migration_runs"("cycle_id", "status");

CREATE UNIQUE INDEX "perf_legacy_migration_items_source_type_source_business_key_key"
  ON "performance"."perf_legacy_migration_items"("source_type", "source_business_key");
CREATE INDEX "perf_legacy_migration_items_run_id_status_idx"
  ON "performance"."perf_legacy_migration_items"("run_id", "status");
CREATE INDEX "perf_legacy_migration_items_target_type_target_id_idx"
  ON "performance"."perf_legacy_migration_items"("target_type", "target_id");

ALTER TABLE "performance"."perf_legacy_migration_runs"
  ADD CONSTRAINT "perf_legacy_migration_runs_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "performance"."perf_cycles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "performance"."perf_legacy_migration_items"
  ADD CONSTRAINT "perf_legacy_migration_items_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "performance"."perf_legacy_migration_runs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
