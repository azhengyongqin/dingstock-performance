-- 飞书薪资档案同步表：按 tid 保存员工薪资档案的每个历史版本。
CREATE TABLE "performance"."lark_compensation_archives" (
    "tid" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "open_id" TEXT NOT NULL,
    "plan_id" TEXT,
    "plan_tid" TEXT,
    "currency_id" TEXT,
    "change_reason_id" TEXT,
    "change_description" TEXT,
    "effective_date" TEXT NOT NULL,
    "expiration_date" TEXT,
    "salary_level_id" TEXT,
    "created_time" TEXT,
    "updated_time" TEXT,
    "archive_items" JSONB,
    "archive_indicators" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lark_compensation_archives_pkey" PRIMARY KEY ("tid")
);

CREATE INDEX "lark_compensation_archives_open_id_effective_date_idx"
ON "performance"."lark_compensation_archives"("open_id", "effective_date");

CREATE INDEX "lark_compensation_archives_id_idx"
ON "performance"."lark_compensation_archives"("id");

ALTER TABLE "performance"."lark_compensation_archives"
ADD CONSTRAINT "lark_compensation_archives_open_id_fkey"
FOREIGN KEY ("open_id") REFERENCES "performance"."lark_users"("open_id")
ON DELETE CASCADE ON UPDATE CASCADE;
