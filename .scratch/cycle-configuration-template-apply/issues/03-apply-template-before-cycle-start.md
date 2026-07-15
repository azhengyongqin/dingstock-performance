# 启动前重新套用配置模板

Status: resolved

## Parent

.scratch/cycle-configuration-template-apply/PRD.md

## What to build

为已有绩效周期提供启动前“重新套用模板”业务动作。该动作只允许在周期状态为草稿或待启动时使用，必须整套覆盖评分规则和评估维度，更新周期级来源模板，并写入一条 `cycle.template.apply` 审计事件。启动后的周期不提供该动作，只能逐项修改周期配置。

## Acceptance criteria

- [x] 草稿或待启动绩效周期可以重新套用一个可用配置模板。
- [x] 重新套用模板会整体覆盖当前周期的评分规则和评估维度。
- [x] 重新套用模板不会做字段级合并、同名维度匹配或部分复制。
- [x] 重新套用模板后，周期级来源模板更新为最新套用的配置模板。
- [x] 重新套用模板写入一条业务级审计事件 `cycle.template.apply`，并能体现覆盖范围为评分规则和评估维度。
- [x] 非草稿/非待启动周期调用重新套用模板时，后端拒绝并返回业务可读错误。
- [x] 前端只在启动前周期展示“重新套用模板”入口，启动后隐藏或禁用该入口。
- [x] 覆盖启动前成功重套、启动后拒绝、审计事件、来源模板更新的后端测试。

## Blocked by

- .scratch/cycle-configuration-template-apply/issues/01-template-usability-selection.md

## Comments

2026-07-15 resolved：legacy 周期沿用 CycleService.applyTemplate。新版快照周期在 8e7ca91/3b33f3c 补齐 CycleSetupService.reapplyPublishedConfig（POST /cycles/:id/config-snapshot/reapply）：仅 DRAFT/SCHEDULED，整套复制为 version+1 新配置快照（旧版本保留），更新周期级来源模板与参与人表单绑定，写一条 cycle.template.apply 审计（coverage 体现评估规则+维度）。前端入口 ddfbe70：仅启动前渲染「重新套用模板」。

2026-07-15 评审修正：重新套用只覆盖评估规则、关系权重与评估维度（表单快照），日程预设与通知规则沿用当前周期设置不被重置（PRD Out of Scope 明确排除时间窗/通知复制）。
