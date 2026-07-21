# PROTOTYPE NOTES — 员工 Select

## 问题

预约面谈弹窗的「员工」字段：在保持原始 Select 下拉交互的前提下，头像 / 姓名 / 职位与拼音搜索应如何呈现？

## 结论

- 胜出变体：**C**（可搜索 Select · 富触发）
- 调整：
  1. 待选列表头像用标准尺寸（`UserAvatar` `default`，非 `sm`）
  2. 选中态触发器只保留头像 + 姓名，不展示职位
- 已吸收进正式 `EmployeeSelect`；本 NOTES 仅作决策记录，预览页已切回生产组件演示
