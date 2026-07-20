-- 草稿允许暂时缺少计分方式或条件必填等级；完整性统一在发布校验中保证。
ALTER TABLE "performance"."perf_form_dimensions"
  DROP CONSTRAINT IF EXISTS "perf_form_dimensions_scoring_method_check";

ALTER TABLE "performance"."perf_form_items"
  DROP CONSTRAINT IF EXISTS "perf_form_items_required_levels_check";
