# PROTOTYPE — 人员/组织多选弹窗

## 问题

飞书截图式的「左栏组织钻取 + 右栏已选 + 人/部门混选」，在真实 `/contact` 数据下交互是否成立？相对「左树右表」和「搜索优先单栏」，哪套更适合周期加人 / 角色授权？

## 怎么看

1. 启动后端（含已同步通讯录）与前端：`backend` → `pnpm start:dev`，`web` → `pnpm dev`
2. 打开 `http://localhost:3001/component-test`，左侧选 **组织人员多选**
3. 底部切换条或 `?variant=A|B|C`（键盘 ← →）：
   - **A** 飞书双栏钻取（主候选，`LarkOrgMemberMultiSelectDialog`）
   - **B** 左树右表（只能选人）
   - **C** 搜索优先单栏（复用 `LarkMemberSelector`）

成功标志：A 能钻进真实部门、搜索到真实员工、勾选后右侧出现「已选：N 人，M 个部门」，⌘+Enter 确认后右侧状态区更新。

## 结论（待填）

- 胜出变体：
- 原因：
- 下一步：吸收进业务页 / 删除丢弃变体
