# 绩效面谈工作台与申诉弱关联闭环

Status: ready-for-agent

## Problem Statement

绩效结果推送后，Leader/HR 需要与员工预约并完成结果沟通面谈，也可能在申诉处理过程中安排沟通。当前系统把面谈做成申诉域的附属能力：创建申诉面谈会强制推进申诉状态，选择性面谈虽有后端接口但前端无入口，面谈记录字段与产品叙事不一致，飞书日程未接入，员工结果页也看不到自己的预约信息。申诉关闭前端仍按错误契约提交，结果闭环不稳定。

用户真正需要的是一套尽量简单的独立面谈能力——预约时间（含飞书日程）、面谈后填写纪要、可关联申诉但不被申诉状态机绑架——并补齐权限、审计、通知与申诉结案闭环。个人档案与报表不在本期。

## Solution

建设统一的「面谈」工作台（`/interviews`），面向 Leader、HR、Admin。面谈是独立业务对象：先预约（`SCHEDULED`，系统以操作者身份创建飞书日程并关联展示），面谈结束后填写单一结果纪要（`COMPLETED`），也可显式取消（`CANCELLED` 并同步取消日程）。纪要对员工不可见；员工仅在结果确认页看到自己的预约时间与飞书日程入口。

申诉与面谈分开：申诉仍负责发起、指派、结案（先校准再 resolve）；面谈可通过可选 `appealId` 弱关联申诉。创建/完成/取消面谈不自动改申诉状态。申诉主状态简化为 `PENDING` / `RESOLVED`；界面上的「面谈中」由是否存在关联的进行中/已完成面谈推导。不再使用 `APPEAL` / `OPTIONAL` 类型分流。

本期同步修齐结果闭环：申诉结案必须携带 `expectedCalibrationRevision`；改判须先在校准工作台追加校准决定；变级才推送新结果版本并进入再次确认。关键操作写审计日志，并按约定节点发送飞书应用通知。

## User Stories

1. As a Leader, I want a first-level Interviews workspace in navigation, so that I can manage result-communication meetings without hunting through appeals.
2. As an HR, I want the same Interviews workspace within my org scope, so that I can schedule and record interviews for employees I support.
3. As an Admin, I want access to Interviews across authorized scope, so that I can cover or correct interview records when needed.
4. As an employee, I do not want a first-level Interviews menu, so that my surface stays focused on result confirmation.
5. As a Leader, I want to create a scheduled interview for a participant whose status is result-published, appealing, re-confirming, or confirmed, so that I only schedule after results exist.
6. As a Leader, I want the system to reject scheduling before results exist, so that interview is not confused with mid-evaluation coaching.
7. As a Leader, I want multiple interviews for the same participant in one cycle, so that follow-up conversations can be recorded separately.
8. As a Leader, I want scheduling to require interview start/end time, so that the appointment is concrete.
9. As a Leader, I want the system to create a Feishu calendar event using my user access token when I schedule, so that the meeting appears as organized by me.
10. As a Leader, I want the employee to be invited to that calendar event by default, so that they receive a normal Feishu meeting invite.
11. As a Leader, I want myself added as an attendee/organizer by default, so that I am on the calendar event without extra steps.
12. As a Leader, I want to optionally add extra attendees (for example HRBP), so that joint interviews are supported.
13. As a Leader, I want the interview record to store the Feishu calendar event identifier, so that the system can open and sync that event later.
14. As a Leader, I want the interview detail page to show/open the linked Feishu calendar event, so that I can jump to the real schedule.
15. As a Leader, I want rescheduling an interview to update the Feishu calendar event time, so that employee calendars stay accurate.
16. As a Leader, I want cancelling an interview to set status `CANCELLED` and cancel the Feishu calendar event, so that no ghost meeting remains.
17. As a Leader, I want cancelled interviews to remain visible in the timeline, so that history is auditable.
18. As a Leader, I want to create a new interview after cancellation, so that a wrong booking does not block a later conversation.
19. As a Leader, I want to mark a scheduled interview completed and enter a single result notes field, so that post-meeting recording stays simple.
20. As a Leader, I want completion to be blocked until result notes are provided, so that completed interviews always have a record.
21. As an HR, I want to complete or edit interview notes for interviews in my scope even if I did not create them, so that coverage and co-interviewers can finish the record.
22. As an Admin, I want to edit interview notes in scope, so that operational corrections are possible.
23. As a Leader, I want interview notes to remain editable after completion, so that I can fix typos or enrich the record later.
24. As an employee, I want to see my scheduled interview time on the result confirmation page, so that I know when the conversation is planned.
25. As an employee, I want a link/entry to the Feishu calendar event from the result page, so that I can open the meeting in Feishu.
26. As an employee, I must not see interview result notes, so that internal communication records stay with Leader/HR/Admin.
27. As a Leader, I want to optionally link an interview to an existing open appeal, so that appeal-related conversations are connected without merging the two domains.
28. As a Leader, I want to create an interview with no appeal link, so that ordinary result communication does not require an appeal.
29. As a Leader, I want creating or completing an interview to leave appeal status unchanged, so that interview actions do not silently mutate appeal workflow.
30. As an HR, I want the appeals list to remain the queue for assignment and resolution, so that case handling stays in one place.
31. As an HR, I want to assign an appeal handler from the appeals list, so that ownership is explicit.
32. As an HR, I want “add interview / view interview” from an appeal to open the Interviews workspace (create linked or open detail), so that interview forms are not duplicated on the appeals page.
33. As an HR, I want appeal status to be only `PENDING` or `RESOLVED`, so that status does not drift from interview records.
34. As an HR, I want the UI to show an “in interview” badge derived from linked scheduled/completed interviews, so that I still see progress without a third appeal status.
35. As an HR, I want resolving an appeal that keeps the same final level to return the participant to result-published (or the agreed non-reconfirm path), so that no unnecessary re-confirm is forced.
36. As an HR, I want resolving an appeal that changes the final level to require a prior explicit calibration decision, so that grade changes stay in the calibration audit trail.
37. As an HR, I want the resolve API to require `expectedCalibrationRevision`, so that concurrent calibration changes cannot silently race.
38. As an HR, I want the appeals UI to stop sending a direct `adjustedLevel` as the grade-change mechanism, so that frontend matches backend invariants.
39. As an HR, I want the UI to guide me to the calibration workbench when I intend to change the grade, then return to resolve, so that the calibrate-then-resolve flow is operable.
40. As an employee, I want to file at most one appeal per cycle against the published result version, so that ADR single-appeal rules remain enforced.
41. As an employee, I want confirmation and appeal to remain mutually exclusive on the current result version, so that I cannot both confirm and appeal the same version.
42. As an employee, I want a notification when my appeal is filed to my Leader (and in-scope HR as designed), so that handling can start promptly.
43. As an employee, I want an application notification when an interview is scheduled for me, so that I am aware even if I miss calendar UI.
44. As an employee, I want an application notification when my interview is cancelled, so that I do not show up to a cancelled meeting.
45. As an interview attendee, I want cancellation notifications as well when I was added beyond the employee, so that co-attendees stay aligned.
46. As an employee, I want a notification when an appeal is resolved with no grade change, so that I know the case is closed.
47. As an employee, I want the existing re-confirm notification path when appeal resolution changes the visible final level, so that I can confirm the new result version.
48. As an employee, I do not want a notification that exposes interview result notes on completion, so that internal notes are not leaked to me.
49. As a Leader, I want interview list filters for status and whether linked to an appeal, so that I can find scheduled work quickly.
50. As a Leader, I want interview detail to show a business timeline (schedule, reschedule, complete, cancel, optional appeal link events), so that I understand the conversation history.
51. As an HR, I want appeal detail/timeline material to include linked interview appointment facts without embedding the full notes editor, so that case context is available while editing stays in Interviews.
52. As an auditor, I want audit events for interview schedule, reschedule, cancel, complete, and notes update, so that who changed what is traceable.
53. As an auditor, I want audit events for appeal create, assign, and resolve, so that the appeal chain remains auditable.
54. As an auditor, I want audit events to store actor, time, action, target ids, and a business summary—not a field-level diff UI—so that compliance needs are met without an audit console project.
55. As a Leader, I want permissions for interview write actions to follow existing org scope rules, so that I cannot operate outside my managed participants.
56. As an HR, I want the same scope rules for interview writes, so that HR coverage matches other result-chain permissions.
57. As an implementer, I want interview type enums `APPEAL` / `OPTIONAL` removed from business branching, so that association is expressed only by optional `appealId`.
58. As an implementer, I want existing APPEAL-typed rows with `appealId` migrated as linked interviews, so that historical data remains meaningful.
59. As an implementer, I want `IN_INTERVIEW` appeal statuses migrated to `PENDING` (with UI derivation thereafter), so that the simplified state machine is consistent.
60. As an employee, I want my result page to show appeal progress without requiring a broken `appeals[]` mock on `getCurrent` if a dedicated read model is provided, so that appeal/interview appointment status is actually visible.
61. As a Leader, I want Feishu calendar create/update/cancel failures to surface as clear business errors and not leave an inconsistent scheduled record without an event id, so that appointments stay trustworthy.
62. As a Leader, I want comments and UI copy in Chinese, so that the product matches repository communication conventions.
63. As an Admin, I want cycle archive/rollback existing invalidation rules to continue applying to appeals and interviews, so that withdrawn cycles do not keep active interview workflows.
64. As a product owner, I want personal profile interview history and reports/export of interview completion rate deferred, so that this delivery stays on the core loop.

## Implementation Decisions

- Treat Interview as an independent capability with its own application service and HTTP API surface (list/detail/schedule/reschedule/cancel/complete/update notes/link appeal). Prefer extracting interview write/read paths out of the current appeal-only interview helpers rather than growing the strong-coupled `addInterview` behavior.
- Keep Appeal as the case-management aggregate for create, assign, and resolve. Appeals list UI remains responsible for queue, handler assignment, and resolve; it deep-links into Interviews for scheduling/recording.
- Interview statuses: `SCHEDULED` | `COMPLETED` | `CANCELLED`.
- Scheduling is allowed only when the participant is in a result-chain status after publish: result published, appealing, re-confirming, or confirmed. Reject earlier statuses.
- Multiple interviews per participant per cycle are allowed.
- Weak association: optional `appealId`. Null means ordinary performance interview; non-null means linked to that appeal. Creating/completing/cancelling interviews must not auto-transition appeal status.
- Remove business use of `PerfInterviewType` (`APPEAL` / `OPTIONAL`). Prefer schema migration away from required type, or neutralize it during transition; branching must use `appealId` only.
- Simplify appeal status to `PENDING` | `RESOLVED`. Migrate `IN_INTERVIEW` → `PENDING`. UI may derive “面谈中” from presence of linked non-cancelled interviews.
- Appointment fields: participant, scheduled start/end, attendee open ids (default employee + operator, extras allowed), optional appeal link, Feishu calendar event id/tokens needed for sync and display.
- Completion field: single `resultNotes` (or reuse one content column renamed in API). No separate conclusion/employeeFeedback/resultAdjusted/attachment fields in the product flow.
- Attachments are explicitly not supported.
- Feishu calendar: create/update/cancel using the current operator’s user access token. Persist event id on the interview. Detail UI associates and displays/opens that event. If calendar mutation fails, fail the business operation (no successful `SCHEDULED` without event linkage).
- Notes visibility: Leader/HR/Admin in scope may read/edit notes; employees never receive notes in result APIs or notifications.
- Employee result page: read-only appointment list for self (time, status, calendar entry). No notes.
- Resolve flow remains calibrate-then-resolve with `expectedCalibrationRevision`. Frontend must be fixed to that contract; no direct grade write from appeal resolve UI.
- Notifications (app cards, in addition to native calendar invites): appeal created → Leader (+ in-scope HR); interview scheduled → employee; interview cancelled → employee and other attendees; appeal resolved with no grade change → employee; grade-changing resolve → existing re-confirm path. Do not notify employee on notes completion.
- Audit via existing `AuditService.record` style key actions: `interview.schedule`, `interview.reschedule`, `interview.cancel`, `interview.complete`, `interview.update`, plus existing/needed appeal actions. Store actor, action, target, summary—not field-level diff UI.
- Navigation: add Interviews for Leader/HR/Admin; keep Appeals for HR/Admin as today, and ensure Leader can reach interviews even if appeals nav remains HR/Admin-only.
- Update product/schema docs (`docs/数据库表结构.md` and related) when schema/status enums change; follow the postgres-prisma skill for any DB changes.
- Domain language: use 绩效周期, 参与者, 结果版本, 最终等级, 申诉, 校准, 再次确认, 面谈. Prefer 面谈 over legacy “选择性面谈/申诉面谈” type split; say “关联申诉的面谈” when linked.
- Glossary gap: `CONTEXT.md` currently defines 申诉 but not an independent 面谈 aggregate; implementation should not invent alternate synonyms. A follow-up domain-modeling pass may add 面谈 formally.
- ADR note: ADR-0003 (single appeal per cycle; no `RE_CONFIRMING → APPEALING`) remains in force. This spec does not reopen secondary appeals. Weak interview association must not create a second appeal path.
- Contradicts current schema/docs that require `IN_INTERVIEW` and `PerfInterviewType` — those are intentionally superseded by this spec for the interview/appeal boundary.

## Testing Decisions

- Good tests assert external business behavior only: status transitions, visibility rules, calendar port interactions, audit action names, notification triggers, and resolve invariants. Do not assert private helpers or incidental Prisma call shapes.
- Primary new seam: Interview application service / HTTP API. Mock Prisma, `AuditService`, Feishu calendar port, and notification sender. Cover schedule (success + pre-result rejection), reschedule/cancel sync, complete with notes, notes hidden from employee read model, optional appeal link without appeal status mutation, authorization/scope denials, and calendar failure atomicity.
- Secondary existing seam: `AppealService` resolve path (prior art: `appeal-result-version.service.spec.ts`). Cover `PENDING`/`RESOLVED` only, no auto status change from interviews, `expectedCalibrationRevision` concurrency, same-level vs level-changing outcomes, and migration compatibility for former `IN_INTERVIEW` rows.
- Do not add a separate calendar adapter unit-test suite as a required seam; calendar behavior is verified through the interview service via a fake port.
- Frontend: add focused tests where feasible for Interviews workspace critical flows and employee result-page appointment-only visibility. Feishu web component rendering may be manual/contract-checked rather than deeply unit-tested.
- Prior art: NestJS service tests with mocked Prisma/audit in `backend/src/appeal/*spec.ts` and similar modules; frontend view tests under `web/src/views/results`.
- After changes: backend `pnpm build` (and targeted jest for interview/appeal); frontend `CI=true pnpm lint` and `CI=true pnpm build` in `web/` when UI changes.

## Out of Scope

- Personal profile / performance archive timeline for interviews and appeals.
- Reports, dashboards, interview completion-rate metrics, and export of appeal/interview records.
- Interview attachments or file uploads.
- Field-level audit diff UI or a dedicated audit console.
- Overdue auto-confirm job redesign beyond what already exists for result confirmation.
- Reopening ADR-0003 to allow multiple appeals per cycle.
- Strong coupling that auto-sets appeal `IN_INTERVIEW` from interview creation.
- Keeping `APPEAL` / `OPTIONAL` as live business branching.
- Calibrate-inside-appeal-dialog direct grade editing.
- Employee visibility of interview result notes.
- Native local file storage for calendar alternatives; bot-identity calendar creation as primary path.
- Full `/appeals/[id]` duplicate detail editor that reimplements the interview form.

## Further Notes

- Confirmed testing seams with stakeholder: primary Interview API/service seam; appeal resolve remains on existing `AppealService` seam for contract alignment only.
- Grilling outcomes locked: unified `/interviews` workspace; weak appeal link; `SCHEDULED`/`COMPLETED`/`CANCELLED`; Feishu user-token calendar sync; single notes field; employee sees appointments only; calibrate-then-resolve; key-action audit; notification set A; no attachments; profile/reports deferred.
- Existing frontend appeals resolve dialog and results appeal tab likely need contract fixes as part of this delivery even though Interviews is the new center of gravity.
- Seed/baseline scripts do not currently own interview fixtures as core baseline data; only update them if schema changes make seeds fail.
- When implementing DB changes, use `.agents/skills/postgres-prisma-db-design` and keep `docs/数据库表结构.md` in sync.

## Comments

2026-07-21：由 grilling 会话收敛后经 `/to-spec` 发布；测试缝已与用户确认（面谈 API/服务为主缝，申诉结案沿用 AppealService）。
