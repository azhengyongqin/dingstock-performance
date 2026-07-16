/**
 * 飞书网页组件封装统一出口。
 * - UserAvatar：人员头像（点击弹飞书成员名片），项目内所有人员头像必须用它
 * - MemberPill：只读人员胶囊（头像 + 姓名），元信息/列表展示用
 * - LarkMemberSelector：人员搜索选择（飞书 Selector 组件）
 * - LarkMemberPickerDialog：通用人员选择弹窗（搜索 → 待确认区 → 已选成员列表）
 * - LarkProfileCard：成员名片内联容器（一般经 UserAvatar 间接使用）
 */
export { default as UserAvatar } from './UserAvatar'
export type { UserAvatarProps } from './UserAvatar'
export { default as MemberPill } from './MemberPill'
export type { MemberPillProps } from './MemberPill'
export { default as LarkMemberSelector } from './LarkMemberSelector'
export type { LarkMemberSelectorProps, LarkSelectorOption } from './LarkMemberSelector'
export { default as LarkMemberPickerDialog, memberFromSelectorOption } from './LarkMemberPickerDialog'
export type { LarkMemberPickerDialogProps, LarkPickerMember } from './LarkMemberPickerDialog'
export { default as LarkProfileCard } from './LarkProfileCard'
export { useLarkThemeSync, type LarkMountStatus } from './use-lark-component-mount'
