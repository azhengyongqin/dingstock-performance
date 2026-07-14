-- 周期状态只保留粗粒度生命周期；旧细粒度进行中状态统一收敛为 ACTIVE。
ALTER TABLE "performance"."perf_cycles"
  ALTER COLUMN "status" DROP DEFAULT;

ALTER TYPE "performance"."PerfCycleStatus"
  RENAME TO "PerfCycleStatus_old";

CREATE TYPE "performance"."PerfCycleStatus"
  AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'ARCHIVED');

ALTER TABLE "performance"."perf_cycles"
  ALTER COLUMN "status"
  TYPE "performance"."PerfCycleStatus"
  USING (
    CASE "status"::TEXT
      WHEN 'DRAFT' THEN 'DRAFT'
      -- 旧 PENDING 没有新版快照与计划锚点，迁回草稿后由 HR 重新配置，不能伪装成已通过检查。
      WHEN 'PENDING' THEN 'DRAFT'
      WHEN 'SELF_REVIEW' THEN 'ACTIVE'
      WHEN 'REVIEWING' THEN 'ACTIVE'
      WHEN 'AI_ANALYZING' THEN 'ACTIVE'
      WHEN 'CALIBRATING' THEN 'ACTIVE'
      WHEN 'CONFIRMING' THEN 'ACTIVE'
      WHEN 'ARCHIVED' THEN 'ARCHIVED'
    END
  )::"performance"."PerfCycleStatus";

ALTER TABLE "performance"."perf_cycles"
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

DROP TYPE "performance"."PerfCycleStatus_old";

-- 新版周期由名称表达业务期间；旧起止日期保留为可空兼容字段。
ALTER TABLE "performance"."perf_cycles"
  ALTER COLUMN "start_date" DROP NOT NULL,
  ALTER COLUMN "end_date" DROP NOT NULL,
  ADD COLUMN "planned_start_at" TIMESTAMP(3),
  ADD COLUMN "current_config_version_id" INTEGER;

CREATE TABLE "performance"."perf_cycle_config_versions" (
  "id" SERIAL NOT NULL,
  "cycle_id" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "source_config_template_version_id" INTEGER,
  "self_stage_mode" "performance"."PerfStageResultMode" NOT NULL,
  "peer_stage_mode" "performance"."PerfStageResultMode" NOT NULL,
  "manager_stage_mode" "performance"."PerfStageResultMode" NOT NULL,
  "ai_stage_mode" "performance"."PerfStageResultMode" NOT NULL,
  "ratings" JSONB NOT NULL,
  "constraint_profiles" JSONB NOT NULL,
  "org_owner_weight" DECIMAL(5,2) NOT NULL,
  "project_owner_weight" DECIMAL(5,2) NOT NULL,
  "peer_weight" DECIMAL(5,2) NOT NULL,
  "cross_dept_weight" DECIMAL(5,2) NOT NULL,
  "schedule_preset" JSONB NOT NULL,
  "notification_rules" JSONB NOT NULL,
  "created_by_open_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "perf_cycle_config_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_cycle_config_versions_version_positive_check"
    CHECK ("version" > 0),
  CONSTRAINT "perf_cycle_config_versions_stage_modes_check"
    CHECK (
      "self_stage_mode" = 'DIRECT_RATING'
      AND "ai_stage_mode" = 'DIRECT_RATING'
      AND "peer_stage_mode" IN ('WEIGHTED_RATING', 'WEIGHTED_SCORE')
      AND "manager_stage_mode" IN ('WEIGHTED_RATING', 'WEIGHTED_SCORE')
    ),
  CONSTRAINT "perf_cycle_config_versions_ratings_array_check"
    CHECK (jsonb_typeof("ratings") = 'array'),
  CONSTRAINT "perf_cycle_config_versions_constraint_profiles_object_check"
    CHECK (jsonb_typeof("constraint_profiles") = 'object'),
  CONSTRAINT "perf_cycle_config_versions_schedule_preset_object_check"
    CHECK (jsonb_typeof("schedule_preset") = 'object'),
  CONSTRAINT "perf_cycle_config_versions_notification_rules_object_check"
    CHECK (jsonb_typeof("notification_rules") = 'object'),
  -- 草稿调整可暂存 0 权重；进入 SCHEDULED 时由完整性触发器要求四项为正且合计 100。
  CONSTRAINT "perf_cycle_config_versions_relation_weights_range_check"
    CHECK (
      "org_owner_weight" BETWEEN 0 AND 100
      AND "project_owner_weight" BETWEEN 0 AND 100
      AND "peer_weight" BETWEEN 0 AND 100
      AND "cross_dept_weight" BETWEEN 0 AND 100
    )
);

CREATE TABLE "performance"."perf_cycle_form_snapshots" (
  "id" SERIAL NOT NULL,
  "cycle_config_version_id" INTEGER NOT NULL,
  "cycle_id" INTEGER NOT NULL,
  "job_level_prefix" "performance"."PerfJobLevelPrefix" NOT NULL,
  "source_form_template_version_id" INTEGER NOT NULL,
  "content" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "perf_cycle_form_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_cycle_form_snapshots_content_object_check"
    CHECK (jsonb_typeof("content") = 'object'),
  CONSTRAINT "perf_cycle_form_snapshots_content_shape_check"
    CHECK (
      "content" ? 'schemaVersion'
      AND "content" ? 'subforms'
      AND jsonb_typeof("content" -> 'subforms') = 'array'
    )
);

ALTER TABLE "performance"."perf_participants"
  ADD COLUMN "job_level_prefix_snapshot" "performance"."PerfJobLevelPrefix",
  ADD COLUMN "form_snapshot_id" INTEGER,
  ADD CONSTRAINT "perf_participants_form_snapshot_pair_check"
    CHECK (
      (
        "job_level_prefix_snapshot" IS NULL
        AND "form_snapshot_id" IS NULL
      )
      OR (
        "job_level_prefix_snapshot" IS NOT NULL
        AND "form_snapshot_id" IS NOT NULL
      )
    );

CREATE UNIQUE INDEX "perf_cycle_config_versions_cycle_id_version_key"
  ON "performance"."perf_cycle_config_versions"("cycle_id", "version");

CREATE UNIQUE INDEX "perf_cycle_config_versions_id_cycle_id_key"
  ON "performance"."perf_cycle_config_versions"("id", "cycle_id");

CREATE INDEX "perf_cycle_config_versions_source_config_template_version_i_idx"
  ON "performance"."perf_cycle_config_versions"("source_config_template_version_id");

CREATE UNIQUE INDEX "perf_cycle_form_snapshots_cycle_config_version_id_job_level_key"
  ON "performance"."perf_cycle_form_snapshots"("cycle_config_version_id", "job_level_prefix");

CREATE INDEX "perf_cycle_form_snapshots_cycle_id_idx"
  ON "performance"."perf_cycle_form_snapshots"("cycle_id");

CREATE INDEX "perf_cycle_form_snapshots_source_form_template_version_id_idx"
  ON "performance"."perf_cycle_form_snapshots"("source_form_template_version_id");

CREATE UNIQUE INDEX "perf_cycles_current_config_version_id_key"
  ON "performance"."perf_cycles"("current_config_version_id");

DROP INDEX "performance"."perf_cycles_status_idx";

CREATE INDEX "perf_cycles_status_planned_start_at_idx"
  ON "performance"."perf_cycles"("status", "planned_start_at");

CREATE INDEX "perf_participants_cycle_id_job_level_prefix_snapshot_idx"
  ON "performance"."perf_participants"("cycle_id", "job_level_prefix_snapshot");

CREATE INDEX "perf_participants_form_snapshot_id_idx"
  ON "performance"."perf_participants"("form_snapshot_id");

ALTER TABLE "performance"."perf_cycle_config_versions"
  ADD CONSTRAINT "perf_cycle_config_versions_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "performance"."perf_cycles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "performance"."perf_cycle_config_versions"
  ADD CONSTRAINT "perf_cycle_config_versions_source_config_template_version__fkey"
  FOREIGN KEY ("source_config_template_version_id")
  REFERENCES "performance"."perf_config_template_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "performance"."perf_cycle_form_snapshots"
  ADD CONSTRAINT "perf_cycle_form_snapshots_cycle_config_version_id_cycle_id_fkey"
  FOREIGN KEY ("cycle_config_version_id", "cycle_id")
  REFERENCES "performance"."perf_cycle_config_versions"("id", "cycle_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "performance"."perf_cycle_form_snapshots"
  ADD CONSTRAINT "perf_cycle_form_snapshots_source_form_template_version_id_fkey"
  FOREIGN KEY ("source_form_template_version_id")
  REFERENCES "performance"."perf_form_template_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "performance"."perf_cycles"
  ADD CONSTRAINT "perf_cycles_current_config_version_id_fkey"
  FOREIGN KEY ("current_config_version_id")
  REFERENCES "performance"."perf_cycle_config_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "performance"."perf_participants"
  ADD CONSTRAINT "perf_participants_form_snapshot_id_fkey"
  FOREIGN KEY ("form_snapshot_id")
  REFERENCES "performance"."perf_cycle_form_snapshots"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 当前配置指针必须属于本周期；任何 SCHEDULED 周期都必须走新版快照。
CREATE FUNCTION "performance"."guard_cycle_current_config_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."current_config_version_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "performance"."perf_cycle_config_versions" AS config_version
    WHERE config_version."id" = NEW."current_config_version_id"
      AND config_version."cycle_id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'current cycle config version must belong to the same cycle';
  END IF;

  IF NEW."status" = 'SCHEDULED'
    AND (
      NEW."planned_start_at" IS NULL
      OR NEW."current_config_version_id" IS NULL
    ) THEN
    RAISE EXCEPTION 'scheduled cycle requires planned start time and current config version';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "perf_cycles_guard_current_config_version"
BEFORE INSERT OR UPDATE OF "status", "current_config_version_id", "planned_start_at"
ON "performance"."perf_cycles"
FOR EACH ROW EXECUTE FUNCTION "performance"."guard_cycle_current_config_version"();

-- 配置快照复制时来源必须仍为已发布版本；来源之后归档不影响已经独立保存的周期快照。
CREATE FUNCTION "performance"."guard_cycle_config_version_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cycle_status "performance"."PerfCycleStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT cycle."status" INTO cycle_status
    FROM "performance"."perf_cycles" AS cycle
    WHERE cycle."id" = OLD."cycle_id";

    IF cycle_status IN ('ACTIVE', 'ARCHIVED') THEN
      RAISE EXCEPTION 'active or archived cycle config versions are immutable';
    END IF;
    RETURN OLD;
  END IF;

  SELECT cycle."status" INTO cycle_status
  FROM "performance"."perf_cycles" AS cycle
  WHERE cycle."id" = NEW."cycle_id";

  IF cycle_status = 'ARCHIVED' THEN
    RAISE EXCEPTION 'archived cycle cannot create or modify config versions';
  END IF;

  IF TG_OP = 'UPDATE' AND cycle_status = 'ACTIVE' THEN
    RAISE EXCEPTION 'active cycle config versions cannot be modified in place';
  END IF;

  IF TG_OP = 'UPDATE' AND ROW(
    NEW."cycle_id", NEW."version", NEW."created_by_open_id", NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."cycle_id", OLD."version", OLD."created_by_open_id", OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'cycle config version identity is immutable';
  END IF;

  IF NEW."source_config_template_version_id" IS NOT NULL
    AND (
      TG_OP = 'INSERT'
      OR NEW."source_config_template_version_id" IS DISTINCT FROM OLD."source_config_template_version_id"
    ) THEN
    PERFORM 1
    FROM "performance"."perf_config_template_versions" AS source_version
    WHERE source_version."id" = NEW."source_config_template_version_id"
      AND source_version."status" = 'PUBLISHED'
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'cycle config source must be a published config template version';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "perf_cycle_config_versions_guard_mutation"
BEFORE INSERT OR UPDATE OR DELETE
ON "performance"."perf_cycle_config_versions"
FOR EACH ROW EXECUTE FUNCTION "performance"."guard_cycle_config_version_mutation"();

-- 表单快照必须来自来源配置的精确绑定；表单后来归档不影响已发布配置继续创建周期。
CREATE FUNCTION "performance"."guard_cycle_form_snapshot_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cycle_status "performance"."PerfCycleStatus";
  current_config_version_id INTEGER;
  source_prefix "performance"."PerfJobLevelPrefix";
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT cycle."status", cycle."current_config_version_id"
    INTO cycle_status, current_config_version_id
    FROM "performance"."perf_cycles" AS cycle
    WHERE cycle."id" = OLD."cycle_id";

    IF cycle_status IN ('ACTIVE', 'ARCHIVED') THEN
      RAISE EXCEPTION 'active or archived cycle form snapshots are immutable';
    END IF;
    RETURN OLD;
  END IF;

  SELECT cycle."status", cycle."current_config_version_id"
  INTO cycle_status, current_config_version_id
  FROM "performance"."perf_cycles" AS cycle
  WHERE cycle."id" = NEW."cycle_id";

  IF cycle_status = 'ARCHIVED'
    OR (
      cycle_status = 'ACTIVE'
      AND (
        TG_OP = 'UPDATE'
        OR current_config_version_id = NEW."cycle_config_version_id"
      )
    ) THEN
    RAISE EXCEPTION 'current active or archived cycle form snapshots are immutable';
  END IF;

  IF TG_OP = 'INSERT'
    OR NEW."source_form_template_version_id" IS DISTINCT FROM OLD."source_form_template_version_id"
    OR NEW."job_level_prefix" IS DISTINCT FROM OLD."job_level_prefix" THEN
    SELECT form_source."job_level_prefix"
    INTO source_prefix
    FROM "performance"."perf_form_template_versions" AS form_source
    JOIN "performance"."perf_config_form_bindings" AS binding
      ON binding."form_template_version_id" = form_source."id"
      AND binding."job_level_prefix" = NEW."job_level_prefix"
    JOIN "performance"."perf_cycle_config_versions" AS cycle_config
      ON cycle_config."id" = NEW."cycle_config_version_id"
      AND cycle_config."source_config_template_version_id" = binding."config_version_id"
    WHERE form_source."id" = NEW."source_form_template_version_id"
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'cycle form snapshot source must match the published config binding';
    END IF;
    IF source_prefix <> NEW."job_level_prefix" THEN
      RAISE EXCEPTION 'cycle form snapshot prefix must match source form version';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "perf_cycle_form_snapshots_guard_mutation"
BEFORE INSERT OR UPDATE OR DELETE
ON "performance"."perf_cycle_form_snapshots"
FOR EACH ROW EXECUTE FUNCTION "performance"."guard_cycle_form_snapshot_mutation"();

-- 参与人只能绑定本周期且职级前缀一致的表单快照；是否为 current 由可延迟事务约束统一检查。
CREATE FUNCTION "performance"."guard_participant_form_snapshot_binding"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot_cycle_id INTEGER;
  snapshot_prefix "performance"."PerfJobLevelPrefix";
BEGIN
  IF NEW."form_snapshot_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT snapshot."cycle_id", snapshot."job_level_prefix"
  INTO snapshot_cycle_id, snapshot_prefix
  FROM "performance"."perf_cycle_form_snapshots" AS snapshot
  WHERE snapshot."id" = NEW."form_snapshot_id";

  IF NOT FOUND
    OR snapshot_cycle_id <> NEW."cycle_id"
    OR snapshot_prefix <> NEW."job_level_prefix_snapshot" THEN
    RAISE EXCEPTION 'participant form snapshot must match cycle and job level prefix';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "perf_participants_guard_form_snapshot_binding"
BEFORE INSERT OR UPDATE OF "cycle_id", "job_level_prefix_snapshot", "form_snapshot_id"
ON "performance"."perf_participants"
FOR EACH ROW EXECUTE FUNCTION "performance"."guard_participant_form_snapshot_binding"();

-- 已绑定参与人的表单快照必须在事务提交时归属 current 版本；允许同一事务中先建快照再整体换绑。
CREATE FUNCTION "performance"."assert_cycle_participant_bindings_current"(
  checked_cycle_id INTEGER
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  current_config_version_id INTEGER;
BEGIN
  SELECT cycle."current_config_version_id"
  INTO current_config_version_id
  FROM "performance"."perf_cycles" AS cycle
  WHERE cycle."id" = checked_cycle_id;

  IF current_config_version_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "performance"."perf_participants" AS participant
    JOIN "performance"."perf_cycle_form_snapshots" AS snapshot
      ON snapshot."id" = participant."form_snapshot_id"
    WHERE participant."cycle_id" = checked_cycle_id
      AND participant."form_snapshot_id" IS NOT NULL
      AND snapshot."cycle_config_version_id" <> current_config_version_id
  ) THEN
    RAISE EXCEPTION 'participant form snapshots must belong to current cycle config version';
  END IF;
END;
$$;

-- SCHEDULED 是可编辑但始终完整的状态；检查在事务提交时执行，避免多表替换过程的中间态误报。
CREATE FUNCTION "performance"."assert_cycle_schedule_ready"(
  checked_cycle_id INTEGER
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  checked_cycle "performance"."perf_cycles"%ROWTYPE;
  d_snapshot_count INTEGER;
  m_snapshot_count INTEGER;
  participant_count INTEGER;
BEGIN
  SELECT * INTO checked_cycle
  FROM "performance"."perf_cycles" AS cycle
  WHERE cycle."id" = checked_cycle_id;

  IF NOT FOUND OR checked_cycle."status" <> 'SCHEDULED' THEN
    RETURN;
  END IF;

  IF checked_cycle."planned_start_at" IS NULL THEN
    RAISE EXCEPTION 'scheduled cycle requires planned start time';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "performance"."perf_cycle_config_versions" AS config_version
    WHERE config_version."id" = checked_cycle."current_config_version_id"
      AND config_version."cycle_id" = checked_cycle_id
      AND config_version."source_config_template_version_id" IS NOT NULL
      AND config_version."org_owner_weight" > 0
      AND config_version."project_owner_weight" > 0
      AND config_version."peer_weight" > 0
      AND config_version."cross_dept_weight" > 0
      AND config_version."org_owner_weight"
        + config_version."project_owner_weight"
        + config_version."peer_weight"
        + config_version."cross_dept_weight" = 100
  ) THEN
    RAISE EXCEPTION 'scheduled cycle requires valid current config relation weights';
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE snapshot."job_level_prefix" = 'D'),
    COUNT(*) FILTER (WHERE snapshot."job_level_prefix" = 'M')
  INTO d_snapshot_count, m_snapshot_count
  FROM "performance"."perf_cycle_form_snapshots" AS snapshot
  WHERE snapshot."cycle_config_version_id" = checked_cycle."current_config_version_id";

  IF d_snapshot_count <> 1 OR m_snapshot_count <> 1 THEN
    RAISE EXCEPTION 'scheduled cycle requires exactly one D and one M form snapshot';
  END IF;

  SELECT COUNT(*) INTO participant_count
  FROM "performance"."perf_participants" AS participant
  WHERE participant."cycle_id" = checked_cycle_id;

  IF participant_count = 0 THEN
    RAISE EXCEPTION 'scheduled cycle requires at least one participant';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "performance"."perf_participants" AS participant
    LEFT JOIN "performance"."perf_cycle_form_snapshots" AS snapshot
      ON snapshot."id" = participant."form_snapshot_id"
    WHERE participant."cycle_id" = checked_cycle_id
      AND (
        participant."job_level_prefix_snapshot" IS NULL
        OR participant."form_snapshot_id" IS NULL
        OR snapshot."cycle_config_version_id" <> checked_cycle."current_config_version_id"
        OR snapshot."job_level_prefix" <> participant."job_level_prefix_snapshot"
      )
  ) THEN
    RAISE EXCEPTION 'scheduled cycle participants require exact current form snapshot bindings';
  END IF;
END;
$$;

-- 一个通用可延迟触发器覆盖周期、配置版本、表单快照和参与人四个修改入口。
CREATE FUNCTION "performance"."enforce_cycle_snapshot_consistency"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_cycle_id INTEGER;
  new_cycle_id INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'perf_cycles' THEN
    IF TG_OP <> 'INSERT' THEN
      old_cycle_id := OLD."id";
    END IF;
    IF TG_OP <> 'DELETE' THEN
      new_cycle_id := NEW."id";
    END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN
      old_cycle_id := OLD."cycle_id";
    END IF;
    IF TG_OP <> 'DELETE' THEN
      new_cycle_id := NEW."cycle_id";
    END IF;
  END IF;

  IF old_cycle_id IS NOT NULL THEN
    PERFORM "performance"."assert_cycle_participant_bindings_current"(old_cycle_id);
    PERFORM "performance"."assert_cycle_schedule_ready"(old_cycle_id);
  END IF;
  IF new_cycle_id IS NOT NULL AND new_cycle_id IS DISTINCT FROM old_cycle_id THEN
    PERFORM "performance"."assert_cycle_participant_bindings_current"(new_cycle_id);
    PERFORM "performance"."assert_cycle_schedule_ready"(new_cycle_id);
  END IF;

  -- AFTER 约束触发器忽略返回行，统一返回 NULL。
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "perf_cycles_enforce_snapshot_consistency"
AFTER INSERT OR UPDATE OR DELETE ON "performance"."perf_cycles"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "performance"."enforce_cycle_snapshot_consistency"();

CREATE CONSTRAINT TRIGGER "perf_cycle_config_versions_enforce_snapshot_consistency"
AFTER INSERT OR UPDATE OR DELETE ON "performance"."perf_cycle_config_versions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "performance"."enforce_cycle_snapshot_consistency"();

CREATE CONSTRAINT TRIGGER "perf_cycle_form_snapshots_enforce_snapshot_consistency"
AFTER INSERT OR UPDATE OR DELETE ON "performance"."perf_cycle_form_snapshots"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "performance"."enforce_cycle_snapshot_consistency"();

CREATE CONSTRAINT TRIGGER "perf_participants_enforce_snapshot_consistency"
AFTER INSERT OR UPDATE OR DELETE ON "performance"."perf_participants"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "performance"."enforce_cycle_snapshot_consistency"();
