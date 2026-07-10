# 管理员可编辑进行中周期的每个步骤 — 设计方案

- 日期：2026-07-10
- 目标：更新绩效周期编辑逻辑，即使周期处于「进行中」状态，**管理员（ADMIN）** 也能编辑周期的每个配置步骤。

## 一、需求与决策

现状：绩效周期一旦从 DRAFT/PENDING 启动，配置即被锁定。锁定由前后端双层、以周期状态为唯一开关实现：

- 后端 `CycleService.assertEditable`（`backend/src/cycle/cycle.service.ts:81`）与 `ParticipantService.assertMutable`（`backend/src/participant/participant.service.ts:101`）：状态不是 DRAFT/PENDING 即抛 409。
- 前端 `web/src/views/cycles/edit/index.tsx:182`：`editable = status ∈ {DRAFT, PENDING}` 禁用向导内全部控件。

已确认的决策（与用户逐条确认）：

1. **权限范围**：仅 `ADMIN` 放开。`HR` 保持现状（仅 DRAFT/PENDING 可编辑）。
2. **状态范围**：除 `ARCHIVED` 外全放开（DRAFT/PENDING/SELF_REVIEW/REVIEWING/AI_ANALYZING/CALIBRATING/CONFIRMING 均可编辑）。
3. **数据安全**：破坏性修改需二次确认——后端返回受影响数据统计，前端确认后带 `confirm:true` 重放执行。
4. **不做**（YAGNI）：改权重/评级区间**不回溯重算**已提交的评审/结果，旧数据保留旧快照，仅警示 + 审计。

## 二、破坏性判定与「已产生数据」口径

维度与评分数据之间是 **JSON 逻辑引用**（`dimensionId` 落在 `PerfReview.dimensionScores` 等 JSON 字段），无数据库外键。逐维度精确匹配成本高且脆弱，故采用**周期级计数**（宁可多问一次，安全优先）：

- 「周期已产生数据」= 该周期下任一过程表存在记录：`PerfSelfReview` / `PerfReview` / `PerfManagerReview` / `PerfCalibration` / `PerfResult`（均通过 `participant.cycleId` 关联过滤计数）。
- 仅当**操作人是 ADMIN 且周期处于进行中（非 DRAFT/PENDING/ARCHIVED）且周期已产生数据**时，才对破坏性操作要求二次确认。

破坏性操作定义：

| 操作 | 破坏性判定 |
| --- | --- |
| `upsertDimensions` | 删除已有维度，或改已有维度的 `weight`/`scoringMethod`/`type` |
| `upsertEvaluationRule` | `levels`（评级区间）发生变化 |
| `applyTemplate` | 整套覆盖，进行中必然破坏性 |
| 移除考核人员 | 该周期已产生数据 |
| `updateCycle`（基础信息）/ 新增维度 / 改名 / 时间窗口 / 通知规则 / 改晋升开关 / 新增人员 | 非破坏性，无需确认 |

## 三、后端改动

### 3.1 RbacService 增 `isAdmin`

`backend/src/rbac/rbac.service.ts` 增：
```ts
async isAdmin(openId: string): Promise<boolean> {
  return (await this.getExplicitRoles(openId)).includes(PerfRole.ADMIN);
}
```

### 3.2 两道门控改角色感知

`CycleService.assertEditable` 与 `ParticipantService.assertMutable` 改为异步、接收 `operatorOpenId`：
```ts
if (await rbac.isAdmin(operatorOpenId)) {
  if (status === ARCHIVED) throw new ConflictException('周期已归档，配置不可修改');
  return; // ADMIN：非归档即可编辑
}
if (status !== DRAFT && status !== PENDING) throw new ConflictException('周期已启动，配置不可修改');
```
- `CycleService` 构造函数注入 `RbacService`（CycleModule 已 import RbacModule）。
- 调用点透传已有的 `operatorOpenId`：`updateCycle`/`upsertEvaluationRule`/`upsertDimensions`/`applyTemplate`；participant 的 `addByOpenIds`/`addByDepartments`/`remove`。

### 3.3 破坏性确认契约

- DTO 增可选 `confirm?: boolean`：`UpsertDimensionsDto`、`UpsertEvaluationRuleDto`、`ApplyTemplateDto`；participant `remove` 用 `?confirm=true` query。
- 破坏性且未确认 → 抛结构化 409：
```ts
throw new ConflictException({
  code: 'DESTRUCTIVE_EDIT_REQUIRES_CONFIRM',
  message: '该修改会影响已产生的评估数据，请确认后继续',
  impact: {
    changes: string[],          // 如 ['删除维度「工作业绩」', '调整维度「价值观」权重 30→40']
    affectedData: { selfReviews, reviews, managerReviews, calibrations, results },
  },
});
```
- 确认执行后，在既有 AuditLog 上补 `detail.inProgressEdit=true`、`detail.confirmed=true`。

### 3.4 删除人员外键兜底

`ParticipantService.remove` 在进行中删除时，捕获 Prisma 外键约束错误（P2003，来自 `PerfResult`/`PerfCalibration`/`PerfAiReport`/`PerfAppeal`/`PerfInterview` 的 `onDelete: Restrict`），转为友好 409「该员工已产生结果/校准数据，无法移除」。

### 3.5 新增人员的快照回填

进行中新增考核人员时（周期已过启动），`addByOpenIds` 落库后为新参与者回填 `leaderOpenIdSnapshot`/`departmentIdSnapshot`/`jobLevelSnapshot`（沿用 `startCycle` 的 CoreHR > 通讯录口径），状态 `PENDING_SELF_REVIEW`，使其正确并入流程。DRAFT/PENDING 阶段新增维持原样（启动时统一快照）。

## 四、前端改动（`web/src/views/cycles/edit/index.tsx`）

1. `editable` 改角色+状态（`useAuth()` 取 `roles`）：
```ts
const { roles } = useAuth()
const isAdmin = roles.includes('ADMIN')
const editable = isAdmin ? cycleStatus !== 'ARCHIVED'
                         : (cycleStatus === 'DRAFT' || cycleStatus === 'PENDING')
```
2. 进行中 + ADMIN 编辑时，页头/检查步骤显示醒目提示条：「周期进行中 · 管理员编辑模式：破坏性修改需二次确认，改动将记录审计」。
3. 复用一个 `AlertDialog`/`Dialog` 二次确认组件：`saveDimensions`/`saveEvaluationRule`/`executeApplyTemplate`/`removeMember` 捕获 `code === 'DESTRUCTIVE_EDIT_REQUIRES_CONFIRM'` 的 409 → 弹窗展示 `changes` 与 `affectedData` → 确认后带 `confirm:true` 重发。
4. `ApiError` 扩展携带解析后的响应体（`body`），供前端读取 `code`/`impact`（`web/src/lib/api.ts`）。

## 五、测试

- 后端单测（`cycle.service.spec.ts` / 新增 `participant.service.spec.ts`）：
  - ADMIN 在 SELF_REVIEW 可改四类配置 + 增删人员；ARCHIVED 被拦。
  - HR 进行中仍被拦（回归）。
  - 破坏性无 `confirm` → 409 带 `code`/`impact`；带 `confirm` → 成功且写审计（`inProgressEdit`）。
  - 非破坏性进行中编辑（新增维度/改名）→ 无需 confirm。
  - 删人命中 Restrict 外键 → 友好 409。
- 前端：`web/` 下 `CI=true pnpm lint` 与 `CI=true pnpm build`。

## 六、影响面与风险

- 权威校验仍在后端；前端 `editable` 仅体验层。
- 周期级计数会「过度提示」（被删维度即使无人填过也弹确认），已按决策接受。
- 改配置不回溯重算：进行中改权重/评级后，历史评分快照与新配置口径可能不一致，由管理员承担、审计留痕。
