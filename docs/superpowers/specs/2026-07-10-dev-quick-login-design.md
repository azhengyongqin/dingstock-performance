# 开发环境「快速选择员工登录」设计

## 目标

在**开发环境**下，绕过飞书 OAuth，直接在登录页选择任意已同步员工一键登录，以便快速切换不同员工、验证不同角色（HR / ADMIN / Leader / 普通员工）的功能。生产环境完全不受影响、也无法调用。

## 核心洞察

当前登录流程里，会话 JWT 由后端 `JwtService` 自行签发，载荷是 `{...LarkSessionUser, sub: open_id}`；而**角色完全由后端按 JWT 里的 `open_id` 现算**（`role_grants` 表 + 租户超管兜底 + 派生 Leader）。

因此 dev 快速登录本质上只需要「为选定的 `open_id` 签发一个正常的会话 JWT」——签完之后角色、菜单、路由拦截全部照常自动解析。**采用「真实角色」方案：登录成谁就是谁，角色照 `role_grants`/超管/下属关系解析**，不引入任何角色伪造/覆盖逻辑。要测 HR 就选一个有 HR 授权的人。

## 范围与非目标

- **仅登录页入口**：dev 快速登录 UI 只出现在 `/auth/login` 页面（开发环境），不做全局悬浮切换器。
- **不伪造角色**：不提供「强制以某角色登录」开关。
- **不改动**现有飞书 OAuth 登录流程、JWT 校验、角色解析逻辑。
- 已知取舍：dev 登录不会在 Redis 写入飞书 `user_access_token`，因此依赖 jsapi 的飞书网页组件（成员名片 `UserAvatar` 点击弹卡、`LarkMemberSelector`）在 dev 登录会话下会退化/失败。这对角色功能测试无影响，接受此限制。

## 开发环境判定（安全边界）

后端与前端都必须严格 gate，**生产环境彻底关闭**：

- **后端**：新增配置项 `auth.devLogin.enabled`，加载器默认值 = `NODE_ENV !== 'production'`（沿用 `src/config/configuration.ts` 既有「环境变量 > YAML > 默认值」优先级；可用环境变量 `AUTH_DEV_LOGIN_ENABLED` 显式覆盖）。dev 接口在 handler 入口检查该开关，关闭时抛 `NotFoundException`（对外表现为 404，不暴露接口存在）。
- **前端**：用 `process.env.NODE_ENV !== 'production'` 在构建期决定是否渲染 dev 登录区块（生产构建时该分支代码不生效）。

## 后端设计（`backend/src/auth/`）

在现有 `AuthController` / `AuthService` 上扩展，不新增模块。

### 配置

- `src/config/configuration.ts`：`loadAppConfig()` 的 `auth` 段新增 `devLogin: { enabled: boolean }`，默认 `process.env.AUTH_DEV_LOGIN_ENABLED` 优先，否则 `NODE_ENV !== 'production'`。
- `src/config/validation.schema.ts`：joi 增加可选布尔 `AUTH_DEV_LOGIN_ENABLED`。
- `config/dev.yaml` / `config/prod.yaml`：按需补 `auth.devLogin.enabled`（dev 缺省即 true，prod 显式 false 更稳妥）。

### 接口

两个接口都 **不加 `JwtAuthGuard`**（登录前调用），改为在 `AuthService` 内统一做「dev 开关」校验：关闭即 `throw new NotFoundException()`。

1. `GET /auth/dev/users`
   - 返回候选员工列表，供前端选人与角色展示。
   - 数据来源 `lark_users`，字段：`open_id`、`name`、`en_name`、`avatar`（取 `avatar_240`）、`job_title`、`department_path`（取末级部门名做展示）、`is_tenant_manager`。
   - 附带角色标记：对每个 open_id 计算 `roles`（复用 `RbacService.getExplicitRoles`）与 `isLeader`（复用 `getDerivedFlags`）。为避免 N×查询，批量实现：一次性查 `role_grants`、`leader_user_id` 计数、周期 Leader 快照，内存聚合。
   - 排序：按 `name` 升序。
   - 响应：`{ items: DevLoginUser[], total }`。

2. `POST /auth/dev/login`
   - Body：`{ open_id: string }`。
   - 校验 dev 开关 → 按 `open_id` 查 `lark_users`，不存在抛 `BadRequestException`。
   - 用查到的记录拼 `LarkSessionUser`（`open_id`/`union_id`/`user_id`/`name`/`en_name`/`avatar_url`（取 `avatar_640`）/`email`/`enterprise_email`），**复用与 OAuth 相同的 `jwtService.signAsync({...user, sub: open_id})`** 签发 JWT。
   - 不写 Redis user_access_token（如上取舍）。
   - 响应与 OAuth 内部返回一致：`{ token, user }`。

### AuthService 复用与依赖

- `AuthService` 需要读取 `PrismaService` 与 `RbacService`（算角色标记）。`RbacModule` 需被 `AuthModule` import（或把 `RbacService` 导出后注入）；避免循环依赖时，角色标记的批量查询也可直接在 auth 侧用 `PrismaService` 实现，二选一在实现计划里定。
- 抽出私有方法 `signSession(user: LarkSessionUser)`，让 OAuth 与 dev 登录共用签发逻辑，避免重复。

## 前端设计（`web/`）

### 数据/接口封装

- `src/lib/api.ts` 或就近：新增 dev 登录相关类型与调用（`fetchDevUsers()`、`devLogin(openId)`），复用 `apiFetch`（登录前无 token，接口本就免鉴权）。

### 登录页改造（`src/views/auth/login/index.tsx`）

- 仅当 `process.env.NODE_ENV !== 'production'` 时，在飞书登录按钮下方渲染一块「开发环境 · 快速切换员工」区域（视觉上与正式入口区分，如加 dev 徽标/分隔线）。
- 选人 UI 用 shadcn `Command`（`web/src/components/ui/command.tsx` 已存在）做可搜索列表：每行显示头像（`ui/avatar`，此处是纯展示不是飞书成员卡，允许直接用 `ui/avatar`）+ 姓名 + 职务/部门 + 角色徽标（`ui/badge`：HR / ADMIN / 超管 / Leader）。支持按姓名/拼音搜索（先做姓名 `includes` 过滤，够用）。
- 首次展开时拉 `GET /auth/dev/users`；加载/空态/错误态给出提示（如「未同步员工，请先在 HR 账号触发组织同步」）。
- 选中某员工 → 调 `POST /auth/dev/login` → `saveAuth(token, { name, avatar, openId })`（复用现有 `saveAuth`）→ `router.replace('/workbench')`。整段逻辑与 `/auth/callback` 保存登录态一致。

### 组件落位

- 选人区块抽成 `src/views/auth/login/dev-quick-login.tsx`（页面级视图内的子组件），登录页按开关引入，保持 `login/index.tsx` 精简。

## 数据流

```
[登录页 dev 区块]
  → GET /auth/dev/users            (免鉴权, dev 开关放行)
  → 用户在 Command 里搜索选中某人
  → POST /auth/dev/login {open_id} (免鉴权, dev 开关放行)
  → 后端查 lark_users → signSession(user) → { token, user }
  → 前端 saveAuth() → /workbench
  → AuthProvider 照常 GET /role-grants/me 解析真实角色 → 菜单/路由按真实角色生效
```

## 错误处理

- dev 开关关闭：后端两接口一律 404（`NotFoundException`），前端生产构建不渲染入口——双保险。
- `open_id` 不存在 / `lark_users` 空：后端 400；前端提示先跑组织同步。
- 网络/后端未启动：前端沿用 `apiFetch` 的错误提示。

## 测试

- 后端单测（jest）：
  - dev 开关**开启**时 `POST /auth/dev/login` 对存在的 open_id 返回可被 `verifySession` 解开的 JWT；对不存在的 open_id 返回 400。
  - dev 开关**关闭**（模拟 production 配置）时两接口抛 `NotFoundException`。
  - `GET /auth/dev/users` 的角色标记聚合正确（构造 role_grant / 超管 / 有下属三种夹具）。
- 前端：`pnpm lint` + `CI=true pnpm build` 通过；手动在 dev 起前后端，选人登录后验证不同角色的菜单/路由差异（截图验证方法见记忆 `web-ui-visual-verification`）。

## 验收标准

1. dev 环境 `/auth/login` 出现「快速切换员工」区块，可搜索选人。
2. 选中任一员工即登录进入工作台，`/role-grants/me` 返回该员工真实角色，菜单/路由随之变化。
3. 选到有 HR/ADMIN 授权或有下属的员工时，对应高权限菜单/路由可见并可用。
4. 生产构建（`NODE_ENV=production`）下：前端无该区块，后端 `/auth/dev/*` 返回 404。
5. 现有飞书 OAuth 登录流程行为不变。
