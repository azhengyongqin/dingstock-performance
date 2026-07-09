# 盯潮绩效 · 前端管理后台（web）

基于飞书生态的员工绩效系统前端，技术栈：Next.js 16（App Router）+ React 19 + Tailwind CSS 4 + shadcn/ui + Recharts。

## 目录约定

- `src/app/**/page.tsx`：薄壳路由，真实 UI 在 `src/views/`
- `src/app/(pages)/`：带侧边栏的业务页面；`src/app/(blank)/`：全屏页（登录/回调）
- `src/configs/navConfig.tsx`：侧边栏导航唯一配置入口
- `src/lib/api.ts`：后端请求封装（自动携带 JWT）

## 本地启动步骤

1. **启动后端**（在仓库根的 `backend/` 目录）：

   ```bash
   cd ../backend && pnpm install && pnpm start:dev
   ```

   成功标志：后端监听 `http://localhost:3000`，访问 `http://localhost:3000/api-docs` 能看到 Swagger 文档。

2. **安装前端依赖**（在本目录 `web/`）：

   ```bash
   pnpm install
   ```

   成功标志：命令无报错退出，生成 `node_modules/`。

3. **配置环境变量**（可选，默认值即可本地运行）：

   ```bash
   cp .env.example .env
   ```

   | 变量 | 说明 | 默认值 |
   | --- | --- | --- |
   | `NEXT_PUBLIC_API_BASE_URL` | 后端 NestJS 服务地址 | `http://localhost:3000` |
   | `BASEPATH` | 部署子路径，一般留空 | 空 |
   | `NEXT_PUBLIC_APP_URL` | 前端对外地址（OG 元信息） | 空 |

   成功标志：`.env` 文件存在且 `NEXT_PUBLIC_API_BASE_URL` 指向后端。

4. **启动前端开发服务**：

   ```bash
   pnpm dev
   ```

   成功标志：终端输出 `http://localhost:3001`（**必须是 3001 端口**——后端占用 3000，且后端飞书 OAuth 配置的前端回调地址为 `http://localhost:3001/auth/callback`），浏览器访问后自动跳转到 `/workbench` 工作台。

5. **登录验证（飞书 OAuth）**：

   访问 `http://localhost:3001/auth/login`，点击「使用飞书登录」→ 跳转飞书授权 → 授权完成后回到 `/auth/callback` 并自动进入工作台。

   成功标志：右上角头像菜单显示你的飞书姓名；`localStorage` 中存在 `dingstock_token`。

6. **组织架构页联调**（唯一接真实接口的页面）：

   访问 `/settings/organization`，点击「同步组织架构」。

   成功标志：toast 提示「组织架构同步完成」，左侧出现部门树、右侧出现成员表格；后端未启动时页面显示错误提示而不是崩溃。

## 构建与检查

```bash
pnpm build         # 生产构建（成功标志：无报错，输出各路由构建结果）
pnpm lint          # ESLint 检查
pnpm check-types   # TypeScript 类型检查
```

## 页面清单

| 路由 | 说明 | 数据 |
| --- | --- | --- |
| `/workbench` | 工作台（待办 + 周期进度 + 快捷入口） | mock |
| `/cycles`、`/cycles/[id]`、`/cycles/[id]/edit` | 周期列表 / 详情 / 9 步配置向导 | mock |
| `/team-review`、`/calibrations` | 团队看板 / 绩效校准 | mock |
| `/self-review`、`/results`、`/profile/performance` | 员工自评 / 结果确认 / 绩效档案 | mock |
| `/review-tasks` | 评审任务 | mock |
| `/dashboard`、`/reports` | 绩效看板 / 报表导出 | mock |
| `/settings/organization` | 组织架构 | **真实后端** |
| `/settings`、`/appeals`、`/audit-logs` | 系统配置 / 申诉处理 / 操作日志 | mock |
| `/auth/login`、`/auth/callback` | 飞书 OAuth 登录 / 回调 | **真实后端** |
