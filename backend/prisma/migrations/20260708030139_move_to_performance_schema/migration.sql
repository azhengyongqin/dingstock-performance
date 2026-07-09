-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "performance";

-- CreateTable
CREATE TABLE "performance"."lark_users" (
    "open_id" TEXT NOT NULL,
    "union_id" TEXT,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "en_name" TEXT,
    "nickname" TEXT,
    "email" TEXT,
    "mobile" TEXT,
    "mobile_visible" BOOLEAN,
    "gender" INTEGER,
    "avatar" JSONB,
    "status" JSONB,
    "department_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "leader_user_id" TEXT,
    "city" TEXT,
    "country" TEXT,
    "work_station" TEXT,
    "join_time" INTEGER,
    "is_tenant_manager" BOOLEAN,
    "employee_no" TEXT,
    "employee_type" INTEGER,
    "positions" JSONB,
    "orders" JSONB,
    "custom_attrs" JSONB,
    "enterprise_email" TEXT,
    "time_zone" TEXT,
    "description" TEXT,
    "job_title" TEXT,
    "geo" TEXT,
    "job_level_id" TEXT,
    "job_family_id" TEXT,
    "assign_info" JSONB,
    "department_path" JSONB,
    "dotted_line_leader_user_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lark_users_pkey" PRIMARY KEY ("open_id")
);

-- CreateTable
CREATE TABLE "performance"."lark_departments" (
    "open_department_id" TEXT NOT NULL,
    "department_id" TEXT,
    "name" TEXT NOT NULL,
    "i18n_name" JSONB,
    "parent_department_id" TEXT NOT NULL,
    "leader_user_id" TEXT,
    "chat_id" TEXT,
    "order" TEXT,
    "unit_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "member_count" INTEGER,
    "status" JSONB,
    "leaders" JSONB,
    "group_chat_employee_types" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "department_hrbps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "primary_member_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lark_departments_pkey" PRIMARY KEY ("open_department_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lark_users_union_id_key" ON "performance"."lark_users"("union_id");

-- CreateIndex
CREATE UNIQUE INDEX "lark_users_user_id_key" ON "performance"."lark_users"("user_id");

-- CreateIndex
CREATE INDEX "lark_departments_parent_department_id_idx" ON "performance"."lark_departments"("parent_department_id");
