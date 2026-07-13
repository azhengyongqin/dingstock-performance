import type { LarkSelectorOption } from '@/components/shared/lark'

/** 评审人本地编辑态所需的人员展示信息。 */
export type ReviewerMemberOption = {
  openId?: string
  name?: string
  avatarUrl?: string
}

/**
 * 将飞书 Selector 的选中结果适配为评审人数据。
 * 飞书的姓名、头像位于 entity 内；顶层字段仅保留为兼容旧组件返回值的兜底。
 */
export const reviewerFromMemberOption = (option: LarkSelectorOption): ReviewerMemberOption => {
  return {
    openId: option.id,
    name: option.entity?.name ?? option.name ?? option.label,
    avatarUrl: option.entity?.avatarUrl ?? option.avatarUrl
  }
}
