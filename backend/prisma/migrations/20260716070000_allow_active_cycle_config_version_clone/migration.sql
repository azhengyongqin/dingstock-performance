-- Ticket 16：ACTIVE 周期通过追加版本修正计算配置。
-- 来源模板后续归档不得阻断周期内的独立版本链；只有“与 current 版本来源相同且版本号连续”的 ACTIVE 追加可复用归档来源。
CREATE OR REPLACE FUNCTION "performance"."guard_cycle_config_version_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cycle_status "performance"."PerfCycleStatus";
  current_config_version_id INTEGER;
  current_version INTEGER;
  current_source_config_template_version_id INTEGER;
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

  SELECT cycle."status", cycle."current_config_version_id"
  INTO cycle_status, current_config_version_id
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

  IF TG_OP = 'INSERT' AND cycle_status = 'ACTIVE' THEN
    SELECT config_version."version", config_version."source_config_template_version_id"
    INTO current_version, current_source_config_template_version_id
    FROM "performance"."perf_cycle_config_versions" AS config_version
    WHERE config_version."id" = current_config_version_id
      AND config_version."cycle_id" = NEW."cycle_id"
    FOR SHARE;

    IF NOT FOUND
      OR NEW."version" <> current_version + 1
      OR NEW."source_config_template_version_id"
        IS DISTINCT FROM current_source_config_template_version_id
    THEN
      RAISE EXCEPTION 'active cycle config version must extend the current version with the same source';
    END IF;

    -- 归档只停止模板的新周期选用，不影响已经复制出的周期继续追加独立配置版本。
    PERFORM 1
    FROM "performance"."perf_config_template_versions" AS source_version
    WHERE source_version."id" = NEW."source_config_template_version_id"
      AND source_version."status" IN ('PUBLISHED', 'ARCHIVED')
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'active cycle config source must retain its published or archived source version';
    END IF;
  ELSIF NEW."source_config_template_version_id" IS NOT NULL
    AND (
      TG_OP = 'INSERT'
      OR NEW."source_config_template_version_id" IS DISTINCT FROM OLD."source_config_template_version_id"
    )
  THEN
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
