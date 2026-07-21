---
name: deploy-ai-service-center
description: 将 dingstock-performance 初始化部署或更新发布到 SSH 主机 AI-Service-Center，并维护生产 YAML、PM2、Caddy、Prisma migration、baseline 和版本回滚。用户提到“部署到 AI-Service-Center”“发布绩效系统”“更新服务器代码/配置”“同步 baseline”“重启生产服务”或“回滚服务器版本”时使用。
---

# 部署 AI-Service-Center

把仓库中的部署文档和配置作为唯一事实来源，安全维护 `AI-Service-Center` 上的绩效系统。不要在本 Skill 中另存一套部署命令。

## 固定边界

- 使用 SSH 别名 `AI-Service-Center`，服务器 IP 为 `8.137.151.95`。
- 使用服务器目录 `/root/dingstock/dingstock-performance` 和公网路径 `/performance`。
- 只管理 PM2 进程 `dingstock-performance-backend`、`dingstock-performance-web`。
- 保留同一服务器上的其他 PM2 进程，尤其不要删除或重建 `dingstock-finance`。
- 把真实生产配置保存在服务器 `shared/backend.prod.yaml`；禁止写回仓库、终端输出或最终答复。
- 使用项目内 `deploy/pm2/` 与 `deploy/caddy/` 配置；不要在服务器维护无来源副本。

## 选择流程

根据用户目标只读取并执行对应文档：

- 首次部署或重建服务器：完整读取 `deploy/初始化部署.md`。
- 代码、Prisma migration、PM2 或 Caddy 变更：读取 `deploy/更新发布.md` 第一节。
- PostgreSQL、Redis、飞书 OAuth 或其他生产 YAML 变更：读取 `deploy/更新发布.md` 第二节。
- 默认表单、默认配置模板或基线周期变更：读取 `deploy/更新发布.md` 第三节。
- 回滚：读取 `deploy/更新发布.md` 第四节。

需要组合发布时按“上传并构建新 release → migration → 切换 current/PM2 → Caddy → baseline → 验收”执行；只执行适用步骤。

## 发布前检查

1. 读取根目录 `CLAUDE.md` 和本次所需部署文档。
2. 检查 `git status --short`、相关 diff、`deploy/pm2/ecosystem.config.cjs` 和 Caddy 配置。
3. 确认 `deploy/` 已被 Git 跟踪。文档使用 `git archive HEAD`，相关改动未提交时不要假装已经上传；先明确报告阻塞，等待用户提交或授权其他发布方式。
4. 通过 SSH 只读检查当前 `current` 指向、PM2 状态和 Caddy 状态，记录原版本以便恢复。
5. 检查命令输出时遮蔽数据库、Redis、飞书密钥；不要读取后完整打印生产 YAML。
6. baseline 会先清理再重建基线业务数据。用户未明确要求同步 baseline 时，不要在普通发布中执行；发现相关基线变更时先说明影响并取得确认。

## 执行要求

1. 严格使用对应部署文档中的命令和顺序。
2. 先在新 release 安装依赖、构建并执行 migration，全部成功后再切换 `current`。
3. 只重建本项目的两个 PM2 进程，并在成功后执行 `pm2 save`。
4. 仅在项目 Caddy 配置变化时安装并 reload；reload 前必须先 `caddy validate`。
5. 只有生产 YAML 变化时，直接更新共享 YAML 并只重启后端，不创建 release。
6. 飞书 OAuth 回调发生变化时，同时提醒核对飞书开放平台白名单：`http://8.137.151.95/performance/backend/auth/lark/callback`。

## 验收与失败处理

完成后逐项确认：

- 本项目两个 PM2 进程为 `online`，服务器原有 PM2 服务仍为 `online`。
- Caddy 为 `active`，配置验证通过。
- `/performance`、`/performance/backend/`、`/performance/backend/api-docs` 均返回 HTTP 200。
- 若执行 baseline，输出包含 `基线数据初始化完成`，随后后端恢复 `online`。

健康检查失败时先查看本项目 PM2 日志。若没有不兼容的数据库 migration，按更新文档回滚到记录的旧 release；若 migration 可能不兼容，不要自动回滚数据库，停止操作并报告风险。

## 交付结果

简要报告：

- 发布类型和 release id；
- 代码、YAML、PM2、Caddy、migration、baseline 中实际变更的项目；
- PM2、Caddy 和三个 HTTP 地址的验收结果；
- 是否保留原有服务；
- 任何未完成事项或需要用户在飞书开放平台处理的配置。
