---
name: batch-peer-review-api
description: >-
  通过开发态 API（devLogin + peer draft/submit）批量完成多人 360° 评估，可选随机 A/B 评级。
  当用户说「批量完成360」「多人登录填360」「API提交环评」「批量提交360评估」、
  点名多个评估人对多个被评人完成 360，或明确要求用接口而非浏览器填写时使用。
  单人页面交互测试仍走 test-peer-review。
disable-model-invocation: false
---

# 批量 API 完成 360° 评估

用后端接口按「评估人 → 被评人」矩阵提交 360°，不走浏览器。默认**直接提交生效**；仅当用户明确说「只保存草稿」时停在 draft。

前置：`backend` 已 `pnpm start:dev`（默认 `http://localhost:3000`），本地 Postgres 可用。

## 与浏览器 Skill 的分工

| 场景 | Skill |
|------|--------|
| 单人填表、测 UI 交互 | `test-peer-review`（Browser） |
| 多人 × 多被评人、造数、随机评级 | **本 Skill（API）** |

## 操作流程

```
- [ ] 1. 解析用户给出的评估人列表、被评人列表、是否提交、评级策略（固定 / 随机 A|B）
- [ ] 2. 查库得到有效指派（assignment_id + reviewer open_id）
- [ ] 3. 对每位评估人 POST /auth/dev/login 取 token
- [ ] 4. GET /evaluations/peer?assignmentId= 拉表单维度 key
- [ ] 5. 组装 dimensions（评级 + 评语）；已生效则先 PUT draft 再 POST submit
- [ ] 6. 查库确认 assignment/submission 均为 SUBMITTED（或草稿为 DRAFT）
- [ ] 7. 用表格向用户汇报每人每维度评级
```

优先执行脚本（见下）；脚本参数不够时再内联 Node 调用同一套 API。

## 查指派

Schema：`performance`。员工名在 `lark_users.name`。

```sql
SELECT e.name AS reviewer, pe.name AS reviewee,
       a.id AS assignment_id, p.id AS participant_id,
       a.relation::text, a.status::text AS assignment_status,
       s.status::text AS submission_status, e.open_id AS reviewer_open_id
FROM performance.perf_reviewer_assignments a
JOIN performance.lark_users e ON e.open_id = a.reviewer_open_id
JOIN performance.perf_participants p ON p.id = a.participant_id
JOIN performance.lark_users pe ON pe.open_id = p.employee_open_id
LEFT JOIN performance.perf_evaluation_submissions s
  ON s.reviewer_assignment_id = a.id AND s.status IN ('DRAFT', 'SUBMITTED')
WHERE e.name = ANY($reviewers)
  AND pe.name = ANY($reviewees)
  AND a.status::text <> 'REPLACED'
ORDER BY e.name, pe.name;
```

成功标志：每人×被评人至少一行 `assignment_id`；缺行则报告「无指派」并跳过，勿伪造 assignment。

## API 契约

Base：`http://localhost:3000`（可用 `PERF_API_BASE` 覆盖）。

| 步骤 | Method | Path | Body / Query |
|------|--------|------|----------------|
| 登录 | POST | `/auth/dev/login` | `{ "open_id" }` → `{ token }` |
| 上下文 | GET | `/evaluations/peer?assignmentId=<id>` | Header `Authorization: Bearer <token>` |
| 草稿 | PUT | `/evaluations/peer/draft` | `{ assignmentId, dimensions }` |
| 提交 | POST | `/evaluations/peer/submit` | `{ assignmentId, dimensions }` |

`dimensions` 项形状：

```json
{
  "subformKey": "…",
  "dimensionKey": "…",
  "rawLevel": "A",
  "fields": [{ "fieldKey": "…", "value": "评语文案" }]
}
```

从 context 的 `form.subforms` 中取 `type === 'PEER'` 的 scoring 维度；`scoringMethod === 'RATING'` 写 `rawLevel`（`A`/`B`/`C`/`S`），字段评语写入该维度 `fields`。

**重新提交**：`state === 'EFFECTIVE'` 时先 PUT draft，再 POST submit（与前端「编辑并重新提交」一致）。

## 评级与评语策略

- 默认：每维度独立 `Math.random() < 0.5 ? 'A' : 'B'`（用户要求随机 A/B 时用此规则）。
- 用户指定固定等级（如全 A）则全部使用该等级。
- 评语按被评人职务改写（UI/研发/其他），约 80～150 字；可随 A/B 微调语气，勿写空字符串。
- 默认表单三维度：`工作贡献与责任担当`、`协作沟通与价值观`、`学习成长与潜力`（key 以接口为准，勿写死）。

## 可执行脚本

在仓库根或任意目录执行（脚本内 `cd` 不依赖 cwd）：

```bash
node .agents/skills/batch-peer-review-api/scripts/submit-peer-reviews.mjs \
  --reviewers 龙涛,彭天弘,彭良怀,彭巧丽 \
  --reviewees 史千航,冯文博 \
  --levels random-ab \
  --mode submit
```

常用参数：

| 参数 | 说明 | 默认 |
|------|------|------|
| `--reviewers` | 评估人姓名，逗号分隔 | 必填 |
| `--reviewees` | 被评人姓名，逗号分隔 | 必填 |
| `--levels` | `random-ab` / `A` / `B` / `C` / `S` | `random-ab` |
| `--mode` | `submit` 或 `draft` | `submit` |
| `--base` | API Base URL | `http://localhost:3000` |
| `--database-url` | Postgres URL | `postgres://dingstock:dingstock@localhost:5432/dingstock` |

成功标志：stdout 打印每人每维度评级表；退出码 0；库中对应 `perf_reviewer_assignments.status` 与 `perf_evaluation_submissions.status` 为 `SUBMITTED`（`--mode draft` 时 submission 为 `DRAFT`）。

## 汇报格式

向用户输出紧凑表：

```
| 评估人 → 被评人 | 工作贡献 | 协作沟通 | 学习成长 |
| ... | A/B | A/B | A/B |
```

并注明：提交 / 仅草稿、跳过的缺指派对。

## 常见阻塞

| 现象 | 处理 |
|------|------|
| 无 assignment 行 | 报告缺指派；勿继续提交 |
| `devLogin` 404 | `auth.devLogin.enabled` 关闭或非本地；停下说明 |
| 任务未开放 / Forbidden | 报告阶段或权限问题 |
| submit 校验失败 | 打印接口错误体；检查维度 key / 必填字段 |
| 浏览器 Skill 已适用 | 单人 UI 仍用 `test-peer-review`，勿混用 |
