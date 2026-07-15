-- Ticket 18：结构变更时旧答卷及无法兼容的答案必须原样保留，但不能继续参与当前计算。
ALTER TYPE "performance"."PerfReviewStatus" ADD VALUE 'INVALIDATED';
