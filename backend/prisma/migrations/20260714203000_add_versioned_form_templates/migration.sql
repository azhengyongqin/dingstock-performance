-- CreateEnum
CREATE TYPE "performance"."PerfFormTemplateVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "performance"."PerfJobLevelPrefix" AS ENUM ('D', 'M');

-- CreateEnum
CREATE TYPE "performance"."PerfFormSubformType" AS ENUM ('SELF', 'PEER', 'MANAGER', 'PROMOTION');

-- CreateEnum
CREATE TYPE "performance"."PerfFormDimensionKind" AS ENUM ('REGULAR', 'TEXT', 'PROMOTION');

-- CreateEnum
CREATE TYPE "performance"."PerfFormAudience" AS ENUM ('EMPLOYEE', 'REVIEWER', 'LEADER');

-- CreateEnum
CREATE TYPE "performance"."PerfFormItemType" AS ENUM (
  'RATING',
  'SCORE',
  'SHORT_TEXT',
  'LONG_TEXT',
  'MARKDOWN',
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'ATTACHMENT',
  'LINK'
);

-- CreateTable
CREATE TABLE "performance"."perf_form_templates" (
  "id" SERIAL NOT NULL,
  "system_key" TEXT,
  "created_by_open_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "perf_form_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_form_templates_system_key_not_blank_check"
    CHECK ("system_key" IS NULL OR btrim("system_key") <> '')
);

-- CreateTable
CREATE TABLE "performance"."perf_form_template_versions" (
  "id" SERIAL NOT NULL,
  "template_id" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "performance"."PerfFormTemplateVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "name" TEXT NOT NULL,
  "description" TEXT,
  "job_level_prefix" "performance"."PerfJobLevelPrefix" NOT NULL,
  "source_version_id" INTEGER,
  "created_by_open_id" TEXT NOT NULL,
  "updated_by_open_id" TEXT NOT NULL,
  "published_by_open_id" TEXT,
  "published_at" TIMESTAMP(3),
  "archived_by_open_id" TEXT,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "perf_form_template_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_form_template_versions_version_positive_check"
    CHECK ("version" > 0),
  CONSTRAINT "perf_form_template_versions_name_not_blank_check"
    CHECK (btrim("name") <> ''),
  -- 草稿不能携带发布/归档元数据；发布与归档必须同时记录操作者和时间。
  CONSTRAINT "perf_form_template_versions_status_metadata_check"
    CHECK (
      (
        "status" = 'DRAFT'
        AND "published_by_open_id" IS NULL
        AND "published_at" IS NULL
        AND "archived_by_open_id" IS NULL
        AND "archived_at" IS NULL
      )
      OR (
        "status" = 'PUBLISHED'
        AND "published_by_open_id" IS NOT NULL
        AND "published_at" IS NOT NULL
        AND "archived_by_open_id" IS NULL
        AND "archived_at" IS NULL
      )
      OR (
        "status" = 'ARCHIVED'
        AND "published_by_open_id" IS NOT NULL
        AND "published_at" IS NOT NULL
        AND "archived_by_open_id" IS NOT NULL
        AND "archived_at" IS NOT NULL
      )
    ),
  CONSTRAINT "perf_form_template_versions_source_not_self_check"
    CHECK ("source_version_id" IS NULL OR "source_version_id" <> "id")
);

-- CreateTable
CREATE TABLE "performance"."perf_form_subforms" (
  "id" SERIAL NOT NULL,
  "version_id" INTEGER NOT NULL,
  "type" "performance"."PerfFormSubformType" NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "perf_form_subforms_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_form_subforms_sort_order_nonnegative_check"
    CHECK ("sort_order" >= 0),
  CONSTRAINT "perf_form_subforms_title_not_blank_check"
    CHECK (btrim("title") <> '')
);

-- CreateTable
CREATE TABLE "performance"."perf_form_dimensions" (
  "id" SERIAL NOT NULL,
  "subform_id" INTEGER NOT NULL,
  "kind" "performance"."PerfFormDimensionKind" NOT NULL DEFAULT 'REGULAR',
  "audience" "performance"."PerfFormAudience" NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "weight" DECIMAL(5,2),
  "is_core" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "perf_form_dimensions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_form_dimensions_sort_order_nonnegative_check"
    CHECK ("sort_order" >= 0),
  CONSTRAINT "perf_form_dimensions_weight_range_check"
    CHECK ("weight" IS NULL OR ("weight" >= 0 AND "weight" <= 100)),
  -- 文本和晋升维度不参与阶段加权，也不能成为核心维度。
  CONSTRAINT "perf_form_dimensions_non_regular_not_weighted_check"
    CHECK ("kind" = 'REGULAR' OR ("weight" IS NULL AND "is_core" = false)),
  CONSTRAINT "perf_form_dimensions_name_not_blank_check"
    CHECK (btrim("name") <> '')
);

-- CreateTable
CREATE TABLE "performance"."perf_form_items" (
  "id" SERIAL NOT NULL,
  "dimension_id" INTEGER NOT NULL,
  "type" "performance"."PerfFormItemType" NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "placeholder" TEXT,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "config" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "perf_form_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_form_items_sort_order_nonnegative_check"
    CHECK ("sort_order" >= 0),
  CONSTRAINT "perf_form_items_title_not_blank_check"
    CHECK (btrim("title") <> ''),
  CONSTRAINT "perf_form_items_config_object_check"
    CHECK ("config" IS NULL OR jsonb_typeof("config") = 'object')
);

-- CreateIndex
CREATE UNIQUE INDEX "perf_form_templates_system_key_key"
  ON "performance"."perf_form_templates"("system_key");

-- CreateIndex
CREATE UNIQUE INDEX "perf_form_template_versions_template_id_version_key"
  ON "performance"."perf_form_template_versions"("template_id", "version");

-- CreateIndex
CREATE INDEX "perf_form_template_versions_template_id_status_idx"
  ON "performance"."perf_form_template_versions"("template_id", "status");

-- CreateIndex
CREATE INDEX "perf_form_template_versions_status_job_level_prefix_idx"
  ON "performance"."perf_form_template_versions"("status", "job_level_prefix");

-- CreateIndex
CREATE INDEX "perf_form_template_versions_source_version_id_idx"
  ON "performance"."perf_form_template_versions"("source_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "perf_form_subforms_version_id_type_key"
  ON "performance"."perf_form_subforms"("version_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "perf_form_subforms_version_id_sort_order_key"
  ON "performance"."perf_form_subforms"("version_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "perf_form_dimensions_subform_id_audience_sort_order_key"
  ON "performance"."perf_form_dimensions"("subform_id", "audience", "sort_order");

-- CreateIndex
CREATE INDEX "perf_form_dimensions_subform_id_kind_idx"
  ON "performance"."perf_form_dimensions"("subform_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "perf_form_items_dimension_id_sort_order_key"
  ON "performance"."perf_form_items"("dimension_id", "sort_order");

-- AddForeignKey
ALTER TABLE "performance"."perf_form_template_versions"
  ADD CONSTRAINT "perf_form_template_versions_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "performance"."perf_form_templates"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_form_template_versions"
  ADD CONSTRAINT "perf_form_template_versions_source_version_id_fkey"
  FOREIGN KEY ("source_version_id") REFERENCES "performance"."perf_form_template_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_form_subforms"
  ADD CONSTRAINT "perf_form_subforms_version_id_fkey"
  FOREIGN KEY ("version_id") REFERENCES "performance"."perf_form_template_versions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_form_dimensions"
  ADD CONSTRAINT "perf_form_dimensions_subform_id_fkey"
  FOREIGN KEY ("subform_id") REFERENCES "performance"."perf_form_subforms"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_form_items"
  ADD CONSTRAINT "perf_form_items_dimension_id_fkey"
  FOREIGN KEY ("dimension_id") REFERENCES "performance"."perf_form_dimensions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 非草稿版本不可修改。已发布版本只允许一次 PUBLISHED -> ARCHIVED 状态转换，
-- 归档时只能补充归档元数据与通用更新时间，不能改写已发布内容。
CREATE FUNCTION "performance"."guard_form_template_version_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'form template version must be created as draft';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'only draft form template versions can be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" = 'DRAFT' THEN
    IF NEW."status" NOT IN ('DRAFT', 'PUBLISHED') THEN
      RAISE EXCEPTION 'draft form template version can only remain draft or be published';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'PUBLISHED' AND NEW."status" = 'ARCHIVED' THEN
    IF ROW(
      NEW."template_id",
      NEW."version",
      NEW."name",
      NEW."description",
      NEW."job_level_prefix",
      NEW."source_version_id",
      NEW."created_by_open_id",
      NEW."published_by_open_id",
      NEW."published_at",
      NEW."created_at"
    ) IS DISTINCT FROM ROW(
      OLD."template_id",
      OLD."version",
      OLD."name",
      OLD."description",
      OLD."job_level_prefix",
      OLD."source_version_id",
      OLD."created_by_open_id",
      OLD."published_by_open_id",
      OLD."published_at",
      OLD."created_at"
    ) THEN
      RAISE EXCEPTION 'published form template content is immutable';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'published or archived form template version is immutable';
END;
$$;

CREATE TRIGGER "perf_form_template_versions_guard_mutation"
BEFORE INSERT OR UPDATE OR DELETE ON "performance"."perf_form_template_versions"
FOR EACH ROW EXECUTE FUNCTION "performance"."guard_form_template_version_mutation"();

-- 子层触发器统一调用该断言。INSERT/UPDATE 同时校验新父链，UPDATE/DELETE 还校验旧父链，
-- 防止把已发布明细移动到草稿版本来绕过不可变约束。
CREATE FUNCTION "performance"."assert_form_template_version_is_draft"("version_id" INTEGER)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  "version_status" "performance"."PerfFormTemplateVersionStatus";
BEGIN
  SELECT "status" INTO "version_status"
  FROM "performance"."perf_form_template_versions"
  WHERE "id" = "version_id";

  -- 父表的 ON DELETE CASCADE 触发子层 DELETE 时，父记录可能已不再对查询可见。
  -- 此时放行级联删除；普通 INSERT/UPDATE 的孤立父键仍会被外键拒绝。
  IF "version_status" IS NULL THEN RETURN; END IF;
  IF "version_status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'form template version % is immutable because it is not draft', "version_id";
  END IF;
END;
$$;

CREATE FUNCTION "performance"."guard_form_subform_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM "performance"."assert_form_template_version_is_draft"(OLD."version_id");
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM "performance"."assert_form_template_version_is_draft"(NEW."version_id");
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "perf_form_subforms_guard_mutation"
BEFORE INSERT OR UPDATE OR DELETE ON "performance"."perf_form_subforms"
FOR EACH ROW EXECUTE FUNCTION "performance"."guard_form_subform_mutation"();

CREATE FUNCTION "performance"."guard_form_dimension_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  "old_version_id" INTEGER;
  "new_version_id" INTEGER;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT "version_id" INTO "old_version_id"
    FROM "performance"."perf_form_subforms"
    WHERE "id" = OLD."subform_id";
    PERFORM "performance"."assert_form_template_version_is_draft"("old_version_id");
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT "version_id" INTO "new_version_id"
    FROM "performance"."perf_form_subforms"
    WHERE "id" = NEW."subform_id";
    PERFORM "performance"."assert_form_template_version_is_draft"("new_version_id");
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "perf_form_dimensions_guard_mutation"
BEFORE INSERT OR UPDATE OR DELETE ON "performance"."perf_form_dimensions"
FOR EACH ROW EXECUTE FUNCTION "performance"."guard_form_dimension_mutation"();

CREATE FUNCTION "performance"."guard_form_item_mutation"()
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

CREATE TRIGGER "perf_form_items_guard_mutation"
BEFORE INSERT OR UPDATE OR DELETE ON "performance"."perf_form_items"
FOR EACH ROW EXECUTE FUNCTION "performance"."guard_form_item_mutation"();
