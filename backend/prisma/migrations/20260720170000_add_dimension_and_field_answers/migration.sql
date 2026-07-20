-- CreateTable
CREATE TABLE "performance"."perf_evaluation_dimension_answers" (
    "id" SERIAL NOT NULL,
    "submission_id" INTEGER NOT NULL,
    "form_snapshot_id" INTEGER NOT NULL,
    "subform_key" TEXT NOT NULL,
    "dimension_key" TEXT NOT NULL,
    "scoring_method" "performance"."PerfFormScoringMethod",
    "raw_level" "performance"."PerfRatingSymbol",
    "raw_score" DECIMAL(5,2),
    "calculation_score" DECIMAL(5,2),
    "derived_level" "performance"."PerfRatingSymbol",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perf_evaluation_dimension_answers_pkey" PRIMARY KEY ("id"),
    -- 草稿可缺计分值，但任何已提供的原始值都必须匹配维度计分方式。
    CONSTRAINT "perf_evaluation_dimension_answers_scoring_payload_check" CHECK (
      ("scoring_method" = 'RATING' AND "raw_score" IS NULL)
      OR ("scoring_method" = 'SCORE' AND "raw_level" IS NULL)
      OR ("scoring_method" IS NULL AND "raw_level" IS NULL AND "raw_score" IS NULL
          AND "calculation_score" IS NULL AND "derived_level" IS NULL)
    ),
    CONSTRAINT "perf_evaluation_dimension_answers_score_range_check" CHECK (
      ("raw_score" IS NULL OR ("raw_score" >= 0 AND "raw_score" <= 100))
      AND ("calculation_score" IS NULL OR ("calculation_score" >= 0 AND "calculation_score" <= 100))
    )
);

-- CreateTable
CREATE TABLE "performance"."perf_evaluation_field_answers" (
    "id" SERIAL NOT NULL,
    "dimension_answer_id" INTEGER NOT NULL,
    "field_key" TEXT NOT NULL,
    "field_type" "performance"."PerfFormItemType" NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perf_evaluation_field_answers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "perf_evaluation_field_answers_non_scoring_type_check" CHECK ("field_type" NOT IN ('RATING', 'SCORE'))
);

-- CreateIndex
CREATE UNIQUE INDEX "perf_evaluation_dimension_answers_submission_id_dimension_key_key"
ON "performance"."perf_evaluation_dimension_answers"("submission_id", "dimension_key");

-- CreateIndex
CREATE INDEX "perf_evaluation_dimension_answers_form_snapshot_id_dimension_key_idx"
ON "performance"."perf_evaluation_dimension_answers"("form_snapshot_id", "dimension_key");

-- CreateIndex
CREATE UNIQUE INDEX "perf_evaluation_field_answers_dimension_answer_id_field_key_key"
ON "performance"."perf_evaluation_field_answers"("dimension_answer_id", "field_key");

-- CreateIndex
CREATE INDEX "perf_evaluation_field_answers_field_key_idx"
ON "performance"."perf_evaluation_field_answers"("field_key");

-- AddForeignKey
ALTER TABLE "performance"."perf_evaluation_dimension_answers"
ADD CONSTRAINT "perf_evaluation_dimension_answers_submission_id_form_snapshot_fkey"
FOREIGN KEY ("submission_id", "form_snapshot_id")
REFERENCES "performance"."perf_evaluation_submissions"("id", "form_snapshot_id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_evaluation_field_answers"
ADD CONSTRAINT "perf_evaluation_field_answers_dimension_answer_id_fkey"
FOREIGN KEY ("dimension_answer_id")
REFERENCES "performance"."perf_evaluation_dimension_answers"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
