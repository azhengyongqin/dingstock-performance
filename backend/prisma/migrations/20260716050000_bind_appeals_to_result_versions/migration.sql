-- Ticket 15：申诉精确绑定结果版本，并以数据库约束兜底单次申诉和处理审计链。
ALTER TABLE "performance"."perf_appeals"
  ADD COLUMN "result_version_id" INTEGER,
  ADD COLUMN "resolution_calibration_id" INTEGER,
  ADD COLUMN "is_legacy" BOOLEAN NOT NULL DEFAULT false;

-- 旧系统曾允许二次申诉；保留全部历史事实，但新建申诉必须遵守单次限制。
UPDATE "performance"."perf_appeals" SET "is_legacy" = true;

-- 旧申诉按参与者当前有效版本回填；Ticket 14 已为旧结果迁移版本。
UPDATE "performance"."perf_appeals" AS appeal
SET "result_version_id" = (
  SELECT result_version."id"
  FROM "performance"."perf_result_versions" AS result_version
  WHERE result_version."participant_id" = appeal."participant_id"
  ORDER BY
    (result_version."superseded_at" IS NULL) DESC,
    result_version."version" DESC
  LIMIT 1
);

-- 历史处理记录尽可能关联处理时已有的最新校准决定；缺失决定的旧数据仍以 is_legacy 保留。
UPDATE "performance"."perf_appeals" AS appeal
SET "resolution_calibration_id" = (
  SELECT calibration."id"
  FROM "performance"."perf_calibrations" AS calibration
  WHERE calibration."participant_id" = appeal."participant_id"
    AND calibration."created_at" <= COALESCE(appeal."resolved_at", appeal."updated_at")
  ORDER BY calibration."id" DESC
  LIMIT 1
)
WHERE appeal."status" = 'RESOLVED';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "performance"."perf_appeals"
    WHERE "result_version_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'cannot bind legacy appeal without a result version';
  END IF;
END;
$$;

ALTER TABLE "performance"."perf_appeals"
  ALTER COLUMN "result_version_id" SET NOT NULL,
  ADD CONSTRAINT "perf_appeals_reason_nonblank_check"
    CHECK ("is_legacy" OR btrim("reason") <> ''),
  ADD CONSTRAINT "perf_appeals_resolution_fields_check"
    CHECK (
      "is_legacy" OR ("status" = 'RESOLVED') =
      ("resolved_at" IS NOT NULL AND "conclusion" IS NOT NULL AND btrim("conclusion") <> '')
    ),
  ADD CONSTRAINT "perf_appeals_adjustment_calibration_check"
    CHECK ("is_legacy" OR NOT "result_adjusted" OR "resolution_calibration_id" IS NOT NULL);

-- 复合唯一键让后续复合外键在数据库层验证“版本/决定属于同一参与者”。
CREATE UNIQUE INDEX "perf_result_versions_id_participant_id_key"
  ON "performance"."perf_result_versions"("id", "participant_id");
CREATE UNIQUE INDEX "perf_calibrations_id_participant_id_key"
  ON "performance"."perf_calibrations"("id", "participant_id");
CREATE UNIQUE INDEX "perf_appeals_current_participant_key"
  ON "performance"."perf_appeals"("participant_id")
  WHERE NOT "is_legacy";
CREATE INDEX "perf_appeals_result_version_id_idx"
  ON "performance"."perf_appeals"("result_version_id");
CREATE INDEX "perf_appeals_resolution_calibration_id_idx"
  ON "performance"."perf_appeals"("resolution_calibration_id");

ALTER TABLE "performance"."perf_appeals"
  ADD CONSTRAINT "perf_appeals_result_version_participant_fkey"
  FOREIGN KEY ("result_version_id", "participant_id")
  REFERENCES "performance"."perf_result_versions"("id", "participant_id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "perf_appeals_resolution_calibration_participant_fkey"
  FOREIGN KEY ("resolution_calibration_id", "participant_id")
  REFERENCES "performance"."perf_calibrations"("id", "participant_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 触发器先锁参与者聚合，再检查全部（含 legacy）历史，防止并发插入绕过单次限制。
CREATE OR REPLACE FUNCTION "performance"."reject_second_appeal"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."is_legacy" THEN
    RAISE EXCEPTION 'new appeal cannot be marked legacy';
  END IF;
  PERFORM 1
  FROM "performance"."perf_participants"
  WHERE "id" = NEW."participant_id"
  FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM "performance"."perf_appeals"
    WHERE "participant_id" = NEW."participant_id"
  ) THEN
    RAISE EXCEPTION 'participant already has an appeal';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "perf_appeals_reject_second"
BEFORE INSERT ON "performance"."perf_appeals"
FOR EACH ROW EXECUTE FUNCTION "performance"."reject_second_appeal"();

-- 申诉绑定一经创建不可改写；处理只允许追加结论和处理依据。
CREATE OR REPLACE FUNCTION "performance"."guard_appeal_binding_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."participant_id" <> OLD."participant_id"
    OR NEW."result_version_id" <> OLD."result_version_id"
    OR NEW."reason" <> OLD."reason"
    OR NEW."attachments" IS DISTINCT FROM OLD."attachments"
    OR NEW."is_legacy" <> OLD."is_legacy"
    OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'appeal source binding is immutable';
  END IF;
  IF OLD."status" = 'RESOLVED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'resolved appeal is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "perf_appeals_binding_immutable"
BEFORE UPDATE ON "performance"."perf_appeals"
FOR EACH ROW EXECUTE FUNCTION "performance"."guard_appeal_binding_immutable"();
