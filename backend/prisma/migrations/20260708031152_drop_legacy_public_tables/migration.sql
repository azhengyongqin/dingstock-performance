-- 清理迁移到 performance schema 之前遗留在 public schema 下的旧表快照。
-- 这两张表已不在 Prisma schema 管理范围内（schemas 限定为 performance），
-- 迁移引擎无法感知其存在，需手写 DROP 语句完成清理。
DROP TABLE IF EXISTS "public"."lark_users";
DROP TABLE IF EXISTS "public"."lark_departments";