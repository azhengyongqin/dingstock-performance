-- Ticket 19：补齐中途退出终态；旧状态的统一迁移仍由 Ticket 20 负责。
ALTER TYPE "performance"."PerfParticipantStatus"
  ADD VALUE IF NOT EXISTS 'WITHDRAWN';

CREATE TABLE "performance"."perf_cycle_archives" (
  "id" SERIAL NOT NULL,
  "cycle_id" INTEGER NOT NULL,
  "operator_open_id" TEXT NOT NULL,
  "summary" JSONB NOT NULL,
  "check_result" JSONB NOT NULL,
  "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "perf_cycle_archives_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "perf_cycle_archives_cycle_id_key" UNIQUE ("cycle_id"),
  CONSTRAINT "perf_cycle_archives_operator_open_id_not_blank"
    CHECK (length(btrim("operator_open_id")) > 0),
  CONSTRAINT "perf_cycle_archives_summary_object"
    CHECK (jsonb_typeof("summary") = 'object'),
  CONSTRAINT "perf_cycle_archives_check_result_object"
    CHECK (jsonb_typeof("check_result") = 'object'),
  CONSTRAINT "perf_cycle_archives_cycle_id_fkey"
    FOREIGN KEY ("cycle_id") REFERENCES "performance"."perf_cycles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "perf_cycle_archives_operator_open_id_idx"
  ON "performance"."perf_cycle_archives"("operator_open_id");
CREATE INDEX "perf_cycle_archives_archived_at_idx"
  ON "performance"."perf_cycle_archives"("archived_at");

-- 归档快照与 ACTIVE -> ARCHIVED 状态必须在同一事务落定。
CREATE FUNCTION "performance"."guard_cycle_archive_insert"()
RETURNS TRIGGER AS $$
DECLARE
  cycle_status "performance"."PerfCycleStatus";
BEGIN
  SELECT "status" INTO cycle_status
  FROM "performance"."perf_cycles"
  WHERE "id" = NEW."cycle_id";
  IF cycle_status IS DISTINCT FROM 'ARCHIVED'::"performance"."PerfCycleStatus" THEN
    RAISE EXCEPTION 'cycle archive snapshot requires ARCHIVED cycle';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "perf_cycle_archives_guard_insert"
BEFORE INSERT ON "performance"."perf_cycle_archives"
FOR EACH ROW EXECUTE FUNCTION "performance"."guard_cycle_archive_insert"();

CREATE FUNCTION "performance"."guard_cycle_archive_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'cycle archive snapshot is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "perf_cycle_archives_guard_update"
BEFORE UPDATE OR DELETE ON "performance"."perf_cycle_archives"
FOR EACH ROW EXECUTE FUNCTION "performance"."guard_cycle_archive_immutable"();

-- 周期只允许 ACTIVE -> ARCHIVED；ARCHIVED 后任何 UPDATE/DELETE 均拒绝。
CREATE FUNCTION "performance"."guard_archived_cycle_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'ARCHIVED'::"performance"."PerfCycleStatus" THEN
      RAISE EXCEPTION 'archived cycle is immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'ARCHIVED'::"performance"."PerfCycleStatus" THEN
    RAISE EXCEPTION 'archived cycle is immutable';
  END IF;
  IF NEW."status" = 'ARCHIVED'::"performance"."PerfCycleStatus"
     AND OLD."status" <> 'ACTIVE'::"performance"."PerfCycleStatus" THEN
    RAISE EXCEPTION 'only ACTIVE cycle can be archived';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "perf_cycles_guard_archived_immutable"
BEFORE UPDATE OR DELETE ON "performance"."perf_cycles"
FOR EACH ROW EXECUTE FUNCTION "performance"."guard_archived_cycle_immutable"();

-- 事务提交前强制 ARCHIVED 周期已有唯一归档快照；允许 service 先更新周期再插入快照。
CREATE FUNCTION "performance"."require_archived_cycle_snapshot"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."status" = 'ARCHIVED'::"performance"."PerfCycleStatus"
     AND NOT EXISTS (
       SELECT 1 FROM "performance"."perf_cycle_archives" archive
       WHERE archive."cycle_id" = NEW."id"
     ) THEN
    RAISE EXCEPTION 'archived cycle requires archive snapshot';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "perf_cycles_require_archive_snapshot"
AFTER INSERT OR UPDATE ON "performance"."perf_cycles"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "performance"."require_archived_cycle_snapshot"();
