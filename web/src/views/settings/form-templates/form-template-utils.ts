import { flushSync } from 'react-dom'

import type {
  PerfFormDimensionKind,
  PerfFormTemplateDimension,
  PerfFormTemplateVersionStatus
} from '@/lib/perf-api'

/** 前端换序动画用的稳定 key；后端 ValidationPipe whitelist 会剥掉。 */
export type WithClientKey = { id?: number; clientKey?: string }

export const createClientKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`

export const formRowKey = (row: WithClientKey, fallback: string) =>
  row.clientKey ?? (row.id != null ? `id-${row.id}` : fallback)

/** view-transition-name 仅允许部分字符，避免 UUID 等非法 ident。 */
export const toViewTransitionName = (prefix: string, key: string) =>
  `${prefix}-${key.replace(/[^a-zA-Z0-9_-]/g, '')}`

/**
 * 用同文档 View Transition 做换序位移动画。
 * 不走 motion layout 投影，因此不会与手风琴展开/收起抢 transform。
 */
export const runReorderTransition = (action: () => void) => {
  const startViewTransition = document.startViewTransition?.bind(document)

  if (!startViewTransition) {
    action()

    return
  }

  startViewTransition(() => {
    flushSync(action)
  })
}

/** 非计分维度不能遗留计算字段，避免草稿写入触发数据库约束。 */
export const normalizeDimensionKind = (
  dimension: PerfFormTemplateDimension,
  kind: PerfFormDimensionKind
): PerfFormTemplateDimension => ({
  ...dimension,
  kind,
  weight: kind === 'REGULAR' ? dimension.weight : null,
  isCore: kind === 'REGULAR' ? dimension.isCore : false
})

export type FormTemplateActions = {
  canEdit: boolean
  canPublish: boolean
  canCreateDraft: boolean
  canArchive: boolean
}

/**
 * 评估表单模板版本的前端操作边界。
 * 后端仍是最终权限防线；这里用于确保 HR 不会看到误导性的写操作。
 */
export const getFormTemplateActions = (
  status: PerfFormTemplateVersionStatus,
  isAdmin: boolean
): FormTemplateActions => ({
  canEdit: isAdmin && status === 'DRAFT',
  canPublish: isAdmin && status === 'DRAFT',
  canCreateDraft: isAdmin && status === 'PUBLISHED',
  canArchive: isAdmin && status === 'PUBLISHED'
})
