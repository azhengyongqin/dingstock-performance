-- Ticket 07：360°指派只允许四类计算关系，排除员工本人/考核 Leader，并收紧跨周期归属。

-- 历史非法指派不物理删除：统一置 REPLACED，保留审计与旧答卷外键。
INSERT INTO "performance"."audit_logs" (
  "operator_open_id", "action", "target_type", "target_id", "before", "after", "reason"
)
SELECT
  'system:migration:ticket-07',
  'reviewer.migration_replace',
  'perf_reviewer_assignment',
  assignment."id"::TEXT,
  jsonb_build_object(
    'reviewerOpenId', assignment."reviewer_open_id",
    'relation', assignment."relation",
    'status', assignment."status"
  ),
  jsonb_build_object('status', 'REPLACED'),
  'Ticket 07 数据修复：移除非法的直属 Leader、员工本人或 LEADER 关系指派'
FROM "performance"."perf_reviewer_assignments" AS assignment
JOIN "performance"."perf_participants" AS participant
  ON participant."id" = assignment."participant_id"
WHERE assignment."status" <> 'REPLACED'
  AND (
    assignment."relation" = 'LEADER'
    OR assignment."reviewer_open_id" = participant."employee_open_id"
    OR assignment."reviewer_open_id" = participant."leader_open_id_snapshot"
  );

UPDATE "performance"."perf_reviewer_assignments" AS assignment
SET "status" = 'REPLACED'
FROM "performance"."perf_participants" AS participant
WHERE participant."id" = assignment."participant_id"
  AND assignment."status" <> 'REPLACED'
  AND (
    assignment."relation" = 'LEADER'
    OR assignment."reviewer_open_id" = participant."employee_open_id"
    OR assignment."reviewer_open_id" = participant."leader_open_id_snapshot"
  );

-- 旧数据若错误冗余了 cycle_id，以参与者聚合根为准纠正后再建立复合外键。
UPDATE "performance"."perf_reviewer_assignments" AS assignment
SET "cycle_id" = participant."cycle_id"
FROM "performance"."perf_participants" AS participant
WHERE participant."id" = assignment."participant_id"
  AND assignment."cycle_id" IS DISTINCT FROM participant."cycle_id";

-- 并发/历史重复有效指派：保留最新一条，其他置 REPLACED。
WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "participant_id", "reviewer_open_id"
           ORDER BY "id" DESC
         ) AS row_number
  FROM "performance"."perf_reviewer_assignments"
  WHERE "status" <> 'REPLACED'
)
INSERT INTO "performance"."audit_logs" (
  "operator_open_id", "action", "target_type", "target_id", "before", "after", "reason"
)
SELECT
  'system:migration:ticket-07',
  'reviewer.migration_replace',
  'perf_reviewer_assignment',
  assignment."id"::TEXT,
  jsonb_build_object(
    'reviewerOpenId', assignment."reviewer_open_id",
    'relation', assignment."relation",
    'status', assignment."status"
  ),
  jsonb_build_object('status', 'REPLACED'),
  'Ticket 07 数据修复：同一参与者与评审员存在重复有效指派'
FROM ranked
JOIN "performance"."perf_reviewer_assignments" AS assignment
  ON assignment."id" = ranked."id"
WHERE ranked.row_number > 1;

WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "participant_id", "reviewer_open_id"
           ORDER BY "id" DESC
         ) AS row_number
  FROM "performance"."perf_reviewer_assignments"
  WHERE "status" <> 'REPLACED'
)
UPDATE "performance"."perf_reviewer_assignments" AS assignment
SET "status" = 'REPLACED'
FROM ranked
WHERE assignment."id" = ranked."id"
  AND ranked.row_number > 1;

ALTER TABLE "performance"."perf_reviewer_assignments"
  DROP CONSTRAINT "perf_reviewer_assignments_participant_id_fkey";

ALTER TABLE "performance"."perf_reviewer_assignments"
  ADD CONSTRAINT "perf_reviewer_assignments_participant_id_cycle_id_fkey"
  FOREIGN KEY ("participant_id", "cycle_id")
  REFERENCES "performance"."perf_participants"("id", "cycle_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- REPLACED 历史行允许保留旧 LEADER 关系；任何当前有效指派都只能使用四类计算关系。
ALTER TABLE "performance"."perf_reviewer_assignments"
  ADD CONSTRAINT "perf_reviewer_assignments_relation_check"
  CHECK ("status" = 'REPLACED' OR "relation" <> 'LEADER');

CREATE UNIQUE INDEX "perf_reviewer_assignments_active_reviewer_key"
  ON "performance"."perf_reviewer_assignments"("participant_id", "reviewer_open_id")
  WHERE "status" <> 'REPLACED';

CREATE FUNCTION "performance"."validate_perf_reviewer_assignment"()
RETURNS TRIGGER AS $$
DECLARE
  participant_employee_open_id TEXT;
  participant_leader_open_id TEXT;
BEGIN
  IF NEW."status" = 'REPLACED' THEN
    RETURN NEW;
  END IF;

  SELECT "employee_open_id", "leader_open_id_snapshot"
    INTO participant_employee_open_id, participant_leader_open_id
    FROM "performance"."perf_participants"
   WHERE "id" = NEW."participant_id" AND "cycle_id" = NEW."cycle_id";

  IF participant_employee_open_id IS NULL THEN
    RAISE EXCEPTION 'reviewer assignment participant/cycle does not exist';
  END IF;
  IF participant_employee_open_id IS NOT DISTINCT FROM NEW."reviewer_open_id" THEN
    RAISE EXCEPTION 'participant employee cannot review self';
  END IF;
  IF participant_leader_open_id IS NOT DISTINCT FROM NEW."reviewer_open_id" THEN
    RAISE EXCEPTION 'participant assessment leader cannot be peer reviewer';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "perf_reviewer_assignments_validate_reviewer"
BEFORE INSERT OR UPDATE OF "participant_id", "cycle_id", "reviewer_open_id", "relation", "status"
ON "performance"."perf_reviewer_assignments"
FOR EACH ROW
EXECUTE FUNCTION "performance"."validate_perf_reviewer_assignment"();
