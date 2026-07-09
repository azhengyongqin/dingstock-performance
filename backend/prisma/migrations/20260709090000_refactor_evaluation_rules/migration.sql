-- 本次重构明确不迁移旧绩效业务数据：保留飞书同步主数据、角色授权和系统参数，绩效配置/流程数据由 seed 重新写入。
TRUNCATE TABLE
  "performance"."perf_templates",
  "performance"."perf_cycles",
  "performance"."perf_participants",
  "performance"."perf_reviewer_assignments",
  "performance"."perf_self_reviews",
  "performance"."perf_reviews",
  "performance"."perf_manager_reviews",
  "performance"."perf_ai_reports",
  "performance"."perf_calibrations",
  "performance"."perf_results",
  "performance"."perf_appeals",
  "performance"."perf_interviews",
  "performance"."perf_notifications",
  "performance"."audit_logs",
  "performance"."report_export_tasks"
RESTART IDENTITY CASCADE;

ALTER TABLE "performance"."perf_scoring_rules"
  RENAME TO "perf_evaluation_rules";

ALTER TABLE "performance"."perf_evaluation_rules"
  RENAME CONSTRAINT "perf_scoring_rules_pkey" TO "perf_evaluation_rules_pkey";

ALTER TABLE "performance"."perf_evaluation_rules"
  RENAME CONSTRAINT "perf_scoring_rules_cycle_id_fkey" TO "perf_evaluation_rules_cycle_id_fkey";

ALTER INDEX "performance"."perf_scoring_rules_cycle_id_key"
  RENAME TO "perf_evaluation_rules_cycle_id_key";

ALTER TABLE "performance"."perf_templates"
  DROP COLUMN "distribution";

ALTER TABLE "performance"."perf_evaluation_rules"
  DROP COLUMN "distribution";
