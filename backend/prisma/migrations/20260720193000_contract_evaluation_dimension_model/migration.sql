-- Contract 阶段：彻底删除旧评估项、旧人工阶段模式与迁移账本，只保留新版维度/字段模型。

-- 旧结果及一次性迁移账本不再属于运行时契约。
DROP TABLE IF EXISTS "performance"."perf_evaluation_item_results";
DROP TABLE IF EXISTS "performance"."perf_legacy_migration_items";
DROP TABLE IF EXISTS "performance"."perf_legacy_migration_runs";
DROP TYPE IF EXISTS "performance"."PerfLegacyMigrationItemStatus";
DROP TYPE IF EXISTS "performance"."PerfLegacyMigrationRunStatus";

-- 删除人工阶段计算模式和双套约束档位。先移除依赖这些列的约束与触发函数。
DROP TRIGGER IF EXISTS "perf_config_template_versions_guard_mutation"
  ON "performance"."perf_config_template_versions";
DROP FUNCTION IF EXISTS "performance"."guard_config_template_version_mutation"();

ALTER TABLE "performance"."perf_config_template_versions"
  DROP CONSTRAINT IF EXISTS "perf_config_template_versions_stage_modes_check",
  DROP CONSTRAINT IF EXISTS "perf_config_template_versions_constraint_profiles_object_check",
  DROP COLUMN IF EXISTS "self_stage_mode",
  DROP COLUMN IF EXISTS "peer_stage_mode",
  DROP COLUMN IF EXISTS "manager_stage_mode",
  DROP COLUMN IF EXISTS "ai_stage_mode",
  DROP COLUMN IF EXISTS "constraint_profiles";

ALTER TABLE "performance"."perf_cycle_config_versions"
  DROP CONSTRAINT IF EXISTS "perf_cycle_config_versions_stage_modes_check",
  DROP CONSTRAINT IF EXISTS "perf_cycle_config_versions_constraint_profiles_object_check",
  DROP COLUMN IF EXISTS "self_stage_mode",
  DROP COLUMN IF EXISTS "peer_stage_mode",
  DROP COLUMN IF EXISTS "manager_stage_mode",
  DROP COLUMN IF EXISTS "ai_stage_mode",
  DROP COLUMN IF EXISTS "constraint_profiles";

ALTER TABLE "performance"."perf_stage_results"
  DROP CONSTRAINT IF EXISTS "perf_stage_results_stage_mode_check",
  DROP COLUMN IF EXISTS "mode";

DROP TYPE IF EXISTS "performance"."PerfStageResultMode";

-- 晋升旧内容仍保存在 PROMOTION 子表单中，但运行时开关与 AI 晋升摘要退出通用绩效链路。
ALTER TABLE "performance"."perf_participants" DROP COLUMN IF EXISTS "is_promotion_enabled";
ALTER TABLE "performance"."perf_ai_reports" DROP COLUMN IF EXISTS "promotion_summary";

-- 维度枚举由旧 REGULAR/TEXT/PROMOTION 收敛为明确的新领域词汇。
ALTER TABLE "performance"."perf_form_dimensions"
  DROP CONSTRAINT IF EXISTS "perf_form_dimensions_scoring_method_check",
  DROP CONSTRAINT IF EXISTS "perf_form_dimensions_non_regular_not_weighted_check";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'performance' AND t.typname = 'PerfFormDimensionType'
  ) THEN
    CREATE TYPE "performance"."PerfFormDimensionType"
      AS ENUM ('SCORING', 'NON_SCORING', 'LEGACY_PROMOTION');
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'performance' AND table_name = 'perf_form_dimensions' AND column_name = 'kind'
  ) THEN
    ALTER TABLE "performance"."perf_form_dimensions" ALTER COLUMN "kind" DROP DEFAULT;
    ALTER TABLE "performance"."perf_form_dimensions"
      ALTER COLUMN "kind" TYPE "performance"."PerfFormDimensionType"
      USING (
        CASE "kind"::text
          WHEN 'REGULAR' THEN 'SCORING'
          WHEN 'TEXT' THEN 'NON_SCORING'
          WHEN 'PROMOTION' THEN 'LEGACY_PROMOTION'
        END
      )::"performance"."PerfFormDimensionType";
    ALTER TABLE "performance"."perf_form_dimensions" RENAME COLUMN "kind" TO "type";
  END IF;
END;
$$;

ALTER TABLE "performance"."perf_form_dimensions"
  DROP CONSTRAINT IF EXISTS "perf_form_dimensions_scoring_method_check",
  ALTER COLUMN "type" SET DEFAULT 'SCORING',
  ADD CONSTRAINT "perf_form_dimensions_scoring_method_check" CHECK (
    ("type" = 'SCORING' AND "scoring_method" IS NOT NULL)
    OR ("type" <> 'SCORING' AND "scoring_method" IS NULL)
  ),
  ADD CONSTRAINT "perf_form_dimensions_non_scoring_not_weighted_check" CHECK (
    "type" = 'SCORING' OR ("weight" IS NULL AND "is_core" = false)
  );

DROP TYPE IF EXISTS "performance"."PerfFormDimensionKind";

-- 清除 expand 期隐藏的 RATING/SCORE 兼容行，再把表和枚举正式收敛为字段模型。
DROP TRIGGER "perf_form_items_guard_mutation" ON "performance"."perf_form_items";
DROP FUNCTION "performance"."guard_form_item_mutation"();

DELETE FROM "performance"."perf_form_items" WHERE "type" IN ('RATING', 'SCORE');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'performance' AND t.typname = 'PerfFormFieldType'
  ) THEN
    CREATE TYPE "performance"."PerfFormFieldType" AS ENUM (
      'SHORT_TEXT', 'LONG_TEXT', 'MARKDOWN', 'SINGLE_SELECT',
      'MULTI_SELECT', 'ATTACHMENT', 'LINK'
    );
  END IF;
END;
$$;

ALTER TABLE "performance"."perf_evaluation_field_answers"
  DROP CONSTRAINT IF EXISTS "perf_evaluation_field_answers_non_scoring_type_check",
  ALTER COLUMN "field_type" TYPE "performance"."PerfFormFieldType"
    USING "field_type"::text::"performance"."PerfFormFieldType";

ALTER TABLE "performance"."perf_form_items"
  DROP CONSTRAINT IF EXISTS "perf_form_items_required_levels_check",
  DROP CONSTRAINT "perf_form_items_title_not_blank_check",
  DROP CONSTRAINT "perf_form_items_config_object_check",
  DROP CONSTRAINT "perf_form_items_sort_order_nonnegative_check",
  ALTER COLUMN "type" TYPE "performance"."PerfFormFieldType"
    USING "type"::text::"performance"."PerfFormFieldType",
  DROP COLUMN "required";

ALTER TABLE "performance"."perf_form_items" RENAME TO "perf_form_fields";

ALTER INDEX "performance"."perf_form_items_pkey" RENAME TO "perf_form_fields_pkey";
ALTER INDEX "performance"."perf_form_items_dimension_id_sort_order_key"
  RENAME TO "perf_form_fields_dimension_id_sort_order_key";
ALTER INDEX "performance"."perf_form_items_business_key_idx"
  RENAME TO "perf_form_fields_business_key_idx";

ALTER TABLE "performance"."perf_form_fields"
  RENAME CONSTRAINT "perf_form_items_dimension_id_fkey" TO "perf_form_fields_dimension_id_fkey";

ALTER TABLE "performance"."perf_form_fields"
  ADD CONSTRAINT "perf_form_fields_sort_order_nonnegative_check" CHECK ("sort_order" >= 0),
  ADD CONSTRAINT "perf_form_fields_title_not_blank_check" CHECK (btrim("title") <> ''),
  ADD CONSTRAINT "perf_form_fields_config_object_check" CHECK ("config" IS NULL OR jsonb_typeof("config") = 'object'),
  ADD CONSTRAINT "perf_form_fields_required_levels_check" CHECK (
    ("required_rule" = 'CONDITIONAL' AND cardinality("required_levels") > 0)
    OR ("required_rule" <> 'CONDITIONAL' AND cardinality("required_levels") = 0)
  );

DROP TYPE IF EXISTS "performance"."PerfFormItemType";

CREATE FUNCTION "performance"."guard_form_field_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  "old_version_id" INTEGER;
  "new_version_id" INTEGER;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT subform."version_id" INTO "old_version_id"
    FROM "performance"."perf_form_dimensions" AS dimension
    JOIN "performance"."perf_form_subforms" AS subform ON subform."id" = dimension."subform_id"
    WHERE dimension."id" = OLD."dimension_id";
    PERFORM "performance"."assert_form_template_version_is_draft"("old_version_id");
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT subform."version_id" INTO "new_version_id"
    FROM "performance"."perf_form_dimensions" AS dimension
    JOIN "performance"."perf_form_subforms" AS subform ON subform."id" = dimension."subform_id"
    WHERE dimension."id" = NEW."dimension_id";
    PERFORM "performance"."assert_form_template_version_is_draft"("new_version_id");
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "perf_form_fields_guard_mutation"
BEFORE INSERT OR UPDATE OR DELETE ON "performance"."perf_form_fields"
FOR EACH ROW EXECUTE FUNCTION "performance"."guard_form_field_mutation"();

-- 重建配置版本不可变保护，归档比较只覆盖新版仍然存在的字段。
CREATE FUNCTION "performance"."guard_config_template_version_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  "binding_count" INTEGER;
  "d_binding_count" INTEGER;
  "m_binding_count" INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'config template version must be created as draft';
    END IF;
    IF NEW."source_version_id" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "performance"."perf_config_template_versions" AS source
      WHERE source."id" = NEW."source_version_id"
        AND source."template_id" = NEW."template_id"
        AND source."status" = 'PUBLISHED'
    ) THEN
      RAISE EXCEPTION 'config template source version must be a published version of the same template';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'only draft config template versions can be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" = 'DRAFT' THEN
    IF NEW."status" NOT IN ('DRAFT', 'PUBLISHED') THEN
      RAISE EXCEPTION 'draft config template version can only remain draft or be published';
    END IF;
    IF ROW(NEW."template_id", NEW."version", NEW."created_by_open_id", NEW."created_at")
      IS DISTINCT FROM ROW(OLD."template_id", OLD."version", OLD."created_by_open_id", OLD."created_at") THEN
      RAISE EXCEPTION 'config template version identity is immutable';
    END IF;
    IF NEW."status" = 'PUBLISHED' THEN
      IF NEW."org_owner_weight" <= 0 OR NEW."project_owner_weight" <= 0
        OR NEW."peer_weight" <= 0 OR NEW."cross_dept_weight" <= 0
        OR NEW."org_owner_weight" + NEW."project_owner_weight" + NEW."peer_weight" + NEW."cross_dept_weight" <> 100 THEN
        RAISE EXCEPTION 'published config template relation weights must all be positive and total 100';
      END IF;
      SELECT COUNT(*),
        COUNT(*) FILTER (WHERE binding."job_level_prefix" = 'D'),
        COUNT(*) FILTER (WHERE binding."job_level_prefix" = 'M')
      INTO "binding_count", "d_binding_count", "m_binding_count"
      FROM "performance"."perf_config_form_bindings" AS binding
      WHERE binding."config_version_id" = OLD."id";
      IF "binding_count" <> 2 OR "d_binding_count" <> 1 OR "m_binding_count" <> 1 THEN
        RAISE EXCEPTION 'published config template version must bind exactly one D and one M form version';
      END IF;
      IF EXISTS (
        SELECT 1 FROM "performance"."perf_config_form_bindings" AS binding
        JOIN "performance"."perf_form_template_versions" AS form_version
          ON form_version."id" = binding."form_template_version_id"
          AND form_version."job_level_prefix" = binding."job_level_prefix"
        WHERE binding."config_version_id" = OLD."id" AND form_version."status" <> 'PUBLISHED'
      ) THEN
        RAISE EXCEPTION 'published config template version can only bind published form versions';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'PUBLISHED' AND NEW."status" = 'ARCHIVED' THEN
    IF ROW(NEW."template_id", NEW."version", NEW."name", NEW."description", NEW."source_version_id",
      NEW."ratings", NEW."org_owner_weight", NEW."project_owner_weight", NEW."peer_weight", NEW."cross_dept_weight",
      NEW."schedule_preset", NEW."notification_rules", NEW."created_by_open_id", NEW."published_by_open_id",
      NEW."published_at", NEW."created_at")
      IS DISTINCT FROM ROW(OLD."template_id", OLD."version", OLD."name", OLD."description", OLD."source_version_id",
      OLD."ratings", OLD."org_owner_weight", OLD."project_owner_weight", OLD."peer_weight", OLD."cross_dept_weight",
      OLD."schedule_preset", OLD."notification_rules", OLD."created_by_open_id", OLD."published_by_open_id",
      OLD."published_at", OLD."created_at") THEN
      RAISE EXCEPTION 'published config template content is immutable';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'published or archived config template version is immutable';
END;
$$;

CREATE TRIGGER "perf_config_template_versions_guard_mutation"
BEFORE INSERT OR UPDATE OR DELETE ON "performance"."perf_config_template_versions"
FOR EACH ROW EXECUTE FUNCTION "performance"."guard_config_template_version_mutation"();
