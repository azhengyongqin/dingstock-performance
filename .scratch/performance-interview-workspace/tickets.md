# Tickets: 绩效面谈工作台与申诉弱关联闭环

独立面谈预约/纪要/飞书日程、与申诉弱关联，并修齐申诉结案与通知。规格见同目录 `PRD.md`。

Work the **frontier**: any ticket whose blockers are all done. For a purely linear chain that means top to bottom.

## 面谈工作台主闭环

Status: resolved

**What to build:** Leader/HR/Admin 能在统一面谈工作台为「结果已推送及之后」的参与者预约面谈：系统以当前操作者身份创建飞书日程并关联展示；可改期、可取消（同步飞书）；面谈结束后填写并后续修改单一结果纪要。员工侧读模型拿不到纪要。完成后可演示完整「约 → 谈完记录 → 改期/取消」路径。

**Blocked by:** None — can start immediately.

- [x] 面谈状态支持 `SCHEDULED` / `COMPLETED` / `CANCELLED`，预约需落计划时间与飞书日程 event 关联；无 event 不得成功处于已预约
- [x] 默认邀请员工与操作者，允许追加参与人；改期/取消同步飞书日程，取消后记录仍可追溯且可再约
- [x] 完成时必填单一结果纪要；组织范围内 Leader/HR/Admin 可改纪要；面向员工的接口不返回纪要
- [x] 仅结果已推送、申诉中、再次确认中、已确认的参与者可预约；同一参与者同一周期可有多条面谈
- [x] 提供 `/interviews` 工作台（列表 + 预约/完成/改期/取消）；导航对 Leader/HR/Admin 可见
- [x] 在面谈应用服务/HTTP 主缝覆盖预约、改期/取消、完成与纪要可见性；关键操作写审计（schedule/reschedule/cancel/complete/update）
- [x] 不引入附件；不把档案/报表纳入本票

## Answer

2026-07-21：已落地 Interview 模块（预约/改期/取消/完成/改纪要 + 飞书日程端口）、`GET /interviews/mine` 员工脱敏、`/interviews` 工作台与导航；主缝单测 8 条通过；迁移 `20260721090000_interview_schedule_lifecycle` 已应用。

## 申诉弱关联与结果闭环

Status: resolved

**What to build:** 面谈与申诉分开但可挂可选关联；面谈动作不再推动申诉状态。申诉只保留待处理/已处理，界面「面谈中」由关联面谈推导。申诉队列负责指派与结案，并深链到面谈工作台。结案必须先校准再 resolve；员工在结果确认页只能看到自己的预约时间与飞书日程入口。

**Blocked by:** 面谈工作台主闭环

- [x] 预约/编辑面谈时可设置可选 `appealId`；无关联亦为合法普通绩效面谈；创建/完成/取消面谈不自动改申诉状态
- [x] 申诉主状态仅为 `PENDING` / `RESOLVED`；历史 `IN_INTERVIEW` 完成迁移；列表可用关联面谈推导「面谈中」
- [x] 业务不再按 `APPEAL` / `OPTIONAL` 分流（关联只看是否有 `appealId`）；申诉列表可深链到面谈工作台创建或查看
- [x] 申诉结案 UI/契约使用 `expectedCalibrationRevision`；改判须先追加校准决定，禁止用直传目标等级代替校准
- [x] 员工结果确认页只读展示本人面谈预约与日程入口，不展示纪要；申诉进度只读回显可用
- [x] 在既有申诉结案缝补齐两态与 resolve 不变量测试；遵守每人每周期一次申诉（ADR-0003）

## Answer

2026-07-21：申诉两态迁移 `20260721120000_appeal_two_state_status`；`InterviewService` 校验/链接 `appealId` 且不 mutate 申诉；遗留 `addInterview` 停推进状态；申诉列表 `inInterview` 推导；结案 UI 改 `expectedCalibrationRevision` + 深链 `/interviews`；结果页接 `/interviews/mine`。后端全量 475 测通过；前端 results 单测与 build 通过。

## 通知与旧模型收缩

**What to build:** 补齐应用内关键通知，并收缩旧的强耦合面谈/申诉接口与类型，使实现、表结构文档与 PRD 一致，避免双路径并存。

**Blocked by:** 面谈工作台主闭环, 申诉弱关联与结果闭环

- [ ] 通知：申诉发起 → Leader（及范围内 HR）；面谈预约 → 员工；面谈取消 → 员工及其他参与人；结案维持 → 员工；改判再确认沿用现有路径
- [ ] 完成填写纪要不向员工发通知（纪要对其不可见）
- [ ] 移除或停用会强制 `IN_INTERVIEW` / 依赖面谈类型枚举的旧写入路径，调用方全部迁到新模型
- [ ] 数据库表结构与相关产品/研发文档与两态申诉、独立面谈状态、弱关联语义一致
- [ ] 回归：主缝与申诉结案缝在收缩后仍绿；后端/前端按仓库约定完成构建校验
