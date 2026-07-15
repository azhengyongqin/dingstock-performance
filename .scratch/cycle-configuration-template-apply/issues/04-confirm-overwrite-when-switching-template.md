# 模板切换与重新套用的覆盖确认

Status: resolved

## Parent

.scratch/cycle-configuration-template-apply/PRD.md

## What to build

在周期创建/编辑向导里跟踪 HR 是否已经手动修改评分规则或评估维度。未修改前切换配置模板可以静默替换；一旦已修改，再切换或重新套用模板必须先弹出确认，明确提示会覆盖当前评分规则与评估维度。确认后执行整体覆盖，取消则保留当前周期配置快照。

## Acceptance criteria

- [x] 周期向导能识别评分规则或评估维度是否已被手动修改。
- [x] 未手动修改前切换配置模板时，可以直接替换当前周期配置快照。
- [x] 已手动修改后切换配置模板或重新套用模板时，必须先出现确认弹窗。
- [x] 确认弹窗文案明确说明会覆盖当前评分规则与评估维度。
- [x] 用户取消确认时，不发起覆盖操作，当前周期配置快照保持不变。
- [x] 用户确认后，执行整体覆盖，不做字段级合并。
- [x] 覆盖未编辑静默替换、已编辑确认覆盖、取消不覆盖的前端可观察行为测试。

## Blocked by

- .scratch/cycle-configuration-template-apply/issues/02-create-cycle-from-usable-template.md
- .scratch/cycle-configuration-template-apply/issues/03-apply-template-before-cycle-start.md

## Comments

2026-07-15 resolved：新版向导创建前切换模板天然静默（快照在创建时才复制）。已创建周期的“是否手动修改”由后端 getConfigSnapshot.manuallyModified 判定（快照行 updatedAt>createdAt，覆盖高级配置与计划调整两条路径）；ddfbe70 实现：未修改直接套用，已修改先弹确认（文案明确覆盖评估规则与评估维度、重置日程与通知规则、不做字段级合并），取消不发请求。4 条前端行为测试见 cycle-setup-editor.test.tsx。
