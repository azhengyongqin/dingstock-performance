-- CreateEnum
CREATE TYPE "performance"."PerfCycleType" AS ENUM ('SEMI_ANNUAL', 'QUARTERLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "performance"."PerfCycleStatus" AS ENUM ('DRAFT', 'PENDING', 'SELF_REVIEW', 'REVIEWING', 'AI_ANALYZING', 'CALIBRATING', 'CONFIRMING', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "performance"."PerfParticipantStatus" AS ENUM ('PENDING_SELF_REVIEW', 'SELF_SUBMITTED', 'RETURNED', 'REVIEWED', 'AI_DONE', 'CALIBRATED', 'RESULT_PUSHED', 'CONFIRMED', 'APPEALING', 'RE_CONFIRMING', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "performance"."PerfDimensionType" AS ENUM ('REGULAR', 'PROMOTION', 'TEXT', 'METRIC');

-- CreateEnum
CREATE TYPE "performance"."PerfScoringMethod" AS ENUM ('LEVEL', 'SCORE', 'CONCLUSION', 'TEXT');

-- CreateEnum
CREATE TYPE "performance"."PerfRole" AS ENUM ('EMPLOYEE', 'REVIEWER', 'LEADER', 'HR', 'ADMIN');

-- CreateEnum
CREATE TYPE "performance"."PerfReviewerRelation" AS ENUM ('LEADER', 'PEER', 'CROSS_DEPT', 'ORG_OWNER', 'PROJECT_OWNER');

-- CreateEnum
CREATE TYPE "performance"."PerfReviewerSource" AS ENUM ('RECOMMENDED', 'LEADER_ASSIGNED', 'HR_ASSIGNED');

-- CreateEnum
CREATE TYPE "performance"."PerfAssignmentStatus" AS ENUM ('PENDING', 'SUBMITTED', 'REPLACED');

-- CreateEnum
CREATE TYPE "performance"."PerfSelfReviewStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'RETURNED');

-- CreateEnum
CREATE TYPE "performance"."PerfReviewStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "performance"."PerfAiReportStatus" AS ENUM ('PENDING', 'GENERATING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "performance"."PerfAiReviewAction" AS ENUM ('ADOPTED', 'IGNORED', 'EDITED');

-- CreateEnum
CREATE TYPE "performance"."PerfAppealStatus" AS ENUM ('PENDING', 'IN_INTERVIEW', 'RESOLVED');

-- CreateEnum
CREATE TYPE "performance"."PerfInterviewType" AS ENUM ('APPEAL', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "performance"."PerfNotificationChannel" AS ENUM ('BOT_DM', 'CARD', 'GROUP_BOT');

-- CreateEnum
CREATE TYPE "performance"."PerfNotificationStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'RETRYING');

-- CreateEnum
CREATE TYPE "performance"."ReportExportStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "performance"."perf_cycles" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "performance"."PerfCycleType" NOT NULL DEFAULT 'SEMI_ANNUAL',
    "status" "performance"."PerfCycleStatus" NOT NULL DEFAULT 'DRAFT',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "owner_open_id" TEXT NOT NULL,
    "windows" JSONB,
    "notification_rules" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "perf_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance"."perf_scoring_rules" (
    "id" SERIAL NOT NULL,
    "cycle_id" INTEGER NOT NULL,
    "levels" JSONB NOT NULL,
    "distribution" JSONB,
    "comment_required_rules" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perf_scoring_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance"."perf_dimensions" (
    "id" SERIAL NOT NULL,
    "cycle_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" "performance"."PerfDimensionType" NOT NULL DEFAULT 'REGULAR',
    "scoring_method" "performance"."PerfScoringMethod" NOT NULL DEFAULT 'LEVEL',
    "weight" DECIMAL(5,2),
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "visible_roles" "performance"."PerfRole"[] DEFAULT ARRAY[]::"performance"."PerfRole"[],
    "editable_roles" "performance"."PerfRole"[] DEFAULT ARRAY[]::"performance"."PerfRole"[],
    "form_schema" JSONB,
    "applicable_scope" JSONB,
    "conclusion_options" JSONB,
    "employee_visible" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "perf_dimensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance"."perf_participants" (
    "id" SERIAL NOT NULL,
    "cycle_id" INTEGER NOT NULL,
    "employee_open_id" TEXT NOT NULL,
    "leader_open_id_snapshot" TEXT,
    "department_id_snapshot" TEXT,
    "job_level_snapshot" JSONB,
    "is_promotion_enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "performance"."PerfParticipantStatus" NOT NULL DEFAULT 'PENDING_SELF_REVIEW',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perf_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance"."perf_reviewer_assignments" (
    "id" SERIAL NOT NULL,
    "cycle_id" INTEGER NOT NULL,
    "participant_id" INTEGER NOT NULL,
    "reviewer_open_id" TEXT NOT NULL,
    "relation" "performance"."PerfReviewerRelation" NOT NULL,
    "source" "performance"."PerfReviewerSource" NOT NULL,
    "recommend_reason" TEXT,
    "status" "performance"."PerfAssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perf_reviewer_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance"."perf_self_reviews" (
    "id" SERIAL NOT NULL,
    "participant_id" INTEGER NOT NULL,
    "okr_content" JSONB,
    "summary" JSONB,
    "promotion_self_review" JSONB,
    "attachments" JSONB,
    "document_token" TEXT,
    "status" "performance"."PerfSelfReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "return_reason" TEXT,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perf_self_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance"."perf_reviews" (
    "id" SERIAL NOT NULL,
    "participant_id" INTEGER NOT NULL,
    "reviewer_open_id" TEXT NOT NULL,
    "dimension_scores" JSONB,
    "comments" TEXT,
    "promotion_feedback" JSONB,
    "status" "performance"."PerfReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perf_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance"."perf_manager_reviews" (
    "id" SERIAL NOT NULL,
    "participant_id" INTEGER NOT NULL,
    "leader_open_id" TEXT NOT NULL,
    "dimension_scores" JSONB,
    "overall_comment" TEXT,
    "initial_level" TEXT,
    "promotion_conclusion" TEXT,
    "status" "performance"."PerfReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perf_manager_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance"."perf_ai_reports" (
    "id" SERIAL NOT NULL,
    "participant_id" INTEGER NOT NULL,
    "status" "performance"."PerfAiReportStatus" NOT NULL DEFAULT 'PENDING',
    "summary" TEXT,
    "highlights" JSONB,
    "improvements" JSONB,
    "promotion_summary" TEXT,
    "risk_flags" JSONB,
    "inputs_digest" JSONB,
    "error_message" TEXT,
    "generated_at" TIMESTAMP(3),
    "reviewed_by_open_id" TEXT,
    "reviewed_action" "performance"."PerfAiReviewAction",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perf_ai_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance"."perf_calibrations" (
    "id" SERIAL NOT NULL,
    "participant_id" INTEGER NOT NULL,
    "before_level" TEXT,
    "after_level" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "operator_open_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "perf_calibrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance"."perf_results" (
    "id" SERIAL NOT NULL,
    "participant_id" INTEGER NOT NULL,
    "final_level" TEXT NOT NULL,
    "dimension_results" JSONB,
    "promotion_result" TEXT,
    "confirmed_by_employee" BOOLEAN NOT NULL DEFAULT false,
    "confirmed_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perf_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance"."perf_appeals" (
    "id" SERIAL NOT NULL,
    "participant_id" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "attachments" JSONB,
    "status" "performance"."PerfAppealStatus" NOT NULL DEFAULT 'PENDING',
    "handler_open_id" TEXT,
    "conclusion" TEXT,
    "result_adjusted" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perf_appeals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance"."perf_interviews" (
    "id" SERIAL NOT NULL,
    "participant_id" INTEGER NOT NULL,
    "appeal_id" INTEGER,
    "type" "performance"."PerfInterviewType" NOT NULL,
    "participant_open_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "content" TEXT,
    "employee_feedback" TEXT,
    "conclusion" TEXT,
    "result_adjusted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perf_interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance"."perf_notifications" (
    "id" SERIAL NOT NULL,
    "receiver_open_id" TEXT NOT NULL,
    "channel" "performance"."PerfNotificationChannel" NOT NULL,
    "template" TEXT NOT NULL,
    "payload" JSONB,
    "status" "performance"."PerfNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perf_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance"."audit_logs" (
    "id" SERIAL NOT NULL,
    "operator_open_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance"."role_grants" (
    "id" SERIAL NOT NULL,
    "user_open_id" TEXT NOT NULL,
    "role" "performance"."PerfRole" NOT NULL,
    "org_scope" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "granted_by_open_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance"."system_configs" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updated_by_open_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance"."report_export_tasks" (
    "id" SERIAL NOT NULL,
    "cycle_id" INTEGER,
    "type" TEXT NOT NULL,
    "params" JSONB,
    "status" "performance"."ReportExportStatus" NOT NULL DEFAULT 'PENDING',
    "file_path" TEXT,
    "error_message" TEXT,
    "operator_open_id" TEXT NOT NULL,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_export_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "perf_cycles_status_idx" ON "performance"."perf_cycles"("status");

-- CreateIndex
CREATE INDEX "perf_cycles_deleted_at_idx" ON "performance"."perf_cycles"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "perf_scoring_rules_cycle_id_key" ON "performance"."perf_scoring_rules"("cycle_id");

-- CreateIndex
CREATE INDEX "perf_dimensions_cycle_id_type_idx" ON "performance"."perf_dimensions"("cycle_id", "type");

-- CreateIndex
CREATE INDEX "perf_dimensions_deleted_at_idx" ON "performance"."perf_dimensions"("deleted_at");

-- CreateIndex
CREATE INDEX "perf_participants_cycle_id_status_idx" ON "performance"."perf_participants"("cycle_id", "status");

-- CreateIndex
CREATE INDEX "perf_participants_cycle_id_leader_open_id_snapshot_idx" ON "performance"."perf_participants"("cycle_id", "leader_open_id_snapshot");

-- CreateIndex
CREATE INDEX "perf_participants_employee_open_id_idx" ON "performance"."perf_participants"("employee_open_id");

-- CreateIndex
CREATE UNIQUE INDEX "perf_participants_cycle_id_employee_open_id_key" ON "performance"."perf_participants"("cycle_id", "employee_open_id");

-- CreateIndex
CREATE INDEX "perf_reviewer_assignments_reviewer_open_id_status_idx" ON "performance"."perf_reviewer_assignments"("reviewer_open_id", "status");

-- CreateIndex
CREATE INDEX "perf_reviewer_assignments_participant_id_idx" ON "performance"."perf_reviewer_assignments"("participant_id");

-- CreateIndex
CREATE INDEX "perf_reviewer_assignments_cycle_id_idx" ON "performance"."perf_reviewer_assignments"("cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "perf_self_reviews_participant_id_key" ON "performance"."perf_self_reviews"("participant_id");

-- CreateIndex
CREATE INDEX "perf_reviews_reviewer_open_id_idx" ON "performance"."perf_reviews"("reviewer_open_id");

-- CreateIndex
CREATE UNIQUE INDEX "perf_reviews_participant_id_reviewer_open_id_key" ON "performance"."perf_reviews"("participant_id", "reviewer_open_id");

-- CreateIndex
CREATE UNIQUE INDEX "perf_manager_reviews_participant_id_key" ON "performance"."perf_manager_reviews"("participant_id");

-- CreateIndex
CREATE INDEX "perf_manager_reviews_leader_open_id_idx" ON "performance"."perf_manager_reviews"("leader_open_id");

-- CreateIndex
CREATE UNIQUE INDEX "perf_ai_reports_participant_id_key" ON "performance"."perf_ai_reports"("participant_id");

-- CreateIndex
CREATE INDEX "perf_ai_reports_status_idx" ON "performance"."perf_ai_reports"("status");

-- CreateIndex
CREATE INDEX "perf_calibrations_participant_id_idx" ON "performance"."perf_calibrations"("participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "perf_results_participant_id_key" ON "performance"."perf_results"("participant_id");

-- CreateIndex
CREATE INDEX "perf_appeals_participant_id_idx" ON "performance"."perf_appeals"("participant_id");

-- CreateIndex
CREATE INDEX "perf_appeals_status_idx" ON "performance"."perf_appeals"("status");

-- CreateIndex
CREATE INDEX "perf_appeals_handler_open_id_idx" ON "performance"."perf_appeals"("handler_open_id");

-- CreateIndex
CREATE INDEX "perf_interviews_participant_id_idx" ON "performance"."perf_interviews"("participant_id");

-- CreateIndex
CREATE INDEX "perf_interviews_appeal_id_idx" ON "performance"."perf_interviews"("appeal_id");

-- CreateIndex
CREATE INDEX "perf_notifications_receiver_open_id_idx" ON "performance"."perf_notifications"("receiver_open_id");

-- CreateIndex
CREATE INDEX "perf_notifications_status_idx" ON "performance"."perf_notifications"("status");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "performance"."audit_logs"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_logs_operator_open_id_idx" ON "performance"."audit_logs"("operator_open_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "performance"."audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "role_grants_user_open_id_role_key" ON "performance"."role_grants"("user_open_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "system_configs_key_key" ON "performance"."system_configs"("key");

-- CreateIndex
CREATE INDEX "report_export_tasks_operator_open_id_idx" ON "performance"."report_export_tasks"("operator_open_id");

-- CreateIndex
CREATE INDEX "report_export_tasks_status_idx" ON "performance"."report_export_tasks"("status");

-- CreateIndex
CREATE INDEX "report_export_tasks_cycle_id_idx" ON "performance"."report_export_tasks"("cycle_id");

-- AddForeignKey
ALTER TABLE "performance"."perf_scoring_rules" ADD CONSTRAINT "perf_scoring_rules_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "performance"."perf_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_dimensions" ADD CONSTRAINT "perf_dimensions_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "performance"."perf_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_participants" ADD CONSTRAINT "perf_participants_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "performance"."perf_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_reviewer_assignments" ADD CONSTRAINT "perf_reviewer_assignments_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "performance"."perf_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_reviewer_assignments" ADD CONSTRAINT "perf_reviewer_assignments_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "performance"."perf_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_self_reviews" ADD CONSTRAINT "perf_self_reviews_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "performance"."perf_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_reviews" ADD CONSTRAINT "perf_reviews_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "performance"."perf_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_manager_reviews" ADD CONSTRAINT "perf_manager_reviews_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "performance"."perf_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_ai_reports" ADD CONSTRAINT "perf_ai_reports_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "performance"."perf_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_calibrations" ADD CONSTRAINT "perf_calibrations_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "performance"."perf_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_results" ADD CONSTRAINT "perf_results_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "performance"."perf_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_appeals" ADD CONSTRAINT "perf_appeals_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "performance"."perf_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_interviews" ADD CONSTRAINT "perf_interviews_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "performance"."perf_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_interviews" ADD CONSTRAINT "perf_interviews_appeal_id_fkey" FOREIGN KEY ("appeal_id") REFERENCES "performance"."perf_appeals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."report_export_tasks" ADD CONSTRAINT "report_export_tasks_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "performance"."perf_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
