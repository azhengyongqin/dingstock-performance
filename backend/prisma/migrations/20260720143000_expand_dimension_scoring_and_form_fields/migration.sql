-- Expand 阶段：先把计分配置与稳定标识提升到维度/字段，旧评分项列留到最终 contract 票删除。
CREATE TYPE "performance"."PerfFormScoringMethod" AS ENUM ('RATING', 'SCORE');
CREATE TYPE "performance"."PerfFormFieldRequiredRule" AS ENUM ('OPTIONAL', 'ALWAYS', 'CONDITIONAL');

ALTER TABLE "performance"."perf_form_dimensions"
  ADD COLUMN "business_key" TEXT,
  ADD COLUMN "scoring_method" "performance"."PerfFormScoringMethod";

ALTER TABLE "performance"."perf_form_items"
  ADD COLUMN "business_key" TEXT,
  ADD COLUMN "required_rule" "performance"."PerfFormFieldRequiredRule" NOT NULL DEFAULT 'OPTIONAL',
  ADD COLUMN "required_levels" "performance"."PerfRatingSymbol"[] NOT NULL DEFAULT ARRAY[]::"performance"."PerfRatingSymbol"[];

-- 先为开发库旧数据生成一次性标识；复制新版本时应用层会显式继承业务 key。
ALTER TABLE "performance"."perf_form_dimensions" DISABLE TRIGGER USER;
ALTER TABLE "performance"."perf_form_items" DISABLE TRIGGER USER;

UPDATE "performance"."perf_form_dimensions"
SET "business_key" = gen_random_uuid()::text
WHERE "business_key" IS NULL;

UPDATE "performance"."perf_form_items"
SET "business_key" = gen_random_uuid()::text,
    "required_rule" = CASE WHEN "required" THEN 'ALWAYS'::"performance"."PerfFormFieldRequiredRule" ELSE 'OPTIONAL'::"performance"."PerfFormFieldRequiredRule" END
WHERE "business_key" IS NULL;

ALTER TABLE "performance"."perf_form_dimensions" ENABLE TRIGGER USER;
ALTER TABLE "performance"."perf_form_items" ENABLE TRIGGER USER;

ALTER TABLE "performance"."perf_form_dimensions"
  ALTER COLUMN "business_key" SET NOT NULL;

ALTER TABLE "performance"."perf_form_items"
  ALTER COLUMN "business_key" SET NOT NULL;

CREATE UNIQUE INDEX "perf_form_dimensions_subform_id_business_key_key"
  ON "performance"."perf_form_dimensions"("subform_id", "business_key");
CREATE INDEX "perf_form_dimensions_business_key_idx"
  ON "performance"."perf_form_dimensions"("business_key");
CREATE INDEX "perf_form_items_business_key_idx"
  ON "performance"."perf_form_items"("business_key");

ALTER TABLE "performance"."perf_form_dimensions"
  ADD CONSTRAINT "perf_form_dimensions_scoring_method_check"
  CHECK (
    ("kind" = 'REGULAR' AND "scoring_method" IS NOT NULL)
    OR ("kind" <> 'REGULAR' AND "scoring_method" IS NULL)
  ) NOT VALID;

ALTER TABLE "performance"."perf_form_items"
  ADD CONSTRAINT "perf_form_items_required_levels_check"
  CHECK (
    ("required_rule" = 'CONDITIONAL' AND cardinality("required_levels") > 0)
    OR ("required_rule" <> 'CONDITIONAL' AND cardinality("required_levels") = 0)
  );
