-- 飞书 OKR v2 同步表：分类、用户周期、目标、关键结果、指标、进展和对齐关系。
CREATE TABLE "performance"."lark_okr_categories" (
    "id" TEXT NOT NULL,
    "create_time" TEXT NOT NULL,
    "update_time" TEXT NOT NULL,
    "category_type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "color" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lark_okr_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "performance"."lark_okr_cycles" (
    "id" TEXT NOT NULL,
    "create_time" TEXT NOT NULL,
    "update_time" TEXT NOT NULL,
    "tenant_cycle_id" TEXT NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_open_id" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "cycle_status" INTEGER,
    "score" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lark_okr_cycles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "performance"."lark_okr_objectives" (
    "id" TEXT NOT NULL,
    "create_time" TEXT NOT NULL,
    "update_time" TEXT NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_open_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "content" JSONB,
    "score" DOUBLE PRECISION,
    "notes" JSONB,
    "weight" DOUBLE PRECISION,
    "deadline" TEXT,
    "category_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lark_okr_objectives_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "performance"."lark_okr_key_results" (
    "id" TEXT NOT NULL,
    "create_time" TEXT NOT NULL,
    "update_time" TEXT NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_open_id" TEXT NOT NULL,
    "objective_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "content" JSONB,
    "score" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION,
    "deadline" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lark_okr_key_results_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "performance"."lark_okr_indicators" (
    "id" TEXT NOT NULL,
    "create_time" TEXT NOT NULL,
    "update_time" TEXT NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_open_id" TEXT,
    "entity_type" INTEGER NOT NULL,
    "entity_id" TEXT NOT NULL,
    "indicator_status" INTEGER NOT NULL,
    "status_calculate_type" INTEGER NOT NULL,
    "start_value" DOUBLE PRECISION,
    "target_value" DOUBLE PRECISION,
    "current_value" DOUBLE PRECISION,
    "current_value_calculate_type" INTEGER,
    "unit" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lark_okr_indicators_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "performance"."lark_okr_progresses" (
    "id" TEXT NOT NULL,
    "create_time" TEXT NOT NULL,
    "update_time" TEXT NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_open_id" TEXT,
    "entity_type" INTEGER NOT NULL,
    "entity_id" TEXT NOT NULL,
    "content" JSONB,
    "progress_percent" DOUBLE PRECISION,
    "progress_status" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lark_okr_progresses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "performance"."lark_okr_alignments" (
    "id" TEXT NOT NULL,
    "create_time" TEXT NOT NULL,
    "update_time" TEXT NOT NULL,
    "from_owner_type" TEXT NOT NULL,
    "from_owner_id" TEXT,
    "to_owner_type" TEXT NOT NULL,
    "to_owner_id" TEXT,
    "from_entity_type" INTEGER NOT NULL,
    "from_entity_id" TEXT NOT NULL,
    "to_entity_type" INTEGER NOT NULL,
    "to_entity_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lark_okr_alignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lark_okr_categories_category_type_enabled_idx"
ON "performance"."lark_okr_categories"("category_type", "enabled");

CREATE INDEX "lark_okr_cycles_owner_open_id_start_time_idx"
ON "performance"."lark_okr_cycles"("owner_open_id", "start_time");
CREATE INDEX "lark_okr_cycles_tenant_cycle_id_idx"
ON "performance"."lark_okr_cycles"("tenant_cycle_id");
CREATE INDEX "lark_okr_cycles_cycle_status_idx"
ON "performance"."lark_okr_cycles"("cycle_status");

CREATE INDEX "lark_okr_objectives_cycle_id_position_idx"
ON "performance"."lark_okr_objectives"("cycle_id", "position");
CREATE INDEX "lark_okr_objectives_owner_open_id_idx"
ON "performance"."lark_okr_objectives"("owner_open_id");
CREATE INDEX "lark_okr_objectives_category_id_idx"
ON "performance"."lark_okr_objectives"("category_id");

CREATE INDEX "lark_okr_key_results_objective_id_position_idx"
ON "performance"."lark_okr_key_results"("objective_id", "position");
CREATE INDEX "lark_okr_key_results_owner_open_id_idx"
ON "performance"."lark_okr_key_results"("owner_open_id");

CREATE UNIQUE INDEX "lark_okr_indicators_entity_type_entity_id_key"
ON "performance"."lark_okr_indicators"("entity_type", "entity_id");
CREATE INDEX "lark_okr_indicators_owner_open_id_idx"
ON "performance"."lark_okr_indicators"("owner_open_id");

CREATE INDEX "lark_okr_progresses_entity_type_entity_id_create_time_idx"
ON "performance"."lark_okr_progresses"("entity_type", "entity_id", "create_time");
CREATE INDEX "lark_okr_progresses_owner_open_id_idx"
ON "performance"."lark_okr_progresses"("owner_open_id");

CREATE INDEX "lark_okr_alignments_from_entity_type_from_entity_id_idx"
ON "performance"."lark_okr_alignments"("from_entity_type", "from_entity_id");
CREATE INDEX "lark_okr_alignments_to_entity_type_to_entity_id_idx"
ON "performance"."lark_okr_alignments"("to_entity_type", "to_entity_id");
CREATE INDEX "lark_okr_alignments_from_owner_id_idx"
ON "performance"."lark_okr_alignments"("from_owner_id");
CREATE INDEX "lark_okr_alignments_to_owner_id_idx"
ON "performance"."lark_okr_alignments"("to_owner_id");

ALTER TABLE "performance"."lark_okr_objectives"
ADD CONSTRAINT "lark_okr_objectives_cycle_id_fkey"
FOREIGN KEY ("cycle_id") REFERENCES "performance"."lark_okr_cycles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "performance"."lark_okr_key_results"
ADD CONSTRAINT "lark_okr_key_results_objective_id_fkey"
FOREIGN KEY ("objective_id") REFERENCES "performance"."lark_okr_objectives"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
