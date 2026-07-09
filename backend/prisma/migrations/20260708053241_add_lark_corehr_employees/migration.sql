-- CreateTable
CREATE TABLE "performance"."lark_corehr_employees" (
    "open_id" TEXT NOT NULL,
    "employment_id_v2" TEXT,
    "employee_number" TEXT,
    "employee_type_id" TEXT,
    "employee_subtype_id" TEXT,
    "employment_type" JSONB,
    "employment_status" JSONB,
    "effective_date" TEXT,
    "expiration_date" TEXT,
    "reason_for_offboarding" JSONB,
    "primary_employment" BOOLEAN,
    "department_id" TEXT,
    "company_id" TEXT,
    "work_location_id" TEXT,
    "working_hours_type_id" TEXT,
    "cost_center_list" JSONB,
    "job_level_id" TEXT,
    "job_level" JSONB,
    "job_grade_id" TEXT,
    "job_family_id" TEXT,
    "job_family" JSONB,
    "position_id" TEXT,
    "position" JSONB,
    "job_id" TEXT,
    "job" JSONB,
    "direct_manager_id" TEXT,
    "dotted_line_manager_id" TEXT,
    "tenure" TEXT,
    "seniority_date" TEXT,
    "probation_period" INTEGER,
    "on_probation" BOOLEAN,
    "probation_end_date" TEXT,
    "regular_employee_start_date" TEXT,
    "rehire" JSONB,
    "contract_start_date" TEXT,
    "contract_end_date" TEXT,
    "contract_expected_end_date" TEXT,
    "email_address" TEXT,
    "work_email_list" JSONB,
    "avatar_url" TEXT,
    "time_zone" TEXT,
    "custom_fields" JSONB,
    "person_info" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lark_corehr_employees_pkey" PRIMARY KEY ("open_id")
);

-- CreateIndex
CREATE INDEX "lark_corehr_employees_department_id_idx" ON "performance"."lark_corehr_employees"("department_id");

-- CreateIndex
CREATE INDEX "lark_corehr_employees_direct_manager_id_idx" ON "performance"."lark_corehr_employees"("direct_manager_id");

-- AddForeignKey
ALTER TABLE "performance"."lark_corehr_employees" ADD CONSTRAINT "lark_corehr_employees_open_id_fkey" FOREIGN KEY ("open_id") REFERENCES "performance"."lark_users"("open_id") ON DELETE CASCADE ON UPDATE CASCADE;
