-- CreateEnum
CREATE TYPE "performance"."PerfConfigTemplateVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "performance"."PerfStageResultMode" AS ENUM ('DIRECT_RATING', 'WEIGHTED_RATING', 'WEIGHTED_SCORE');

-- 配置绑定使用复合外键同时锁定表单版本与职级前缀，避免冗余前缀与来源版本不一致。
CREATE UNIQUE INDEX "perf_form_template_versions_id_job_level_prefix_key"
  ON "performance"."perf_form_template_versions"("id", "job_level_prefix");

-- CreateTable
CREATE TABLE "performance"."perf_config_templates" (
  "id" SERIAL NOT NULL,
  "system_key" TEXT,
  "created_by_open_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "perf_config_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_config_templates_system_key_not_blank_check"
    CHECK ("system_key" IS NULL OR btrim("system_key") <> '')
);

-- CreateTable
CREATE TABLE "performance"."perf_config_template_versions" (
  "id" SERIAL NOT NULL,
  "template_id" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "performance"."PerfConfigTemplateVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "name" TEXT NOT NULL,
  "description" TEXT,
  "source_version_id" INTEGER,
  "self_stage_mode" "performance"."PerfStageResultMode" NOT NULL DEFAULT 'DIRECT_RATING',
  "peer_stage_mode" "performance"."PerfStageResultMode" NOT NULL DEFAULT 'WEIGHTED_RATING',
  "manager_stage_mode" "performance"."PerfStageResultMode" NOT NULL DEFAULT 'WEIGHTED_SCORE',
  "ai_stage_mode" "performance"."PerfStageResultMode" NOT NULL DEFAULT 'DIRECT_RATING',
  "ratings" JSONB NOT NULL DEFAULT '[]'::JSONB,
  "constraint_profiles" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "org_owner_weight" DECIMAL(5,2) NOT NULL DEFAULT 30,
  "project_owner_weight" DECIMAL(5,2) NOT NULL DEFAULT 30,
  "peer_weight" DECIMAL(5,2) NOT NULL DEFAULT 25,
  "cross_dept_weight" DECIMAL(5,2) NOT NULL DEFAULT 15,
  "schedule_preset" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "notification_rules" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "created_by_open_id" TEXT NOT NULL,
  "updated_by_open_id" TEXT NOT NULL,
  "published_by_open_id" TEXT,
  "published_at" TIMESTAMP(3),
  "archived_by_open_id" TEXT,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "perf_config_template_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_config_template_versions_version_positive_check"
    CHECK ("version" > 0),
  CONSTRAINT "perf_config_template_versions_name_not_blank_check"
    CHECK (btrim("name") <> ''),
  CONSTRAINT "perf_config_template_versions_source_not_self_check"
    CHECK ("source_version_id" IS NULL OR "source_version_id" <> "id"),
  -- SELF 与 AI 固定直接评级；PEER 与 MANAGER 只允许两种受控加权模式。
  CONSTRAINT "perf_config_template_versions_stage_modes_check"
    CHECK (
      "self_stage_mode" = 'DIRECT_RATING'
      AND "ai_stage_mode" = 'DIRECT_RATING'
      AND "peer_stage_mode" IN ('WEIGHTED_RATING', 'WEIGHTED_SCORE')
      AND "manager_stage_mode" IN ('WEIGHTED_RATING', 'WEIGHTED_SCORE')
    ),
  CONSTRAINT "perf_config_template_versions_ratings_array_check"
    CHECK (jsonb_typeof("ratings") = 'array'),
  CONSTRAINT "perf_config_template_versions_constraint_profiles_object_check"
    CHECK (jsonb_typeof("constraint_profiles") = 'object'),
  CONSTRAINT "perf_config_template_versions_schedule_preset_object_check"
    CHECK (jsonb_typeof("schedule_preset") = 'object'),
  CONSTRAINT "perf_config_template_versions_notification_rules_object_check"
    CHECK (jsonb_typeof("notification_rules") = 'object'),
  -- 草稿可暂存 0 权重以展示完整发布错误；负数和超过 100 的值始终没有业务意义。
  CONSTRAINT "perf_config_template_versions_relation_weights_range_check"
    CHECK (
      "org_owner_weight" BETWEEN 0 AND 100
      AND "project_owner_weight" BETWEEN 0 AND 100
      AND "peer_weight" BETWEEN 0 AND 100
      AND "cross_dept_weight" BETWEEN 0 AND 100
    ),
  -- 已发布或已归档版本必须满足四类关系均为正数且严格合计 100%。
  CONSTRAINT "perf_config_template_versions_published_relation_weights_check"
    CHECK (
      "status" = 'DRAFT'
      OR (
        "org_owner_weight" > 0
        AND "project_owner_weight" > 0
        AND "peer_weight" > 0
        AND "cross_dept_weight" > 0
        AND "org_owner_weight" + "project_owner_weight" + "peer_weight" + "cross_dept_weight" = 100
      )
    ),
  -- 草稿不能携带发布/归档元数据；发布与归档必须同时记录操作者和时间。
  CONSTRAINT "perf_config_template_versions_status_metadata_check"
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
    )
);

-- CreateTable
CREATE TABLE "performance"."perf_config_form_bindings" (
  "id" SERIAL NOT NULL,
  "config_version_id" INTEGER NOT NULL,
  "form_template_version_id" INTEGER NOT NULL,
  "job_level_prefix" "performance"."PerfJobLevelPrefix" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "perf_config_form_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "perf_config_templates_system_key_key"
  ON "performance"."perf_config_templates"("system_key");

-- CreateIndex
CREATE UNIQUE INDEX "perf_config_template_versions_template_id_version_key"
  ON "performance"."perf_config_template_versions"("template_id", "version");

-- CreateIndex
CREATE INDEX "perf_config_template_versions_template_id_status_idx"
  ON "performance"."perf_config_template_versions"("template_id", "status");

-- CreateIndex
CREATE INDEX "perf_config_template_versions_status_idx"
  ON "performance"."perf_config_template_versions"("status");

-- CreateIndex
CREATE INDEX "perf_config_template_versions_source_version_id_idx"
  ON "performance"."perf_config_template_versions"("source_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "perf_config_form_bindings_config_version_id_job_level_prefi_key"
  ON "performance"."perf_config_form_bindings"("config_version_id", "job_level_prefix");

-- CreateIndex
CREATE INDEX "perf_config_form_bindings_form_template_version_id_idx"
  ON "performance"."perf_config_form_bindings"("form_template_version_id");

-- AddForeignKey
ALTER TABLE "performance"."perf_config_template_versions"
  ADD CONSTRAINT "perf_config_template_versions_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "performance"."perf_config_templates"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_config_template_versions"
  ADD CONSTRAINT "perf_config_template_versions_source_version_id_fkey"
  FOREIGN KEY ("source_version_id") REFERENCES "performance"."perf_config_template_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_config_form_bindings"
  ADD CONSTRAINT "perf_config_form_bindings_config_version_id_fkey"
  FOREIGN KEY ("config_version_id") REFERENCES "performance"."perf_config_template_versions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_config_form_bindings"
  ADD CONSTRAINT "perf_config_form_bindings_form_template_version_id_job_lev_fkey"
  FOREIGN KEY ("form_template_version_id", "job_level_prefix")
  REFERENCES "performance"."perf_form_template_versions"("id", "job_level_prefix")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 配置版本必须以草稿创建；发布时检查绑定完整性；发布后只允许一次归档转换。
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
      SELECT 1
      FROM "performance"."perf_config_template_versions" AS source
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

    -- 模板归属、版本号与创建身份属于版本身份，即使草稿阶段也不能搬移或改写。
    IF ROW(
      NEW."template_id",
      NEW."version",
      NEW."created_by_open_id",
      NEW."created_at"
    ) IS DISTINCT FROM ROW(
      OLD."template_id",
      OLD."version",
      OLD."created_by_open_id",
      OLD."created_at"
    ) THEN
      RAISE EXCEPTION 'config template version identity is immutable';
    END IF;

    -- 只有重新指定来源时才检查当前状态；来源随后归档不影响既有草稿继续编辑。
    IF NEW."source_version_id" IS DISTINCT FROM OLD."source_version_id"
      AND NEW."source_version_id" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "performance"."perf_config_template_versions" AS source
        WHERE source."id" = NEW."source_version_id"
          AND source."template_id" = NEW."template_id"
          AND source."status" = 'PUBLISHED'
      ) THEN
      RAISE EXCEPTION 'config template source version must be a published version of the same template';
    END IF;

    IF NEW."status" = 'PUBLISHED' THEN
      IF NEW."org_owner_weight" <= 0
        OR NEW."project_owner_weight" <= 0
        OR NEW."peer_weight" <= 0
        OR NEW."cross_dept_weight" <= 0
        OR NEW."org_owner_weight" + NEW."project_owner_weight" + NEW."peer_weight" + NEW."cross_dept_weight" <> 100 THEN
        RAISE EXCEPTION 'published config template relation weights must all be positive and total 100';
      END IF;

      SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE binding."job_level_prefix" = 'D'),
        COUNT(*) FILTER (WHERE binding."job_level_prefix" = 'M')
      INTO "binding_count", "d_binding_count", "m_binding_count"
      FROM "performance"."perf_config_form_bindings" AS binding
      WHERE binding."config_version_id" = OLD."id";

      IF "binding_count" <> 2 OR "d_binding_count" <> 1 OR "m_binding_count" <> 1 THEN
        RAISE EXCEPTION 'published config template version must bind exactly one D and one M form version';
      END IF;

      -- 与表单版本归档争用同一行锁，确保“发布时仍为 PUBLISHED”不被并发状态切换穿透。
      PERFORM 1
      FROM "performance"."perf_form_template_versions" AS form_version
      JOIN "performance"."perf_config_form_bindings" AS binding
        ON binding."form_template_version_id" = form_version."id"
        AND binding."job_level_prefix" = form_version."job_level_prefix"
      WHERE binding."config_version_id" = OLD."id"
      FOR SHARE OF form_version;

      IF EXISTS (
        SELECT 1
        FROM "performance"."perf_config_form_bindings" AS binding
        JOIN "performance"."perf_form_template_versions" AS form_version
          ON form_version."id" = binding."form_template_version_id"
          AND form_version."job_level_prefix" = binding."job_level_prefix"
        WHERE binding."config_version_id" = OLD."id"
          AND form_version."status" <> 'PUBLISHED'
      ) THEN
        RAISE EXCEPTION 'published config template version can only bind published form versions';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF OLD."status" = 'PUBLISHED' AND NEW."status" = 'ARCHIVED' THEN
    IF ROW(
      NEW."template_id",
      NEW."version",
      NEW."name",
      NEW."description",
      NEW."source_version_id",
      NEW."self_stage_mode",
      NEW."peer_stage_mode",
      NEW."manager_stage_mode",
      NEW."ai_stage_mode",
      NEW."ratings",
      NEW."constraint_profiles",
      NEW."org_owner_weight",
      NEW."project_owner_weight",
      NEW."peer_weight",
      NEW."cross_dept_weight",
      NEW."schedule_preset",
      NEW."notification_rules",
      NEW."created_by_open_id",
      NEW."published_by_open_id",
      NEW."published_at",
      NEW."created_at"
    ) IS DISTINCT FROM ROW(
      OLD."template_id",
      OLD."version",
      OLD."name",
      OLD."description",
      OLD."source_version_id",
      OLD."self_stage_mode",
      OLD."peer_stage_mode",
      OLD."manager_stage_mode",
      OLD."ai_stage_mode",
      OLD."ratings",
      OLD."constraint_profiles",
      OLD."org_owner_weight",
      OLD."project_owner_weight",
      OLD."peer_weight",
      OLD."cross_dept_weight",
      OLD."schedule_preset",
      OLD."notification_rules",
      OLD."created_by_open_id",
      OLD."published_by_open_id",
      OLD."published_at",
      OLD."created_at"
    ) THEN
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

-- 子绑定只允许在草稿版本下编辑；行锁避免绑定写入与发布并发穿透。
CREATE FUNCTION "performance"."assert_config_template_version_is_draft"("p_version_id" INTEGER)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  "version_status" "performance"."PerfConfigTemplateVersionStatus";
BEGIN
  SELECT "status" INTO "version_status"
  FROM "performance"."perf_config_template_versions"
  WHERE "id" = "p_version_id"
  FOR SHARE;

  -- 父表 ON DELETE CASCADE 触发绑定删除时，父记录可能已不可见，此时放行级联删除。
  IF "version_status" IS NULL THEN RETURN; END IF;
  IF "version_status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'config template version % is immutable because it is not draft', "p_version_id";
  END IF;
END;
$$;

-- 新绑定只能选择当前已发布的表单版本；复合外键另行保证职级前缀一致。
CREATE FUNCTION "performance"."assert_form_template_version_is_published"(
  "p_form_version_id" INTEGER,
  "p_job_level_prefix" "performance"."PerfJobLevelPrefix"
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  "version_status" "performance"."PerfFormTemplateVersionStatus";
BEGIN
  SELECT "status" INTO "version_status"
  FROM "performance"."perf_form_template_versions"
  WHERE "id" = "p_form_version_id"
    AND "job_level_prefix" = "p_job_level_prefix"
  FOR SHARE;

  IF "version_status" IS NULL THEN
    RAISE EXCEPTION 'bound form template version or job level prefix does not exist';
  END IF;
  IF "version_status" <> 'PUBLISHED' THEN
    RAISE EXCEPTION 'config template can only bind a published form template version';
  END IF;
END;
$$;

CREATE FUNCTION "performance"."guard_config_form_binding_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM "performance"."assert_config_template_version_is_draft"(OLD."config_version_id");
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM "performance"."assert_config_template_version_is_draft"(NEW."config_version_id");
    PERFORM "performance"."assert_form_template_version_is_published"(
      NEW."form_template_version_id",
      NEW."job_level_prefix"
    );
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "perf_config_form_bindings_guard_mutation"
BEFORE INSERT OR UPDATE OR DELETE ON "performance"."perf_config_form_bindings"
FOR EACH ROW EXECUTE FUNCTION "performance"."guard_config_form_binding_mutation"();
