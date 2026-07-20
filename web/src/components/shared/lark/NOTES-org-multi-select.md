# 人员/组织多选弹窗

## 结论

- 胜出变体：**A — 飞书双栏钻取**
- 原因：与产品截图一致，支持人/部门混选与组织钻取，适合周期加人、角色授权等场景
- 组件：`LarkOrgMemberMultiSelectDialog`
- 实验台：`/component-test` → 组织人员多选

## 已落地交互

1. 搜索框有清除按钮；关闭再打开保留上次关键字（仅清除按钮或手动改写会变）
2. 员工行：勾选框 / 头像 / 姓名整行可切换选中（避免 Checkbox 双触发）
3. 部门行：勾选框 / 组织图标 / 名称可切换选中；「下级」单独钻取（`text-primary`）
4. 搜索支持拼音/首字母模糊匹配，命中片段主题色高亮
5. `onConfirm(items, expandedUsers)` + 导出 `expandOrgMultiSelectToUsers`：部门展开为子树全量用户并去重
