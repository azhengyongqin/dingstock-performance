-- Ticket 08：持久化可解释、可版本化的评估阶段结果，首先承载 360°关系加权结果。

CREATE TYPE "performance"."PerfStageResultStatus" AS ENUM ('READY', 'NO_DATA');

CREATE TABLE "performance"."perf_stage_results" (
  "id" SERIAL NOT NULL,
  "cycle_id" INTEGER NOT NULL,
  "participant_id" INTEGER NOT NULL,
  "cycle_config_version_id" INTEGER NOT NULL,
  "stage" "performance"."PerfEvaluationTaskType" NOT NULL,
  "status" "performance"."PerfStageResultStatus" NOT NULL,
  "mode" "performance"."PerfStageResultMode" NOT NULL,
  "reviewer_count" INTEGER NOT NULL DEFAULT 0,
  "composite_score" DECIMAL(5,2),
  "initial_level" "performance"."PerfRatingSymbol",
  "stage_level" "performance"."PerfRatingSymbol",
  "constraint_reasons" JSONB NOT NULL DEFAULT '[]',
  "calculation_detail" JSONB NOT NULL,
  "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "perf_stage_results_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_stage_results_reviewer_count_check"
    CHECK ("reviewer_count" >= 0),
  CONSTRAINT "perf_stage_results_score_range_check"
    CHECK ("composite_score" IS NULL OR "composite_score" BETWEEN 0 AND 100),
  CONSTRAINT "perf_stage_results_json_shape_check"
    CHECK (
      jsonb_typeof("constraint_reasons") = 'array'
      AND jsonb_typeof("calculation_detail") = 'object'
    ),
  -- 无数据不能伪造零分/等级；有数据必须形成完整的分数与等级链。
  CONSTRAINT "perf_stage_results_status_shape_check"
    CHECK (
      (
        "status" = 'NO_DATA'
        AND "reviewer_count" = 0
        AND "composite_score" IS NULL
        AND "initial_level" IS NULL
        AND "stage_level" IS NULL
      )
      OR (
        "status" = 'READY'
        AND "reviewer_count" > 0
        AND "composite_score" IS NOT NULL
        AND "initial_level" IS NOT NULL
        AND "stage_level" IS NOT NULL
      )
    ),
  CONSTRAINT "perf_stage_results_stage_mode_check"
    CHECK (
      ("stage" IN ('SELF', 'AI') AND "mode" = 'DIRECT_RATING')
      OR ("stage" IN ('PEER', 'MANAGER') AND "mode" IN ('WEIGHTED_RATING', 'WEIGHTED_SCORE'))
  )
);

CREATE TABLE "performance"."perf_stage_dimension_results" (
  "id" SERIAL NOT NULL,
  "stage_result_id" INTEGER NOT NULL,
  "dimension_key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "weight" DECIMAL(5,2) NOT NULL,
  "is_core" BOOLEAN NOT NULL,
  "score" DECIMAL(65,30) NOT NULL,
  "level" "performance"."PerfRatingSymbol" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "perf_stage_dimension_results_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_stage_dimension_results_weight_check"
    CHECK ("weight" BETWEEN 0 AND 100),
  CONSTRAINT "perf_stage_dimension_results_score_check"
    CHECK ("score" BETWEEN 0 AND 100)
);

CREATE TABLE "performance"."perf_peer_relation_aggregates" (
  "id" SERIAL NOT NULL,
  "stage_dimension_result_id" INTEGER NOT NULL,
  "relation" "performance"."PerfReviewerRelation" NOT NULL,
  "base_weight" DECIMAL(5,2) NOT NULL,
  "adjusted_weight" DECIMAL(65,30) NOT NULL,
  "reviewer_count" INTEGER NOT NULL,
  "score" DECIMAL(65,30) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "perf_peer_relation_aggregates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_peer_relation_aggregates_relation_check"
    CHECK ("relation" <> 'LEADER'),
  CONSTRAINT "perf_peer_relation_aggregates_weight_check"
    CHECK (
      "base_weight" BETWEEN 0 AND 100
      AND "adjusted_weight" > 0
      AND "adjusted_weight" <= 100
    ),
  CONSTRAINT "perf_peer_relation_aggregates_reviewer_count_check"
    CHECK ("reviewer_count" > 0),
  CONSTRAINT "perf_peer_relation_aggregates_score_check"
    CHECK ("score" BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX "perf_stage_results_participant_id_stage_cycle_config_versio_key"
  ON "performance"."perf_stage_results"("participant_id", "stage", "cycle_config_version_id");

CREATE INDEX "perf_stage_results_cycle_id_stage_status_idx"
  ON "performance"."perf_stage_results"("cycle_id", "stage", "status");

CREATE INDEX "perf_stage_results_cycle_config_version_id_idx"
  ON "performance"."perf_stage_results"("cycle_config_version_id");

CREATE INDEX "perf_stage_dimension_results_dimension_key_idx"
  ON "performance"."perf_stage_dimension_results"("dimension_key");

CREATE UNIQUE INDEX "perf_stage_dimension_results_stage_result_id_dimension_key_key"
  ON "performance"."perf_stage_dimension_results"("stage_result_id", "dimension_key");

CREATE INDEX "perf_peer_relation_aggregates_relation_idx"
  ON "performance"."perf_peer_relation_aggregates"("relation");

CREATE UNIQUE INDEX "perf_peer_relation_aggregates_stage_dimension_result_id_rel_key"
  ON "performance"."perf_peer_relation_aggregates"("stage_dimension_result_id", "relation");

ALTER TABLE "performance"."perf_stage_results"
  ADD CONSTRAINT "perf_stage_results_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "performance"."perf_cycles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "performance"."perf_stage_results"
  ADD CONSTRAINT "perf_stage_results_participant_id_cycle_id_fkey"
  FOREIGN KEY ("participant_id", "cycle_id")
  REFERENCES "performance"."perf_participants"("id", "cycle_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "performance"."perf_stage_results"
  ADD CONSTRAINT "perf_stage_results_cycle_config_version_id_cycle_id_fkey"
  FOREIGN KEY ("cycle_config_version_id", "cycle_id")
  REFERENCES "performance"."perf_cycle_config_versions"("id", "cycle_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "performance"."perf_stage_dimension_results"
  ADD CONSTRAINT "perf_stage_dimension_results_stage_result_id_fkey"
  FOREIGN KEY ("stage_result_id")
  REFERENCES "performance"."perf_stage_results"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "performance"."perf_peer_relation_aggregates"
  ADD CONSTRAINT "perf_peer_relation_aggregates_stage_dimension_result_id_fkey"
  FOREIGN KEY ("stage_dimension_result_id")
  REFERENCES "performance"."perf_stage_dimension_results"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
