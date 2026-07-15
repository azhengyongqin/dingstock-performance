# 绩效周期创建与启动前重新套用配置模板

Status: resolved

## Problem Statement

HR 创建绩效周期时，需要快速复用既有配置模板中的评分规则和评估维度配置，避免每个周期重复手工录入。当前系统已经有配置模板管理和创建周期时通过模板复制配置的基础能力，但产品边界还不完整：模板是否可用于创建缺少明确校验，默认模板不可用时的行为不清晰，已有周期启动前无法重新套用模板，前端切换模板时没有覆盖风险提示，周期详情也没有清楚表达“来源模板只是复制溯源，不是持续同步”。

这导致 HR 容易误以为选择模板后周期配置一定完整、模板修改会同步影响已创建周期，或者在已经手动修改周期配置后误切模板覆盖评分规则和评估维度。

## Solution

在新建绩效周期的基础信息步骤提供配置模板选择。系统默认选中“默认且可用于创建”的配置模板；选择模板后，将该模板的评分规则和评估维度复制为当前周期的周期配置快照。后续评分规则、评估维度步骤展示的是周期自己的快照，HR 可以继续微调，微调不会回写配置模板。

在周期启动前，HR 可以对已有周期执行“重新套用模板”。该动作必须同时覆盖评分规则和评估维度，不支持只复制其中一部分。若 HR 已经手动修改过评分规则或评估维度，切换或重新套用模板前必须确认覆盖风险。启动后不提供“重新套用模板”，只允许逐项修改周期配置并按既有审计规则记录原因。

配置模板需要区分“存在”和“可用于创建”。只有评分等级、评估维度、维度权重都完整合法的配置模板，才允许用于创建绩效周期或重新套用。不可用模板可以在列表和下拉中展示，但必须禁用并显示原因；后端同样拦截，不依赖前端校验。

周期只保留周期级来源模板溯源。复制后的评分规则和评估维度是独立周期配置快照，不保留逐维度来源映射，不做模板到周期的持续同步。

## User Stories

1. As an HR, I want the cycle creation wizard to show configuration templates in the basic information step, so that I can start from an existing configuration instead of building rules from scratch.
2. As an HR, I want the default usable configuration template to be selected automatically, so that common cycle creation requires fewer manual choices.
3. As an HR, I want an unusable default template to stay unselected, so that the system does not silently apply an invalid starting point.
4. As an HR, I want unusable templates to be visible but disabled with reasons, so that I know what needs to be fixed in template management.
5. As an HR, I want selecting a template during creation to copy scoring rules into the cycle, so that the scoring rule step is prefilled.
6. As an HR, I want selecting a template during creation to copy dimensions into the cycle, so that the dimension step is prefilled.
7. As an HR, I want copied scoring rules and dimensions to become cycle configuration snapshots, so that I can safely adjust them for this cycle only.
8. As an HR, I want changes made in the cycle wizard not to modify the original configuration template, so that template reuse remains predictable for future cycles.
9. As an HR, I want later edits to a configuration template not to affect cycles already created from it, so that historical cycle configuration stays stable.
10. As an HR, I want to switch templates silently before I have edited scoring rules or dimensions, so that early setup stays fast.
11. As an HR, I want a confirmation dialog before switching templates after I have edited scoring rules or dimensions, so that I do not accidentally overwrite my work.
12. As an HR, I want the confirmation dialog to state that scoring rules and dimensions will be overwritten, so that the impact is concrete.
13. As an HR, I want confirming template switching to replace the full scoring rule and dimension snapshot, so that the resulting cycle configuration is internally consistent.
14. As an HR, I want the system not to perform field-level merging between templates and existing cycle configuration, so that there are no hidden same-name or deleted-dimension merge rules.
15. As an HR, I want to reopen a draft or pending cycle and apply a different configuration template, so that I can correct the starting configuration before launch.
16. As an HR, I want the action on an existing cycle to be called “重新套用模板”, so that I understand it copies and overwrites configuration rather than changing a reference.
17. As an HR, I want “重新套用模板” to be available only before the cycle is started, so that launched review tasks and submitted data are not disrupted by bulk replacement.
18. As an HR, I want launched cycles to hide or disable “重新套用模板”, so that I am guided toward explicit item-by-item configuration changes.
19. As an HR, I want “重新套用模板” to always copy scoring rules and dimensions together, so that the cycle does not end up with scoring rules from one template and dimensions from another.
20. As an HR, I want the system to reject applying an incomplete template, so that every applied template can produce a viable cycle configuration.
21. As an HR, I want templates without scoring levels to be unavailable for creation, so that a cycle cannot be created without grade definitions.
22. As an HR, I want templates without dimensions to be unavailable for creation, so that a cycle cannot be created without evaluation form content.
23. As an HR, I want templates whose dimension weights do not sum to 100 by applicable group to be unavailable, so that startup checks do not catch a predictable template defect later.
24. As an HR, I want template unavailable reasons to be shown in the selection UI, so that I know whether to add levels, add dimensions, or fix weights.
25. As an HR, I want the backend to reject unusable template application, so that API callers cannot bypass UI restrictions.
26. As an HR, I want the cycle detail or edit page to show the source template, so that I can tell which template was last copied into the cycle.
27. As an HR, I want the source template display to say “创建时复制” or equivalent copy wording, so that I do not assume ongoing synchronization.
28. As an HR, I want the page to explain that current configuration is a cycle snapshot and may have been manually modified, so that I interpret the source template correctly.
29. As an HR, I want the source template to update after重新套用模板, so that the visible source matches the last copied template.
30. As an auditor, I want重新套用模板 to create one business-level audit event, so that I can see who applied which template to which cycle.
31. As an auditor, I want the audit event to include the covered scope, so that I know scoring rules and dimensions were both overwritten.
32. As an auditor, I want manual scoring rule edits to keep their existing audit action, so that direct edits and template application remain distinguishable.
33. As an auditor, I want manual dimension edits to keep their existing audit action, so that direct edits and template application remain distinguishable.
34. As an implementer, I want cycle dimensions not to store source template dimension IDs, so that the data model does not imply future template synchronization.
35. As an implementer, I want the system to keep only cycle-level template provenance, so that source tracking stays simple and aligned with snapshot semantics.
36. As an HR, I want startup checks to still validate the copied cycle configuration, so that applying a template does not skip cycle readiness validation.
37. As an HR, I want a clear success message after creating a cycle from a template, so that I know scoring rules and dimensions were copied.
38. As an HR, I want a clear success message after重新套用模板, so that I know the current cycle configuration was replaced.
39. As an HR, I want failure messages for unavailable templates to be business-readable, so that I can fix the template without inspecting logs.
40. As an administrator, I want template management to continue allowing incomplete drafts, so that templates can be built incrementally before they become usable.

## Implementation Decisions

- Use the existing cycle and template bounded area. Extend the current configuration template and cycle management behavior rather than introducing a separate template application module.
- Configuration template remains the canonical domain term for the reusable mother configuration. It contains scoring rules and dimensions only for this feature; time windows and notification rules are not part of the copy operation.
- New cycle creation keeps template selection in the basic information step. Scoring rule and dimension steps show the copied cycle snapshot for review and adjustment.
- The default auto-selection rule is “default template and usable for creation”. A default template that is incomplete or invalid remains visible but is not selected automatically.
- Template usability is a backend-computed business property. A usable template must have at least one scoring level, at least one dimension, and valid dimension weight totals by applicable group.
- Unusable templates may still exist in template management. They are draft-like reusable assets, not selectable sources for cycle creation or重新套用模板.
- On initial creation, the existing cycle creation API should continue accepting a template identifier, but it must validate template usability before copying.
- Add a startup-before-only action for existing cycles to重新套用模板. The action should be allowed only when the cycle status is draft or pending.
-重新套用模板 copies scoring rules and dimensions as one atomic business operation. Partial copy of only scoring rules or only dimensions is out of scope.
-重新套用模板 should overwrite the current cycle scoring rule and active dimensions. It should not attempt same-name matching, field-level merging, or source-template-dimension reconciliation.
- The UI must track whether scoring rules or dimensions have been manually edited in the wizard. Switching template before edits can replace the current snapshot silently; switching after edits requires explicit confirmation.
- The confirmation copy must make the destructive effect concrete: current scoring rules and dimensions will be overwritten.
- The action label must be “重新套用模板”. Avoid “更换模板”, because the operation copies and overwrites configuration rather than changing a live reference.
- Store only cycle-level source template provenance. Do not add per-dimension source template references. This follows ADR-0004: configuration templates copy into cycle snapshots and do not maintain inheritance.
- After重新套用模板, update the cycle-level source template to the latest applied template.
- The cycle edit/detail experience should display source template as read-only provenance and explain that current configuration is a cycle snapshot that may have been manually modified.
- Audit重新套用模板 as a single business event named `cycle.template.apply`. Include operator, cycle, template, fixed coverage of scoring rules plus dimensions, and before/after summary.
- Preserve existing manual-edit audit actions for scoring rules and dimensions, so manual edits remain distinguishable from template application.
- Startup checks remain authoritative for launch readiness. Template usability prevents predictable bad copies; startup checks still validate the concrete cycle configuration.
- Keep comments and user-facing wording in Chinese, following repository conventions.

## Testing Decisions

- Test external behavior at service/API seams rather than private helper implementation. The preferred backend seam is the cycle service or controller behavior that creates cycles and applies templates, because that is where the business invariant is visible.
- Add focused backend tests for creating a cycle with a usable template: the cycle is created, scoring rule is copied, dimensions are copied, and source template provenance is recorded.
- Add backend tests for rejecting unusable templates during cycle creation and重新套用模板: missing levels, missing dimensions, and invalid weight totals should produce business-readable failures.
- Add backend tests for重新套用模板 on an existing draft or pending cycle: current scoring rule and dimensions are replaced atomically and a single `cycle.template.apply` audit event is recorded.
- Add backend tests for rejecting重新套用模板 after launch, using a non-draft/non-pending cycle status.
- Add backend tests proving copied dimensions do not depend on template dimension IDs and later template edits do not mutate the cycle snapshot.
- Add frontend tests or component-level coverage around the cycle edit wizard where feasible: default usable template selection, unusable template disabled state, edited-state confirmation before overwrite, and read-only source template display.
- Existing prior art includes focused NestJS unit tests for cycle state and participant state, plus service-level tests for other infrastructure services. Follow that pattern with mocked Prisma and audit dependencies where integration tests are not already established.
- Good tests should assert business outcomes: copied snapshot contents, rejection behavior, visible disabled reasons, and audit action names. Avoid asserting incidental internal helper calls.
- Because this feature touches both backend rules and frontend UX, verification should include backend unit tests plus `pnpm build` for backend, and frontend lint/build after UI changes.

## Out of Scope

- Copying time windows or notification rules from configuration templates.
- Partial template application, such as copying only scoring rules or only dimensions.
- Template-to-cycle continuous synchronization.
- Per-dimension source template mapping.
- Field-level merge behavior when applying a template.
- Applying templates after cycle launch.
- Changing the meaning of dimension weights or using weights to compute performance levels.
- Reworking the full cycle creation wizard beyond the template selection, overwrite confirmation, and provenance display needed for this feature.
- Changing template management into a formal draft/publish workflow.
- Adding new domain concepts for “rule libraries” or reusable dimension libraries.

## Further Notes

- Use the glossary terms 绩效周期, 周期配置, 配置模板, 评分规则, and 评估维度 consistently.
- “评估规则” should not be introduced as a new term; the intended term is 评分规则.
- ADR-0004 records the snapshot decision and should be respected during implementation.
- The existing source template field is provenance only. UI copy must not imply that the cycle remains linked to the template.
- The feature should preserve the current rule that template edits do not affect already-created cycles and cycle edits do not write back to templates.

## Comments

2026-07-15：5 个 issue 全部 resolved。实现分布：d70620a（issue 02 测试）、8e7ca91+3b33f3c（issue 03 后端）、ddfbe70（issue 03/04 前端）、f40b58c（issue 05）。架构说明：版本化重构（ADR-0022/0025/0026）后，“可用性”由发布状态承载、重套实现为周期配置版本链 +1，无“默认模板”概念。
