-- Ticket 10：职责转移前后，MANAGER 当前答卷按参与者全局唯一，不能因填写人变化并存双负责人结果。
-- Prisma DSL 不支持带 WHERE 的部分唯一索引，故在迁移中手工维护。
CREATE UNIQUE INDEX "perf_evaluation_submissions_manager_submitted_key"
    ON "performance"."perf_evaluation_submissions"("participant_id")
    WHERE "stage" = 'MANAGER' AND "status" = 'SUBMITTED';

CREATE UNIQUE INDEX "perf_evaluation_submissions_manager_draft_key"
    ON "performance"."perf_evaluation_submissions"("participant_id")
    WHERE "stage" = 'MANAGER' AND "status" = 'DRAFT';
