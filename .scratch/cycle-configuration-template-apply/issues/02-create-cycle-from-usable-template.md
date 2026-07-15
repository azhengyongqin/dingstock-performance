# 创建绩效周期时复制可用配置模板快照

Status: resolved

## Parent

.scratch/cycle-configuration-template-apply/PRD.md

## What to build

创建绩效周期时，如果 HR 选择配置模板，后端必须先确认该模板可用于创建，再把评分规则和评估维度复制为该周期自己的周期配置快照。前端创建成功后给出明确提示，并在后续评分规则、评估维度步骤展示已复制出的周期配置。复制后周期配置独立于配置模板，不新增逐维度来源映射。

## Acceptance criteria

- [x] 使用可用配置模板创建绩效周期时，周期创建成功，并复制评分规则到该周期。
- [x] 使用可用配置模板创建绩效周期时，周期创建成功，并复制评估维度到该周期。
- [x] 创建后的周期只保留周期级来源模板溯源，不保存逐维度来源模板映射。
- [x] 选择不可用配置模板创建绩效周期时，后端拒绝并返回业务可读错误。
- [x] 前端创建成功提示明确说明已从模板复制评分规则与评估维度。
- [x] 后续评分规则和评估维度步骤展示的是周期配置快照，编辑不会回写配置模板。
- [x] 覆盖创建周期复制模板快照、拒绝不可用模板、模板后续修改不影响周期快照的后端测试。

## Blocked by

- .scratch/cycle-configuration-template-apply/issues/01-template-usability-selection.md

## Comments

2026-07-15 resolved：功能由 CycleSetupService.createFromPublishedConfig 承载（复制为 PerfCycleConfigVersion + D/M 表单快照，周期级 sourceConfigTemplateVersionId 溯源）。缺失的后端测试补齐于 d70620a：快照内容深拷贝断言、DRAFT/ARCHIVED 版本拒绝（业务可读中文错误）、模板后续修改不影响已创建周期快照。
