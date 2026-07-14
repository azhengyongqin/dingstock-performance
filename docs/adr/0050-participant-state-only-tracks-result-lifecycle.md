# 参与者状态只表达结果主链生命周期

参与者状态固定为 `ACTIVE`（进行中）、`CALIBRATED`（已形成首次校准并锁定评估）、`RESULT_PUBLISHED`（当前结果版本已推送）、`APPEALING`（申诉处理中）、`RECONFIRMING`（申诉处理后等待再次确认）、`CONFIRMED`（本人确认或视同确认）、`NO_RESULT`（本周期无绩效结果）和 `WITHDRAWN`（中途退出）。删除 `PENDING_SELF_REVIEW`、`SELF_SUBMITTED`、`RETURNED`、`REVIEWED`、`AI_DONE` 等任务进度状态。自评、360°和上级评估使用各自答卷状态，AI 使用独立任务状态。周期归档后全部参与者记录随周期统一只读，不再设置参与者 `ARCHIVED` 状态。

重新校准导致新等级并重新推送时，普通场景回到 `RESULT_PUBLISHED`；申诉处理后的结果进入 `RECONFIRMING`。本人确认和超时视同确认都进入 `CONFIRMED`，但具体方式由独立确认记录区分。

**Considered Options**：把每个任务节点都编码进参与者单一状态适合严格串行流程，但当前自评、360°、上级评估、AI、逐人校准和结果确认可以并行或独立变化，线性枚举会不断增加组合状态。只让参与者状态表达结果主链，把任务状态留在任务对象上，能减少非法组合和状态推进耦合。

**Consequences**：现有参与者状态枚举、迁移图和依赖它的看板查询需要重构。页面进度必须聚合答卷、AI、校准、结果版本、确认和申诉，而不能只读取一个参与者枚举。归档校验以 `CONFIRMED`、`NO_RESULT`、`WITHDRAWN` 等已收口条件判断。
