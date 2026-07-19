# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 沟通约定

- 默认使用中文沟通与注释。为关键业务逻辑、配置边界和非显而易见的实现补充简洁中文注释。
- 教程/操作说明写成可照做的步骤，并标注每一步的成功标志。
- 需要用户作出决策或确认时，尽量提供清晰、互斥的选项，并明确标注推荐选项；每次只聚焦一个决策问题。

## Agent skills

### Issue tracker

Issues 与 PRD 使用本地 Markdown 文件跟踪，统一存放在 `.scratch/` 下；外部 PR 不作为 triage 入口。详见 `docs/agents/issue-tracker.md`。

### Triage labels

Triage 标签词表使用默认的五个 canonical labels。详见 `docs/agents/triage-labels.md`。

### Domain docs

本仓库使用 single-context 领域文档布局。详见 `docs/agents/domain.md`。

## 项目定位

基于飞书（Lark）生态的**员工绩效系统**：覆盖组织架构同步、绩效计划配置、员工自评、360°评估、上级评估、AI 辅助分析、绩效校准、结果确认、申诉面谈、数据看板与历史归档。业务背景与数据对象详见 `docs/`（中文产品/设计/研发文档），当前处于后端基建搭建阶段，业务表尚未建模。

## 仓库结构

- `backend/` — 绩效系统后端（NestJS + Prisma + PostgreSQL + Redis）,dev 固定 3000 端口 （`pnpm start:dev`）。后端开发命令都在 `backend/` 下执行。
- `web/` — 绩效系统前端（Next.js 16 App Router + shadcn/ui base-vega + TanStack Table），dev 固定 3001 端口（`pnpm dev`）。前端开发命令都在 `web/` 下执行
- `docs/` — 中文产品/设计/研发说明文档，是理解业务的权威来源。
- `shadcn-nextjs-admincn-admin-template-1.0.0/` — 前端管理后台模板（Next.js + shadcn），`web/` 以其中 `default-layout` 为基础搭建，改前端时以模板惯用法为准。
- `desgin/` — 目前为空的占位目录。

## backend 后端约定（`backend/`）

### 后端常用命令（在 `backend/` 下执行）

```bash
pnpm install              # 安装依赖（使用 pnpm，勿用 npm/yarn）

pnpm build                # 先 prisma generate 再 nest build
pnpm start:dev            # 本地开发（watch 模式）
pnpm start:prod           # 生产模式：NODE_ENV=production node dist/main

pnpm lint                 # prisma generate + eslint --fix
pnpm format               # prettier 格式化（跳过 src/generated）

pnpm test                 # prisma generate + jest 全量单测
pnpm test:e2e             # e2e 测试（test/jest-e2e.json）
pnpm test:cov             # 覆盖率

pnpm prisma:generate      # 清空 src/generated/prisma 后重新生成 client
pnpm prisma:migrate       # prisma migrate dev，新增迁移
pnpm prisma:studio        # Prisma Studio
```

运行**单个测试**：`pnpm jest src/config/configuration.spec.ts` 或按名称 `pnpm jest -t "关键字"`。注意 `pnpm test` 会先跑 `prisma:generate`；若 client 已存在，直接用 `pnpm jest ...` 更快。

改动后至少运行 `pnpm build`（会先 `prisma generate`）；涉及行为变更时补充/更新测试。

### 配置解析：环境变量 > YAML > 默认值，且 Nest 与 Prisma CLI 共用

- 配置加载器是 `src/config/configuration.ts` 的 `loadAppConfig()`。优先级：环境变量 → YAML → 硬编码默认值。
- YAML 文件按 `NODE_ENV` 选择：非生产读 `config/dev.yaml`，生产读 `config/prod.yaml`；可用 `APP_CONFIG_FILE` / `CONFIG_FILE` 临时指定。
- 关键点：**`prisma.config.ts` 直接调用同一个 `loadAppConfig()`**，因此 Prisma CLI 和 Nest 应用拿到完全一致的数据库连接串——改配置逻辑时两端会同时受影响。
- 数据库：`DATABASE_URL`（兼容旧 `POSTGRES_URI`）；Redis：`REDIS_URI`；飞书：`LARK_APP_ID` / `LARK_APP_SECRET`。部署与密钥优先用环境变量覆盖，勿写死进 YAML。
- 环境变量校验 schema 见 `src/config/validation.schema.ts`（joi）。

### 模块组织：基础设施经 SharedModule 统一导出

- 按功能模块拆分，勿把逻辑堆进 `AppModule` 或单个 service。公共能力放 `src/shared/`。
- `SharedModule`（`src/shared/shared.module.ts`）聚合并 re-export `DatabaseModule`、`LarkModule`、`RedisModule` 以及全局 `ConfigModule`；业务模块 import `SharedModule` 即可，无需重复声明基础依赖。
- 跨模块复用时只导出明确需要的 token/service，避免重复 provider。

### 数据库：Prisma 7 + 驱动适配器，生成产物在源码内

- **涉及数据库的任何改动必须先使用项目 Skill：`.agents/skills/postgres-prisma-db-design`**。触发范围包括新增/修改表、字段、主键、外键、索引、枚举、Prisma model、迁移，以及 `docs/数据库表结构.md` 表结构文档更新。使用该 Skill 时必须同步维护 `backend/prisma/schema.prisma` 与数据库表结构文档。
- `PrismaService`（`src/shared/database/prisma.service.ts`）继承 `PrismaClient`，通过 `@prisma/adapter-pg`（`PrismaPg`）直连 PostgreSQL；在 `onModuleInit` 主动 `$connect`，`onModuleDestroy` 断开。
- 生成的 client 输出到 **`src/generated/prisma`**（已在 eslint/prettier 中忽略），`prisma:generate` 会先删该目录再生成，因此 build/lint/test 前都会重建。
- 业务模块注入 `PrismaService` 访问数据库。表结构变更走 Prisma schema + 迁移，**不要在运行时自动同步生产库结构**。`prisma/schema.prisma` 目前只有 datasource/generator，业务 model 从这里开始加。

### 基线初始化脚本（强制同步规则）

- 基线业务数据由 `src/scripts/seed-baseline-data.ts`（命令 `pnpm seed:baseline`）统一初始化：**默认评估表单模板（`PerfFormTemplate` D/M）、默认配置模板（`PerfConfigTemplate`，`systemKey=DEFAULT_CONFIG`）、绩效周期草稿「2026年中绩效评定」**。脚本幂等——先清理这三类旧数据（含已发布版本，需临时禁用版本 guard 触发器）再基于权威文档重建。初始数据以 `docs/盯潮-绩效系统-评估维度规则说明.md` 与 `docs/盯潮-绩效系统-绩效等级定义和计算方式.md` 为准。
- **强制规则：当「评估表单模板 / 配置模板 / 绩效周期」相关的数据结构、数据库字段、发布校验或快照写入逻辑发生变更时，必须同步更新 `seed-baseline-data.ts`**（它复刻了 `CycleSetupService` 的配置/表单快照写入与各发布校验；schema 变更后若不同步，脚本会在写入或发布校验处失败）。改动后至少执行一次 `pnpm seed:baseline` 验证可跑通。

### 飞书集成

- `LarkModule`（`src/shared/lark/lark.module.ts`）用 `useFactory` 构建 `lark.Client`（`SelfBuild` 自建应用 + `Domain.Feishu`），provider token 为 `LARK_CLIENT`。
- 业务代码优先注入 `LarkService`；只有需要官方完整 SDK 能力时才注入 `LARK_CLIENT`。

### Redis

- `REDIS_CLIENT` token 提供 `ioredis` 实例，`lazyConnect: true`（首次使用才连接），并注册了退出时 `disconnect` 的 shutdown hook。
- 业务代码通过注入 `REDIS_CLIENT` 使用，不要在业务里直接 `new Redis()`。

### 启动与文档

- 入口 `src/main.ts`：启用 `enableShutdownHooks()`（确保 Redis 等连接在退出时释放），监听端口统一走 `ConfigService`（`app.port`）。
- Swagger 在启动阶段由 `src/shared/swagger/setup-swagger.ts` 挂载：UI 位于 `/api-docs`，JSON 位于 `/api-docs-json`。

## Web 前端约定（`web/`）

- `app/**/page.tsx` 只做薄壳，真实 UI 放 `src/views/`；带侧边栏页面放 `app/(pages)/`，全屏页放 `app/(blank)/`。
- 导航唯一入口 `src/configs/navConfig.tsx`；接口调用统一走 `src/lib/api.ts`（自动带 Bearer token）。
- 验证：改动后在 `web/` 下运行 `pnpm lint` 与 `pnpm build`（本机 pnpm 在非交互终端需加 `CI=true` 前缀）。
- **新组件开发或已有组件封装时，必须在 `web/src/app/(blank)/component-test/` 中补充对应的示例代码，用该页面验证组件的使用方式、交互状态与视觉表现。**

### 基础组件必须用 shadcn ui（强制规则）

- **页面所有基础元素（按钮、输入框、下拉框、日期选择、复选框、弹层等）一律使用 `web/src/components/ui/` 中的 shadcn 基础组件**，禁止手写原生元素（`<select>`、`<input type='date'>`、裸 `<button>` 等）或自行编写替代组件。
- `ui/` 中没有的基础组件，**从模板 `shadcn-nextjs-admincn-admin-template-1.0.0/` 复制对应组件**到 `web/src/components/ui/`（含其依赖），并按模板 views 中的组合用法使用（如日期选择 = `Popover + Calendar + Button`，参考模板 `apps/calendar/event-dialog.tsx`）。
- 模板中也没有的基础组件，**必须先向用户确认**再引入或编写，禁止直接自造。
- 不要给 ui 基础组件再包一层轻量封装（如二次包装 Select/Button）；页面直接按模板惯用法组合使用。业务级组合组件（含业务逻辑/数据的）放 `src/components/shared/`。

### 表格必须用模板的 Data Table（强制规则）

- **所有业务数据表格一律基于 `@tanstack/react-table`（`useReactTable`）实现，禁止手写 `<Table>` 直接遍历渲染业务数据**。纯展示性的 key-value 小卡片不算表格，不受此约束。
- 实现方式：复用 `web/src` 下的公共 datatable 基建（DataTable/分页/工具栏组件），各页面只写自己的 columns 定义；**列定义与页面组件分离**（仿模板 `users/list` 的 `*-table-columns.tsx` 拆分方式）。
- **按业务数据内容选择模板中对应的 Data Table 变体**（范例见模板 `default-layout/src/views/datatables/` 与 `src/views/apps/users/list/`）：
  - 带状态/类别列、需按列过滤的列表（周期、申诉等）→ `filters` 变体（列筛选 + 搜索）；
  - 有完成度/进度语义的列表（团队评审进度等）→ `progress` 变体（进度条列）；
  - 需要批量操作的列表（校准等）→ 行选择 + 批量操作条（参考 `user-bulk-action-bar`）;
  - 列很多、需要用户自选显示列的列表（考核人员等）→ `column-visibility` 变体；
  - 日志/流水类大数据量列表（操作日志等）→ `page-size-selector` + `export-button` 变体；
  - 简单小表（导出任务等）→ `basic` 变体 + 分页；
  - 企业级完整列表页（组织架构成员等）→ 完整 `users-list` 模式（toolbar 搜索 + 筛选 + 分页 + 列定义分离）。
  - 周期详情考核人员 Tab（`views/cycles/detail`）→ `column-visibility` 变体；
  - 个人绩效历史（`views/profile/performance`）、评审任务列表（`views/review-tasks`）→ `basic` 变体 + 分页；
  - 系统配置角色授权（`views/settings/role-grants`）→ `basic` 变体（受控小表，无分页、`enableSorting: false`）。
- 新增表格页面时，先在上述映射里找最贴近的变体；没有贴近的再去模板 `datatables/` 目录挑（expandable-rows、pinnable/resizable/draggable-columns、graph 等），并把新的映射关系补充到本节。

### 飞书网页组件：人员头像与选人（强制规则）

- **只要涉及飞书网页组件的需求、问题排查或组件封装，都必须先参考 `docs/飞书网页组件/` 下的项目文档；项目文档与飞书官方文档不一致时，以官方文档为准，并同步更新项目文档。**
- **人员头像一律使用 `@/components/shared/lark` 的 `UserAvatar`**（头像 + 点击弹出飞书：成员名片组件），禁止直接用 `ui/avatar` 渲染人员头像；拿不到 `open_id` 时组件自动退化为普通头像（纯展示、不可点击）。
- **人员搜索/选择优先使用 `LarkMemberSelector`

### 业务共享组件（强制规则）

- **页头一律用 `@/components/shared/PageHeader`**（title/description/actions）。模板本身没有页头组件，此为本项目的标准页头，禁止在页面里手写 h1 页头结构。
- **日期选择一律用 `@/components/shared/DatePicker` / `DateTimePicker`**：内部即模板的 `Popover + Calendar + Button` 组合（参照模板 `apps/calendar/event-dialog.tsx`），值为 `'YYYY-MM-DD'` / `'YYYY-MM-DDTHH:mm'` 字符串。禁止再自造日期选择或使用原生 `<input type='date'>`。
- **统计卡片行一律用 `@/components/shared/StatsCards`**：模板 `apps/users/list/user-stats-cards.tsx` 布局的提取，`items: { label, value, description?, icon?, iconClassName? }[]`。禁止在页面里手写 Card + `text-2xl` 统计块。
