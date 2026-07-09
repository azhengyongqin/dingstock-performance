# 来源模板溯源展示与快照文案

Status: ready-for-agent

## Parent

.scratch/cycle-configuration-template-apply/PRD.md

## What to build

在周期编辑和详情体验中展示只读来源模板溯源，帮助 HR 理解当前周期配置来自哪个配置模板，但已经是周期自己的配置快照。文案必须强调“创建时/最近套用时复制”，并说明当前配置可能已被手动修改。手动编辑评分规则和评估维度继续沿用既有审计动作，与 `cycle.template.apply` 区分。

## Acceptance criteria

- [x] 从配置模板创建的绩效周期展示来源模板信息。
- [x] 重新套用模板后的绩效周期展示最新来源模板信息。
- [x] 来源模板文案明确表达“复制为周期配置快照”，不暗示持续同步。
- [x] 来源模板文案提示当前评分规则和评估维度可能已被手动修改。
- [x] 手动编辑评分规则仍记录既有评分规则编辑审计动作。
- [x] 手动编辑评估维度仍记录既有维度编辑审计动作。
- [ ] 覆盖来源模板展示、重套后来源更新、快照文案可见的前端可观察行为测试。

## Blocked by

- .scratch/cycle-configuration-template-apply/issues/02-create-cycle-from-usable-template.md
- .scratch/cycle-configuration-template-apply/issues/03-apply-template-before-cycle-start.md
