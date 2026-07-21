-- 申诉主状态收缩为 PENDING / RESOLVED；历史 IN_INTERVIEW 迁回 PENDING（「面谈中」改由关联面谈推导）
-- 须先卸下引用枚举的 CHECK，否则 ALTER COLUMN 会因新旧枚举类型比较失败

UPDATE "performance"."perf_appeals"
SET "status" = 'PENDING'
WHERE "status"::text = 'IN_INTERVIEW';

ALTER TABLE "performance"."perf_appeals"
  ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "performance"."perf_appeals"
  DROP CONSTRAINT IF EXISTS "perf_appeals_resolution_fields_check";

ALTER TYPE "performance"."PerfAppealStatus" RENAME TO "PerfAppealStatus_legacy";

CREATE TYPE "performance"."PerfAppealStatus" AS ENUM ('PENDING', 'RESOLVED');

ALTER TABLE "performance"."perf_appeals"
  ALTER COLUMN "status" TYPE "performance"."PerfAppealStatus"
  USING ("status"::text::"performance"."PerfAppealStatus");

ALTER TABLE "performance"."perf_appeals"
  ALTER COLUMN "status" SET DEFAULT 'PENDING'::"performance"."PerfAppealStatus";

-- 结案字段完整性：RESOLVED ⇔ 有 resolved_at 与非空白 conclusion（与收缩前语义一致）
ALTER TABLE "performance"."perf_appeals"
  ADD CONSTRAINT "perf_appeals_resolution_fields_check"
  CHECK (
    "is_legacy"
    OR (
      ("status" = 'RESOLVED'::"performance"."PerfAppealStatus")
      = (
        ("resolved_at" IS NOT NULL)
        AND ("conclusion" IS NOT NULL)
        AND (btrim("conclusion") <> ''::text)
      )
    )
  );

DROP TYPE "performance"."PerfAppealStatus_legacy";
