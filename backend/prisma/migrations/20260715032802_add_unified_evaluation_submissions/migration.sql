/*
  Warnings:

  - A unique constraint covering the columns `[id,participant_id,reviewer_open_id]` on the table `perf_reviewer_assignments` will be added. If there are existing duplicate values, this will fail.

*/
-- Ticket 06 / ADR-0009 + ADR-0008：统一人工评估提交与关系化评估项结果。
-- 手工补充 Prisma DSL 无法表达的约束：CHECK、部分唯一索引（Postgres partial unique index）与跨表触发器。
-- CreateEnum
CREATE TYPE "performance"."PerfRatingSymbol" AS ENUM ('S', 'A', 'B', 'C');

-- CreateTable
CREATE TABLE "performance"."perf_evaluation_submissions" (
    "id" SERIAL NOT NULL,
    "cycle_id" INTEGER NOT NULL,
    "participant_id" INTEGER NOT NULL,
    "stage" "performance"."PerfEvaluationTaskType" NOT NULL,
    "reviewer_open_id" TEXT NOT NULL,
    "reviewer_assignment_id" INTEGER,
    "form_snapshot_id" INTEGER NOT NULL,
    "status" "performance"."PerfReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMP(3),
    "submitted_by_open_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perf_evaluation_submissions_pkey" PRIMARY KEY ("id"),
    -- AI 评估继续走独立异步任务，不落人工提交表。
    CONSTRAINT "perf_evaluation_submissions_stage_not_ai_check" CHECK ("stage" <> 'AI'),
    -- 只有 360°提交关联评审员指派；自评与上级评估的填写人身份改由下方触发器对齐参与者快照。
    CONSTRAINT "perf_evaluation_submissions_peer_assignment_check" CHECK (
        ("stage" = 'PEER' AND "reviewer_assignment_id" IS NOT NULL)
        OR ("stage" <> 'PEER' AND "reviewer_assignment_id" IS NULL)
    )
);

-- CreateTable
CREATE TABLE "performance"."perf_evaluation_item_results" (
    "id" SERIAL NOT NULL,
    "submission_id" INTEGER NOT NULL,
    "form_snapshot_id" INTEGER NOT NULL,
    "subform_key" TEXT NOT NULL,
    "dimension_key" TEXT NOT NULL,
    "item_key" TEXT NOT NULL,
    "item_type" "performance"."PerfFormItemType" NOT NULL,
    "raw_level" "performance"."PerfRatingSymbol",
    "raw_score" DECIMAL(5,2),
    "calculation_score" DECIMAL(5,2),
    "value" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perf_evaluation_item_results_pkey" PRIMARY KEY ("id"),
    -- 原始评级与原始分数互斥：同一评估项结果只承载对应组件类型的一种原始输入。
    CONSTRAINT "perf_evaluation_item_results_raw_value_exclusive_check" CHECK (
        "raw_level" IS NULL OR "raw_score" IS NULL
    )
);

-- CreateIndex
CREATE INDEX "perf_evaluation_submissions_cycle_id_stage_idx" ON "performance"."perf_evaluation_submissions"("cycle_id", "stage");

-- CreateIndex
CREATE INDEX "perf_evaluation_submissions_participant_id_stage_status_idx" ON "performance"."perf_evaluation_submissions"("participant_id", "stage", "status");

-- CreateIndex
CREATE INDEX "perf_evaluation_submissions_reviewer_open_id_stage_status_idx" ON "performance"."perf_evaluation_submissions"("reviewer_open_id", "stage", "status");

-- CreateIndex
CREATE INDEX "perf_evaluation_submissions_reviewer_assignment_id_idx" ON "performance"."perf_evaluation_submissions"("reviewer_assignment_id");

-- CreateIndex
CREATE INDEX "perf_evaluation_submissions_form_snapshot_id_idx" ON "performance"."perf_evaluation_submissions"("form_snapshot_id");

-- CreateIndex
CREATE UNIQUE INDEX "perf_evaluation_submissions_id_form_snapshot_id_key" ON "performance"."perf_evaluation_submissions"("id", "form_snapshot_id");

-- 部分唯一索引（Postgres partial unique index）：Prisma DSL 无法表达 WHERE 子句，改由迁移手工补充。
-- 同一 (participant_id, stage, reviewer_open_id) 至多一份当前生效提交（SUBMITTED）。
CREATE UNIQUE INDEX "perf_evaluation_submissions_active_submitted_key"
    ON "performance"."perf_evaluation_submissions"("participant_id", "stage", "reviewer_open_id")
    WHERE "status" = 'SUBMITTED';

-- 同一 (participant_id, stage, reviewer_open_id) 至多一份编辑草稿（DRAFT）。
CREATE UNIQUE INDEX "perf_evaluation_submissions_active_draft_key"
    ON "performance"."perf_evaluation_submissions"("participant_id", "stage", "reviewer_open_id")
    WHERE "status" = 'DRAFT';

-- CreateIndex
CREATE INDEX "perf_evaluation_item_results_form_snapshot_id_item_key_idx" ON "performance"."perf_evaluation_item_results"("form_snapshot_id", "item_key");

-- CreateIndex
CREATE INDEX "perf_evaluation_item_results_form_snapshot_id_subform_key_d_idx" ON "performance"."perf_evaluation_item_results"("form_snapshot_id", "subform_key", "dimension_key");

-- CreateIndex
CREATE UNIQUE INDEX "perf_evaluation_item_results_submission_id_item_key_key" ON "performance"."perf_evaluation_item_results"("submission_id", "item_key");

-- CreateIndex
CREATE UNIQUE INDEX "perf_reviewer_assignments_id_participant_id_reviewer_open_i_key" ON "performance"."perf_reviewer_assignments"("id", "participant_id", "reviewer_open_id");

-- AddForeignKey
ALTER TABLE "performance"."perf_evaluation_submissions" ADD CONSTRAINT "perf_evaluation_submissions_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "performance"."perf_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_evaluation_submissions" ADD CONSTRAINT "perf_evaluation_submissions_participant_id_cycle_id_fkey" FOREIGN KEY ("participant_id", "cycle_id") REFERENCES "performance"."perf_participants"("id", "cycle_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_evaluation_submissions" ADD CONSTRAINT "perf_evaluation_submissions_form_snapshot_id_fkey" FOREIGN KEY ("form_snapshot_id") REFERENCES "performance"."perf_cycle_form_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_evaluation_submissions" ADD CONSTRAINT "perf_evaluation_submissions_reviewer_assignment_id_partici_fkey" FOREIGN KEY ("reviewer_assignment_id", "participant_id", "reviewer_open_id") REFERENCES "performance"."perf_reviewer_assignments"("id", "participant_id", "reviewer_open_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_evaluation_item_results" ADD CONSTRAINT "perf_evaluation_item_results_submission_id_form_snapshot_i_fkey" FOREIGN KEY ("submission_id", "form_snapshot_id") REFERENCES "performance"."perf_evaluation_submissions"("id", "form_snapshot_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- reviewer_open_id 单列 + 复合外键只能证明关联存在，触发器进一步保证填写人身份与参与者快照一致：
-- SELF 必须是员工本人；MANAGER 必须匹配考核 Leader 快照（PEER 由上方复合外键锁定评审员指派归属，无需重复校验）。
CREATE FUNCTION "performance"."validate_perf_evaluation_submission_reviewer"()
RETURNS TRIGGER AS $$
DECLARE
    participant_employee_open_id TEXT;
    participant_leader_open_id TEXT;
BEGIN
    IF NEW."stage" = 'SELF' THEN
        SELECT "employee_open_id" INTO participant_employee_open_id
          FROM "performance"."perf_participants"
         WHERE "id" = NEW."participant_id";
        IF participant_employee_open_id IS DISTINCT FROM NEW."reviewer_open_id" THEN
            RAISE EXCEPTION 'self submission reviewer_open_id % must equal participant employee_open_id %',
                NEW."reviewer_open_id", participant_employee_open_id;
        END IF;
    ELSIF NEW."stage" = 'MANAGER' THEN
        SELECT "leader_open_id_snapshot" INTO participant_leader_open_id
          FROM "performance"."perf_participants"
         WHERE "id" = NEW."participant_id";
        IF participant_leader_open_id IS NULL OR participant_leader_open_id IS DISTINCT FROM NEW."reviewer_open_id" THEN
            RAISE EXCEPTION 'manager submission reviewer_open_id % must equal participant leader_open_id_snapshot %',
                NEW."reviewer_open_id", participant_leader_open_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "perf_evaluation_submissions_validate_reviewer"
BEFORE INSERT OR UPDATE OF "stage", "reviewer_open_id", "participant_id"
ON "performance"."perf_evaluation_submissions"
FOR EACH ROW
EXECUTE FUNCTION "performance"."validate_perf_evaluation_submission_reviewer"();
