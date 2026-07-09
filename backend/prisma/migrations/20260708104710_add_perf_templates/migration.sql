-- AlterTable
ALTER TABLE "performance"."perf_cycles" ADD COLUMN     "template_id" INTEGER;

-- CreateTable
CREATE TABLE "performance"."perf_templates" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "levels" JSONB NOT NULL,
    "distribution" JSONB,
    "comment_required_rules" JSONB,
    "updated_by_open_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "perf_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance"."perf_template_dimensions" (
    "id" SERIAL NOT NULL,
    "template_id" INTEGER NOT NULL,
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

    CONSTRAINT "perf_template_dimensions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "perf_templates_deleted_at_idx" ON "performance"."perf_templates"("deleted_at");

-- CreateIndex
CREATE INDEX "perf_template_dimensions_template_id_idx" ON "performance"."perf_template_dimensions"("template_id");

-- CreateIndex
CREATE INDEX "perf_cycles_template_id_idx" ON "performance"."perf_cycles"("template_id");

-- AddForeignKey
ALTER TABLE "performance"."perf_template_dimensions" ADD CONSTRAINT "perf_template_dimensions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "performance"."perf_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance"."perf_cycles" ADD CONSTRAINT "perf_cycles_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "performance"."perf_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
