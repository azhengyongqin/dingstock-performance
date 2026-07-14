# 绩效系统模板、周期、评估与结果链大规模完善

Status: ready-for-agent

## Problem Statement

当前绩效系统已经具备配置模板、绩效周期、员工自评、360°评估、上级评估、AI 报告、绩效校准、结果确认和申诉的基础能力，但核心模型仍以早期固定流程为中心：同一模板同时承载周期规则与 D/M 表单；三类人工评估使用分离数据结构；维度结果隐藏在 JSON 中；上级评估等级由 Leader 手工选择；周期和参与者使用串行阶段状态；评估截止时间、提交锁定、校准和结果记录之间的边界不一致。

从用户角度看，这造成以下问题：

- Admin 无法独立复用和版本化管理配置模板与 D/M 评估表单模板。
- HR 创建绩效周期时仍需理解过多底层规则，且周期启动、任务开放、截止提醒、退回和归档缺少一致模型。
- 员工、360°评审员和 Leader 面对的表单难以按模板灵活配置，提交后修改规则也不统一。
- 360°结果无法按评审员关系进行可信加权，缺少有效关系归一化和完整计算明细。
- 上级评估、校准、结果推送、确认与申诉之间缺少稳定的权威边界和结果版本。
- AI、360°和内部校准数据的员工可见性容易与保密要求冲突。
- 当前状态机无法表达同一周期中不同员工分别处于填写、校准、确认或申诉阶段的真实情况。
- 高风险整体纠错、归档冻结、并发校准和审计历史缺少统一规则。

系统需要在保留现有业务入口和历史数据可追溯性的前提下，建立一套可配置、可计算、可复算、可审计且能逐员工推进的绩效评审模型。

## Solution

将复用资产拆分为配置模板和评估表单模板，并为两者建立草稿、已发布、已归档的不可变版本生命周期。配置模板承载评级、阶段结果模式、映射分、等级约束、360°关系权重、选定表单版本、相对日程和通知规则；评估表单模板按受控职级前缀打包员工自评、360°评估、上级评估和晋升评估四个子表单。

绩效周期创建简化为基本信息、参与者、日程预览和启动检查四步。周期只保留草稿、待启动、进行中和已归档四个粗粒度状态；参与者主状态只表达结果生命周期。任务开始时间控制开放，填写提醒截止时间只触发飞书通知，任务开放后持续可写到逐员工校准锁定或其他收口状态。

员工自评、360°评估和上级评估使用统一人工评估提交模型。每名填写人只保留当前有效提交和临时编辑草稿，不保存答卷历史版本。评估人可以在该员工首次校准前修改和重新提交；重新提交原子替换当前有效结果并触发计算。员工自评与上级评估是校准硬前置，360°允许部分提交或无数据。

360°结果先在同一评审员关系内平均，再排除无有效提交关系并归一化剩余关系权重，最后按维度权重计算阶段综合分。评级与评分统一产生 0～100 计算分，保留原始值和完整计算明细。上级评估阶段等级是校准前权威等级；员工自评、360°和 AI 只作参考；校准结果是最终人工权威边界。

每个有绩效结果的参与者必须形成 KEEP 或 ADJUST 的正式校准决定。校准采用乐观并发控制，首次校准同时锁定该员工全部人工评估。结果、推送、确认和申诉关联不可变结果版本。重新校准只有在等级变化时才生成新结果版本并要求员工重新确认。

Admin 可以在任意进行中进度将周期整体退回待启动或草稿；该操作使现有校准和结果链失效、解除评估锁定、保留历史并通知已收到结果的员工。已归档周期永久不可退回。

## User Stories

1. As an Admin, I want configuration templates and evaluation form templates to be separate assets, so that cycle-wide rules and reusable form content can evolve independently.
2. As an Admin, I want each reusable template to have draft, published, and archived versions, so that used configurations remain reproducible.
3. As an Admin, I want published template versions to be immutable, so that later edits do not silently change existing cycles.
4. As an Admin, I want editing a published template to create a new draft version, so that changes are explicit.
5. As an Admin, I want archived versions to remain visible for history but unavailable for new cycles, so that auditability does not compromise current configuration.
6. As an Admin, I want a configuration template to bind exact published form template versions, so that it never follows an unspecified latest version.
7. As an Admin, I want each form template to bind controlled job-level prefixes, so that D/M matching is deterministic.
8. As an Admin, I want overlapping job-level prefixes to block configuration template publication, so that an employee never matches multiple forms.
9. As an Admin, I want missing or uncovered job-level prefixes to block cycle startup, so that the system never uses a fallback form silently.
10. As an Admin, I want every form template to include self, peer, manager, and promotion subforms, so that each cohort has one complete reusable package.
11. As an Admin, I want promotion content to contain employee and Leader sections only, so that peer reviewers do not participate in promotion evaluation.
12. As an Admin, I want form items to come from a controlled component catalog, so that validation, rendering, export, and security remain predictable.
13. As an Admin, I want the catalog to support rating, score, short text, long text, Markdown, single select, multi-select, attachment, and URL inputs, so that current forms can be represented without arbitrary code.
14. As an Admin, I want every regular weighted dimension to contain exactly one scoring item, so that dimensions remain the only weighting layer.
15. As an Admin, I want rating-mode dimensions to use rating items and score-mode dimensions to use score items, so that configuration and form behavior are compatible.
16. As an Admin, I want each weighted subform to have exactly one explicit core dimension, so that constraints do not depend on display order.
17. As an Admin, I want regular dimension weights to total exactly 100%, so that every published calculation is valid.
18. As an Admin, I want the S/A/B/C symbols and ordering to remain fixed, so that constraints and reports use stable semantics.
19. As an Admin, I want to edit rating names, descriptions, continuous score ranges, mapping scores, and comment requirements, so that company policy remains configurable.
20. As an Admin, I want mapping scores to fall within their own score ranges, so that rating conversion is internally consistent.
21. As an Admin, I want level constraints to use controlled rule types and configurable parameters, so that business policy can change without arbitrary scripts.
22. As an Admin, I want confirmed red-line rules to remain a non-disableable hard constraint, so that critical policy cannot be bypassed by templates.
23. As an Admin, I want configuration publication to show all validation failures at once, so that I can fix the template efficiently.
24. As an Admin, I want template publication and archival actions audited, so that reusable policy changes are attributable.
25. As an HR, I want to browse published templates without editing them, so that global policy remains controlled by Admin.
26. As an HR, I want cycle creation to require only a cycle name, published configuration version, and planned launch time in the first step, so that setup is simple.
27. As an HR, I want cycle names such as “2026上半年绩效评定” to express the business period, so that no separate assessment-period dates are required.
28. As an HR, I want participant selection to validate job-level prefix coverage and promotion flags, so that form matching errors are caught before launch.
29. As an HR, I want a schedule preview generated from relative template rules, so that task opening and notifications do not need to be recreated each cycle.
30. As an HR, I want a final startup check with business-readable blockers, so that invalid cycles do not launch.
31. As an HR, I want a scheduled cycle to start automatically at the planned time after validation, so that routine launches require no manual action.
32. As an HR, I want failed automatic startup to keep the cycle scheduled and notify HR/Admin, so that tasks are not partially opened.
33. As an HR, I want task start times to be hard opening gates, so that forms are unavailable before the intended date.
34. As an HR, I want self, peer, and manager tasks to have independent start times and overlap when configured, so that work can proceed in parallel.
35. As an HR, I want filling deadlines to trigger Feishu notifications only, so that late submissions remain possible.
36. As an HR, I want reminders to continue without changing task or participant status, so that timing and workflow state remain separate.
37. As an HR, I want late-added participants to receive already-open tasks immediately, so that they can join an active cycle.
38. As an HR, I want late-added participants to retain the same self and manager submission requirements, so that they follow the same result standard.
39. As an HR, I want to modify authorized cycle configuration snapshots without changing reusable templates, so that cycle-specific policy stays isolated.
40. As an HR, I want calculation changes with existing submissions to show an impact preview and require a reason, so that recomputation is deliberate.
41. As an HR, I want calculation changes to create a new cycle configuration version and recompute all affected stage results, so that one cycle never mixes calculation versions.
42. As an HR, I want stage recomputation not to overwrite existing calibration decisions, so that management judgment remains the final boundary.
43. As an HR, I want form structure changes with submissions to require an Admin rollback to draft, so that old answers are not silently reinterpreted.
44. As an HR, I want compatible existing values prefilled after a structural change, so that evaluators do not repeat unaffected work.
45. As an HR, I want structurally affected submissions to return to draft and require resubmission, so that new form completeness is explicit.
46. As an Admin, I want to roll an active cycle back to scheduled or draft at any progress, so that severe configuration or process errors can be corrected.
47. As an Admin, I want cycle rollback to require a reason, impact summary, and confirmation, so that the high-risk action is intentional.
48. As an Admin, I want rollback to preserve all answers, assignments, calculations, and audit history, so that correction never destroys evidence.
49. As an Admin, I want rollback to invalidate calibration, results, confirmations, and appeals, so that old result chains are not mistaken for current ones.
50. As an Admin, I want rollback to unlock previously calibrated participants, so that evaluation can genuinely be redone.
51. As an employee with a published result, I want a Feishu notification when a cycle rollback invalidates it, so that I do not rely on an obsolete result.
52. As an Admin, I want archived cycles to have no rollback path, so that formal performance history remains stable.
53. As an HR, I want archiving to be a manual action after a full closure check, so that I can review cycle outcomes before freezing them.
54. As an HR, I want archive blockers to identify specific participants and reasons, so that I can resolve incomplete work.
55. As an employee, I want to save an incomplete self-review draft, so that I can prepare it over time.
56. As an employee, I want my self rating to be required for submission, so that self-review produces an explicit stage level.
57. As an employee, I want my configured Markdown summaries, plans, support requests, attachments, and links in one form, so that the review captures my full context.
58. As an employee participating in promotion evaluation, I want promotion materials embedded in self-review, so that I do not enter a separate promotion workflow.
59. As an employee, I want to edit and resubmit my self-review until my first calibration, so that I can correct or improve it.
60. As an employee, I want my last successful submission to remain effective while I edit a new draft, so that partial edits do not invalidate my result.
61. As an employee, I want resubmission to replace the effective answer only after complete validation, so that the current result is always based on a complete form.
62. As an employee, I want a missing required self-review to prevent calibration, so that no result is formed without my required participation.
63. As an HR, I want to mark a persistently missing self-review as no performance result for the cycle, so that one employee does not block archive indefinitely.
64. As an HR, I want no-result status to require a reason and be revocable before archive, so that mistakes can be corrected.
65. As an employee with no cycle result, I want that outcome distinguished from withdrawal and from a low grade, so that reports represent what actually happened.
66. As an assigned peer reviewer, I want a short D or M peer form focused on observable behavior, so that I am not asked to judge information I cannot know.
67. As an assigned D peer reviewer, I want to rate work contribution and responsibility, collaboration and values, and growth potential with 35/45/20 weights, so that feedback reflects peer-observable performance.
68. As an M peer reviewer, I want to rate result ownership, collaboration and organizational influence, and leadership and values with 40/35/25 weights, so that feedback reflects peer-observable management behavior.
69. As an assigned peer reviewer, I want to save a draft and submit later, so that I can complete the task when ready.
70. As an assigned peer reviewer, I want to edit and resubmit until the participant is calibrated, so that I can correct my feedback.
71. As an assigned peer reviewer, I want only my last successful submission to count while an update draft is pending, so that incomplete edits do not change aggregation.
72. As an assigned peer reviewer, I want an unsubmitted draft to produce no score, so that drafts never masquerade as feedback.
73. As an assigned peer reviewer, I do not want an “unable to evaluate” completion action, so that accepted tasks remain either draft or formally submitted.
74. As an assigned peer reviewer, I want filling deadlines to keep my task open, so that I can still submit late before participant calibration.
75. As an assessment Leader, I want to assign peer reviewers by controlled reviewer relation, so that relation-weighted aggregation has reliable inputs.
76. As an assessment Leader, I want the participant’s assessment Leader excluded from peer assignments, so that the manager perspective is not duplicated.
77. As an assessment Leader, I want submitted peer assignments protected from removal, so that completed feedback is not silently erased.
78. As an assessment Leader, I want peer feedback to exclude promotion questions, so that peer reviewers do not participate in promotion evaluation.
79. As an assessment Leader, I want manager evaluation to use D 70/20/10 or M 50/50 default weighted score dimensions, so that it follows company policy.
80. As an assessment Leader, I want manager stage level calculated from dimensions rather than manually selected, so that rules and constraints are enforceable.
81. As an assessment Leader, I want to edit and resubmit manager evaluation until first calibration, so that corrections remain possible.
82. As an assessment Leader, I want employee self-review and available peer feedback visible as references, so that manager evaluation has context.
83. As an assessment Leader, I want an absent self-review displayed as unavailable rather than blocking task opening, so that parallel work remains possible.
84. As an HR, I want missing manager evaluation to block calibration and archive, so that an employee does not lose a result because a Leader failed to act.
85. As an HR, I want to replace the assessment Leader when manager evaluation remains missing, so that a responsible Leader can complete it.
86. As an HR, I do not want to submit manager evaluation on a Leader’s behalf, so that evaluator responsibility remains authentic.
87. As an incoming assessment Leader, I want existing submitted manager content to remain effective and editable by me before calibration, so that ownership transfer does not erase work.
88. As an old assessment Leader, I want my edit and sensitive-data access removed after replacement, so that current responsibility controls access.
89. As an authorized calibrator, I want self and manager submissions required but peer/AI data optional, so that calibration has necessary authority without waiting for reference data.
90. As an authorized calibrator, I want self, peer, manager, AI, red-line, and difference information in one workbench, so that I can make an informed decision.
91. As an authorized calibrator, I want every participant with a result to receive an explicit KEEP or ADJUST decision, so that “not calibrated” is distinguishable from “kept unchanged”.
92. As an authorized calibrator, I want adjustment reasons required, so that grade changes are auditable.
93. As an authorized calibrator, I want stale submissions rejected when human evaluation or red-line state changed, so that I never decide from an obsolete page.
94. As an authorized calibrator, I want concurrent calibration changes rejected rather than last-write-wins, so that another decision is never silently overwritten.
95. As an authorized calibrator, I want AI updates not to block submission, so that an asynchronous reference does not interrupt the workflow.
96. As an incumbent assessment Leader, I want recalibration permission after a Leader change, so that current responsibility can correct results.
97. As an outgoing assessment Leader, I want historical records to retain my identity without retaining current access, so that audit and authorization remain separate.
98. As an HR, I want confirmed red-line findings to force C until explicitly revoked, so that calibration and appeals cannot bypass policy.
99. As an HR, I want only HR/Admin to confirm or revoke red-line findings with evidence and reasons, so that severe decisions have controlled authority.
100. As an employee, I want my published result to show final level, level explanation, manager composite and dimension scores, Leader comments, and my self-review, so that the result is understandable.
101. As an employee, I want peer identities, peer aggregates, AI reports, and internal calibration notes hidden, so that confidential evaluation data remains protected.
102. As an employee, I want promotion outcome shown only when configured as employee-visible, so that sensitive promotion data follows explicit policy.
103. As an employee, I want result confirmation tied to the exact result version I saw, so that my confirmation cannot be reused for a later grade.
104. As an employee, I want a changed grade after recalibration to create a new result and require confirmation again, so that I acknowledge the current outcome.
105. As an employee, I do not want a same-grade recalibration to create a new confirmation task, so that audit-only actions do not cause noise.
106. As an employee, I want one formal appeal per cycle and a bounded reconfirmation flow, so that the process is clear and can reach closure.
107. As an auditor, I want template, cycle configuration, Leader change, evaluation submit, calibration, red-line, no-result, result, confirmation, appeal, rollback, and archive actions attributable, so that the full process can be reviewed.
108. As an auditor, I want old configurations, calculations, calibrations, and result versions retained when invalidated, so that historical decisions remain explainable.
109. As an analyst, I want no-result, withdrawal, no peer data, and graded outcomes reported separately, so that completion metrics and grade distributions are accurate.
110. As an implementer, I want current answer data relational where it is calculated or queried and flexible payloads constrained where they are dynamic, so that PostgreSQL and Prisma can support both reporting and configurable forms.

## Implementation Decisions

- Build within the existing performance bounded area. The main functional modules are reusable templates, cycle configuration and lifecycle, evaluation submissions, calculation, calibration, results, notifications, appeals, and audit.
- Configuration Template and Evaluation Form Template are distinct domain objects with stable identities and immutable versions.
- Configuration Template Version owns rating definitions, stage modes, mapping scores, controlled level constraints, reviewer relation weights, selected Form Template Versions, relative schedules, and notification rules.
- Evaluation Form Template Version owns job-level prefix applicability and four subforms: SELF, PEER, MANAGER, and PROMOTION.
- Admin exclusively manages reusable template lifecycle. HR may view and select published versions and modify authorized cycle snapshots.
- Published versions cannot be edited in place. Modifying published content creates a new draft; archived versions remain historical only.
- The fixed stage-mode matrix is: SELF direct level only, PEER weighted rating or weighted score with weighted rating default, MANAGER weighted rating or weighted score with weighted score default, and AI direct level only.
- Rating and score item types remain explicit controlled components. Configuration publication must reject selected Form Template Versions whose scoring item types do not match the configured stage mode.
- Every regular weighted dimension has exactly one scoring item, and each weighted subform has exactly one explicit core dimension. Item-level weights are not supported.
- S/A/B/C symbols and order are fixed. Names, descriptions, score intervals, mapping scores, and comment requirements are configurable within validated bounds.
- The default rating mapping is S=95, A=85, B=70, C=50. Mapping scores must lie inside their rating intervals.
- Input scores are decimal 0–100 with at most two decimal places. Intermediate calculations use exact decimal arithmetic and do not round. Stage composite rounds half-up to two decimals before level mapping.
- Controlled level-constraint types are configurable through parameters; arbitrary formulas or scripts are prohibited. Confirmed red-line force-C remains an immutable system constraint.
- Configuration Template Version binds exact published Form Template Versions. Job-level prefixes must not overlap, and every cycle participant must match exactly one form before startup.
- A cycle copies configuration and form content into independent cycle snapshots. It keeps cycle-level source provenance but no live inheritance or per-dimension template lineage.
- The default cycle creation flow is four steps: basic information, participants and prefix checks, schedule preview, and startup check/action. Rule and form internals live in advanced configuration.
- Cycle lifecycle states are DRAFT, SCHEDULED, ACTIVE, and ARCHIVED. Fine-grained operational stage labels are derived views, not cycle state.
- Participant states are ACTIVE, CALIBRATED, RESULT_PUBLISHED, APPEALING, RECONFIRMING, CONFIRMED, NO_RESULT, and WITHDRAWN. Evaluation and AI progress remain on their own objects.
- Task start time is a hard opening gate. Filling reminder deadline is a soft notification trigger and never rejects save, submit, or resubmit.
- Scheduled cycles auto-start after an atomic readiness check. Failure leaves them scheduled and sends actionable notifications.
- Only Admin can roll ACTIVE cycles back to SCHEDULED or DRAFT, regardless of current progress. Rollback requires reason and impact confirmation.
- Cycle rollback invalidates active calibration decisions, result versions, confirmations, and appeals; unlocks participant evaluations; preserves all history and input; and notifies employees whose published results became invalid.
- ARCHIVED is permanent and has no outgoing transition. Post-archive correction requires a separate additive correction model or supplemental cycle, outside the normal rollback path.
- Evaluation submission is one unified parent model for SELF, PEER, and MANAGER, with relational item results for effective calculable/current values.
- Each evaluator keeps one current effective submission. Answer history versions are not stored.
- A submitted evaluation may have a temporary edit draft. The effective submission remains in force until a complete resubmission atomically replaces it.
- Draft payload may use a validated structured representation; current effective values that are calculated, filtered, aggregated, or reported must be relational.
- Formal submission requires all scoring items and all configured required non-scoring items. SELF direct level is always required. Promotion employee/Leader requirements are validated within SELF/MANAGER respectively.
- Evaluators may save, submit, edit, and resubmit until the participant’s first successful calibration. First calibration and evaluation lock occur atomically.
- A cycle rollback is the only path that removes an existing evaluation lock. Ordinary configuration recalculation does not unlock evaluation.
- Structural form changes after submissions require Admin rollback to DRAFT. Affected submissions return to draft; compatible values are prefilled; resubmission is mandatory.
- Non-structural copy changes do not alter submission status. Calculation-rule changes create a new cycle configuration version and recompute affected stage results.
- Stage recomputation never overwrites an existing valid calibration decision or employee result. A final-result change requires explicit recalibration.
- Reviewer relations are controlled. The assessment Leader is excluded from peer candidate and assignment paths. Submitted assignments cannot be removed; replacements remain audited.
- Reviewer relation base weights are fixed to four calculating relations by default: organization owner 30%, project owner 30%, same-department peer 25%, cross-department collaborator 15%.
- Each relation weight is positive, at most 100%, at most two decimals, and all four total exactly 100%. Runtime normalization only handles absent effective relations.
- Peer aggregation is: evaluator dimension calculation score, same-relation dimension mean, valid-relation normalized weighting per dimension, dimension weighting, stage composite, level mapping, constraints.
- Unsubmitted peer drafts never count. An unsubmitted update draft leaves the last successful submission effective. No effective peer submission yields a no-data stage result.
- Peer tasks have no unable-to-evaluate action. They remain draft or become formally submitted.
- Default PEER D dimensions are work contribution and responsibility 35% core, collaboration/communication and values 45%, learning/growth and potential 20%.
- Default PEER M dimensions are result ownership and responsibility 40% core, collaboration/communication and organizational influence 35%, leadership and values 25%.
- Default MANAGER D dimensions are core performance 70% core, values 20%, professional quality and potential 10%.
- Default MANAGER M dimensions are core performance 50% core and management performance 50%.
- Peer reviewers never receive promotion items. Promotion evaluation exists only in employee and Leader sections.
- SELF and MANAGER effective submissions are hard prerequisites for first calibration. PEER and AI are optional reference inputs.
- Persistent missing SELF may be explicitly closed as NO_RESULT by scoped HR or Admin with a reason; it is not withdrawal and produces no result. It is revocable before archive.
- Missing MANAGER cannot cause NO_RESULT. HR/Admin must continue escalation or replace the assessment Leader; no one may submit on the Leader’s behalf.
- Before calibration, replacing the assessment Leader transfers edit ownership while keeping the previous valid manager submission effective until the new Leader resubmits.
- After calibration, Leader replacement changes future sensitive-read and recalibration permission only. It does not unlock or rewrite historical evaluation/calibration records.
- AI remains an independent asynchronous report with direct reference level. It is never a cycle/participant stage and never blocks calibration.
- Manager stage level is the pre-calibration authoritative level. SELF, PEER, and AI levels are references and are not second-level weighted into the final result.
- Every result-bearing participant requires an explicit KEEP or ADJUST Calibration Decision. ADJUST requires a reason; decisions are append-only.
- Calibration permission defaults to current assessment Leader for owned participants, scoped HR for authorized organizations, and global Admin.
- Calibration uses optimistic concurrency for both latest calibration decision and the full human-evaluation/red-line input revision. Stale requests fail with a refresh requirement.
- AI report changes do not invalidate a calibration request. Human evaluation or red-line changes do.
- Red-line findings are confirmed or revoked only by HR/Admin with type, facts, evidence, reason, actor, and time. Active findings force stage/pre-calibration/final level C.
- Result Version is immutable. Publication, confirmation, and appeal refer to a specific version.
- Recalibration produces and republishes a new result version only when employee-visible final level changes. Same-level decisions remain audit-only.
- Employee Result View includes final level and explanation, manager composite/dimension results, Leader comments, employee self-review, controlled promotion outcome, and result version/confirmation status.
- Employee Result View excludes peer identities, individual/relationship/stage peer results, AI report/level, internal calibration discussion, and sensitive calibration notes.
- Every published-result participant closes as CONFIRMED, NO_RESULT, or WITHDRAWN before archive. Appeals and reconfirmation must be closed.
- Archive is manual. It may be performed by Admin or HR whose authorization covers every participant, after full closure validation and summary confirmation.
- PostgreSQL/Prisma target modeling should relationize template/version bindings, form hierarchy, current effective item results, stage/dimension/relation aggregates, calibration decisions, result versions, confirmations, red-line findings, rollback records, and common current-record lookup paths.
- Flexible but validated snapshots such as rating/constraint/notification configuration and temporary drafts may use JSON where relational querying is not required.
- Existing separate self/peer/manager records and JSON dimension-score payloads require a controlled migration to the unified model. Existing manual manager initial levels must be compared against computed levels before cutover.
- Existing old state enums require data migration and coordinated changes across backend guards, notification logic, dashboards, and frontend status labels.
- The consolidated specification supersedes earlier partial template-application specifications where they conflict, especially around template composition, published versions, active-cycle rollback, stage calculation, and lifecycle state.

## Testing Decisions

- The primary test seam is externally observable domain service/API behavior. Tests should invoke the public template, cycle, evaluation, calibration, result, and appeal operations and assert persisted business outcomes and returned errors, rather than private helpers.
- Existing NestJS service tests with mocked database/audit dependencies are the closest prior art for template usability, cycle creation, cycle state, reviewer assignment, and active-cycle editing. Extend that style while adding database-backed integration coverage for transaction and constraint behavior where mocks cannot prove atomicity.
- Use one shared calculation conformance suite as the highest-value new seam. Feed rule snapshots and submissions into the public calculation service and assert item scores, relation means, normalized weights, dimension results, composite score, initial level, constraint reason, and stage level.
- Calculation tests must cover weighted rating, weighted score, exact decimal inputs, half-up rounding, interval boundaries, mapping-score validation, core constraints, any-dimension constraints, and active red-line force-C.
- Peer aggregation tests must cover multiple reviewers in one relation, multiple valid relations, missing relations, only one valid relation, partial submissions, update drafts, all-draft no-data, and relation weights with decimal values.
- Template publication tests must cover version immutability, exact form-version binding, stage-mode/input-type compatibility, prefix overlap, missing coverage, dimension totals, core cardinality, scoring-item cardinality, mapping interval validity, relation-weight totals, and promotion subform boundaries.
- Cycle API tests must cover four-step inputs, startup readiness, automatic startup success/failure, task opening gates, soft deadline notifications, late additions, authorized snapshot edits, structural-change rejection, and archive blockers.
- State transition tests must cover DRAFT/SCHEDULED/ACTIVE/ARCHIVED, Admin rollback from every ACTIVE progress, no ARCHIVED outgoing transition, and participant result-chain transitions including appeal/reconfirmation.
- Rollback integration tests must prove that invalidation, unlock, participant reset, task pause, audit creation, and notification enqueueing occur atomically or recoverably without deleting history.
- Evaluation API tests must cover incomplete draft save, complete first submission, effective submission plus edit draft, atomic resubmission, calibration lock rejection, structural-change resubmission, and no answer-history creation.
- Authorization tests must cover Admin-only template and rollback actions; scoped HR cycle and no-result actions; current Leader evaluation/calibration access; old Leader access removal; peer assignment access; and employee-only result access.
- Calibration integration tests must cover missing SELF/MANAGER prerequisites, optional PEER/AI, KEEP/ADJUST validation, stale human-input rejection, concurrent calibrator rejection, red-line enforcement, per-participant lock, and append-only history.
- Result tests must cover first publication, same-level recalibration without republish, changed-level recalibration with a new version, invalidation on cycle rollback, confirmation tied to version, single appeal, reconfirmation, and archive closure.
- Privacy tests must treat the employee result API as a security seam and assert that peer identities/results, AI content, and internal calibration fields are absent, not merely hidden by the frontend.
- Notification tests must assert event-triggered behavior: task open, soft deadline reminder, startup failure, result publication, changed-result republish, no-result/withdrawal where applicable, and rollback result invalidation.
- Frontend tests should remain focused on user-visible orchestration that backend tests cannot cover: disabled/invalid template reasons, four-step wizard transitions, dynamic form rendering, effective-versus-draft indicator, calculation preview, stale-calibration conflict UI, rollback impact confirmation, and employee result visibility.
- Existing frontend utility/component tests for template selection and reviewer grouping are prior art. Add route-level or component-flow tests only where they verify an agreed user journey; avoid duplicating backend calculation tests in the browser.
- Add end-to-end smoke journeys for one D participant and one M participant from template publication through cycle launch, self/peer/manager submission, calibration, result publication, confirmation, and archive.
- Add an end-to-end rollback journey with an already confirmed participant to verify invalidation notice, evaluation unlock, resubmission, recalibration, new result, reconfirmation, and archive.
- Migration verification must compare counts and business keys; reconstruct current effective submissions; verify old JSON dimension results; and produce a manual-versus-computed manager-level difference report before enabling new reads.
- Good tests assert domain outcomes, permissions, versions, immutable history, and user-visible errors. They must not assert incidental helper calls, private method names, or UI implementation structure.
- Database schema changes must include constraint/index validation and keep the generated database-structure documentation synchronized with the Prisma source of truth.

## Out of Scope

- Independent promotion approval, appointment, compensation adjustment, or promotion workflow beyond collecting employee and Leader evaluation content.
- Peer reviewer participation in promotion evaluation.
- Arbitrary HTML, scripts, JSON Schema plugins, or user-authored calculation formulas.
- Adding, deleting, or renaming S/A/B/C rating symbols.
- Per-evaluator custom weights within the same reviewer relation.
- Treating unsubmitted peer reviews as zero, C, B, or any synthetic score.
- An “unable to evaluate” peer completion status.
- A fallback form, manual per-employee form override, or allowing missing job level as a normal path.
- Automatic cross-stage weighting of SELF, PEER, MANAGER, and AI into a final level.
- AI as a blocking workflow stage or employee-visible report.
- Answer-content history versions for evaluation submissions.
- Directly modifying a submitted evaluation after participant calibration without a full cycle rollback.
- Directly changing an existing calibration because stage calculation was recomputed.
- Last-write-wins calibration concurrency.
- Automatic archive.
- Rolling back or editing an archived cycle.
- Updating historical result rows in place.
- Suggested or forced rating distributions.
- Assessment-period start/end dates separate from the cycle name.
- A global mutable reviewer-weight setting that retroactively changes existing cycles.
- Continuous synchronization from reusable templates to cycle snapshots.
- Implementing post-archive correction records in this delivery; only the prohibition on normal rollback and the future additive boundary are specified.
- Replacing the existing Feishu integration platform or organization/job-level source.

## Further Notes

- Use the repository glossary terms consistently: Configuration Template, Evaluation Form Template, Evaluation Submission, Evaluation Lock, Stage Result, Pre-calibration Level, Calibration Decision, Result Version, No Performance Result for Cycle, and Archived.
- The performance-level calculation and evaluation-dimension rule documents remain the source for default company policy; later accepted ADRs define deliberate deviations and operational boundaries.
- The accepted ADR set through ADR-0060 is normative. Notable supersessions include computed stage results replacing manual-only grading, editable current submissions replacing immutable answer versions, soft filling deadlines replacing forfeiture/expiry, and coarse lifecycle states replacing global workflow stages.
- The current codebase already has useful service-level test prior art around cycle state, template usability, cycle snapshot copying, active-cycle edits, reviewer assignment, and frontend reviewer grouping.
- The preferred test seam was inferred from these existing tests and the user’s instruction to stop asking new questions: public service/API behavior is primary, with frontend flow tests only for orchestration and visibility.
- This PRD supersedes the earlier local PRD for configuration-template application wherever the two conflict. The earlier effort remains useful as implementation history, but its assumptions about template contents, active-cycle template application, lifecycle state, and weight semantics are no longer authoritative.
- Implementation should be delivered in dependency order: schema/calculation foundation, reusable templates, cycle lifecycle, unified evaluations, calibration/results, then migration and cutover.
