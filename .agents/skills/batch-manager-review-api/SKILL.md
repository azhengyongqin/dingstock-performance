---
name: batch-manager-review-api
description: >-
  通过开发态 API（devLogin + manager draft/submit）批量完成多人上级评估，可选随机 A/B 档分数。
  当用户说「批量完成上级评估」「API提交上级评估」「批量提交 Leader 评估」、
  「完成某某的上级评估」、点名多个被评人用接口而非浏览器填写上级评估时使用。
  单人页面交互测试仍走 test-manager-review。
disable-model-invocation: false
---

# 批量 API 完成上级评估

用后端接口按「Leader → 被评人」提交上级评估，不走浏览器。默认**直接提交生效**；仅当用户明确说「只保存草稿」时停在 draft。

前置：`backend` 已启动（本地默认 `http://localhost:3000`），Postgres 可用；需 `auth.devLogin.enabled`。

## 与浏览器 Skill 的分工

| 场景 | Skill |
|------|--------|
| 单人填表、测 UI 交互 | `test-manager-review`（Browser） |
| 多人造数、随机档位分数、线上批量 | **本 Skill（API）** |

360° 批量见 `batch-peer-review-api`。

## 操作流程

```
- [ ] 1. 解析被评人列表、是否提交、分数策略（随机 A|B 档 / 固定等级 / 固定分）
- [ ] 2. 查库得到 ACTIVE 参与人 + leader_open_id_snapshot（勿伪造 Leader）
- [ ] 3. 对每位 Leader POST /auth/dev/login 取 token
- [ ] 4. GET /evaluations/manager?participantId= 拉 MANAGER 子表单维度 key
- [ ] 5. 组装 dimensions（SCORE 写 rawScore，RATING 写 rawLevel + 评语）；已生效则先 PUT draft 再 POST submit
- [ ] 6. 确认提交成功（接口返回 stageLevel / compositeScore；或查库 submission）
- [ ] 7. 用表格向用户汇报各维度分数与阶段等级
```

优先执行脚本（见下）；脚本参数不够时再内联 Node 调用同一套 API。

## 查参与人与 Leader

Schema：`performance`。员工名在 `lark_users.name`。上级身份只认 `perf_participants.leader_open_id_snapshot`。

```sql
SELECT pe.name AS employee,
       p.id AS participant_id,
       p.leader_open_id_snapshot AS leader_open_id,
       lu.name AS leader_name
FROM performance.perf_participants p
JOIN performance.lark_users pe ON pe.open_id = p.employee_open_id
LEFT JOIN performance.lark_users lu ON lu.open_id = p.leader_open_id_snapshot
WHERE pe.name = ANY($reviewees)
  AND p.status::text = 'ACTIVE'
ORDER BY pe.name;
```

成功标志：每人一行 `participant_id` 且 `leader_open_id` 非空；缺行或无 Leader 则报告并跳过。

## API 契约

Base：`http://localhost:3000`（可用 `PERF_API_BASE` / `--base` 覆盖）。

| 步骤 | Method | Path | Body / Query |
|------|--------|------|----------------|
| 登录 | POST | `/auth/dev/login` | `{ "open_id" }` → `{ token }`（用 **Leader** 的 open_id） |
| 上下文 | GET | `/evaluations/manager?participantId=<id>` | Header `Authorization: Bearer <token>` |
| 草稿 | PUT | `/evaluations/manager/draft` | `{ participantId, dimensions }` |
| 提交 | POST | `/evaluations/manager/submit` | `{ participantId, dimensions }` |

`dimensions` 项形状（SCORE 维度示例）：

```json
{
  "subformKey": "…",
  "dimensionKey": "…",
  "rawScore": 85,
  "fields": [{ "fieldKey": "…", "value": "评语文案" }]
}
```

从 context 的 `form.subforms` 中取 `type === 'MANAGER'`：

- `scoringMethod === 'SCORE'` → 写 `rawScore`（0–100）
- `scoringMethod === 'RATING'` → 写 `rawLevel`（`A`/`B`/`C`/`S`）
- `NON_SCORING`（若有）→ 填必填字段；`SINGLE_SELECT` 取首个选项
- 维度 / 字段 **key 以接口为准**，勿写死

默认基线三维度：`核心业绩`、`价值观`、`职业素养与潜力`（均为 SCORE + LONG_TEXT 评语；评语 `requiredRule` 可能为 CONDITIONAL，批量时仍建议始终填写）。

**重新提交**：`state === 'EFFECTIVE'` 时先 PUT draft，再 POST submit。

## 分数与评语策略

- 默认 `random-ab`：每维度独立随机 A 档（80–89）或 B 档（70–79）。
- 固定等级 `A`/`B`/`C`/`S`：映射为 85 / 72 / 50 / 95。
- 也可传单个数字 `0–100`：所有计分维度用同一分。
- 评语约 80～150 字，按被评人职务改写（设计 / 研发 / 其他），勿写空字符串。

## 可执行脚本

在仓库根或任意目录执行：

```bash
node .agents/skills/batch-manager-review-api/scripts/submit-manager-reviews.mjs \
  --reviewees 史千航,冯文博 \
  --scores random-ab \
  --mode submit
```

常用参数：

| 参数 | 说明 | 默认 |
|------|------|------|
| `--reviewees` | 被评人姓名，逗号分隔 | 必填 |
| `--scores` | `random-ab` / `A` / `B` / `C` / `S` / `0-100` | `random-ab` |
| `--mode` | `submit` 或 `draft` | `submit` |
| `--base` | API Base URL | `http://localhost:3000` |
| `--database-url` | Postgres URL | `postgres://dingstock:dingstock@localhost:5432/dingstock` |

环境变量：`PERF_API_BASE`、`DATABASE_URL`、`PERF_BACKEND_PACKAGE`（`pg` 所在 backend 的 `package.json` 路径；线上 release 目录用）。

成功标志：stdout 打印每人各维度分数与阶段等级；退出码 0；submit 时接口返回 `stageLevel` / `compositeScore`。

## 线上（AI-Service-Center）

服务器 `8.137.151.95`，SSH 别名 `AI-Service-Center`。部署约定见 `deploy-ai-service-center`。

1. 将脚本拷到服务器（或从仓库 release 可读路径执行）。
2. 从 `shared/backend.prod.yaml` 解析 `database.url`，**禁止**在终端/答复中打印连接串与密钥。
3. API 优先 `http://127.0.0.1:3001`（PM2 后端）；不通再用 `http://8.137.151.95/performance/backend`。
4. 设置 `PERF_BACKEND_PACKAGE=/root/dingstock/dingstock-performance/current/backend/package.json`。
5. 服务器上 `psql` 可能未装：用 Node + `pg`（current/backend 依赖）查库。
6. 生产示例 YAML 写明应关闭 `devLogin`；若线上实际开启可用本流程，若关闭则停下说明，勿擅自改生产 YAML。

示例：

```bash
scp .agents/skills/batch-manager-review-api/scripts/submit-manager-reviews.mjs \
  AI-Service-Center:/tmp/submit-manager-reviews.mjs
ssh AI-Service-Center 'export PATH="/root/.nvm/versions/node/v26.4.0/bin:$PATH"
  export PERF_BACKEND_PACKAGE=/root/dingstock/dingstock-performance/current/backend/package.json
  # DB_URL 由脚本外安全注入，勿 echo
  node /tmp/submit-manager-reviews.mjs \
    --reviewees 史千航,冯文博 \
    --scores random-ab \
    --mode submit \
    --base http://127.0.0.1:3001 \
    --database-url "$DB_URL"'
```

## 汇报格式

```
| Leader → 员工 | 核心业绩 | 价值观 | 职业素养与潜力 | 阶段等级 |
| ... | 分或等级 | ... | ... | A/B/... |
```

并注明：提交 / 仅草稿、跳过的无 Leader 人员。

## 常见阻塞

| 现象 | 处理 |
|------|------|
| 无 ACTIVE 参与人或无 Leader 快照 | 报告后跳过；勿伪造 |
| `devLogin` 404 / 关闭 | 停下说明；生产勿擅自改 YAML |
| Forbidden / 非当前 Leader | 核对 `leader_open_id_snapshot` 与登录身份 |
| submit 校验失败 | 打印接口错误体；检查维度 key / 必填字段 |
| 浏览器 Skill 已适用 | 单人 UI 仍用 `test-manager-review`，勿混用 |
