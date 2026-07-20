import { flushSync } from 'react-dom'

import type {
  FormTemplateValidationIssue,
  PerfFormAudience,
  PerfFormDimensionType,
  PerfFormTemplateSubformType,
  PerfFormTemplateDimension,
  PerfFormTemplateVersionStatus
} from '@/lib/perf-api'

/** 与 FormTemplateNav 的 destination 对齐，避免 utils ↔ nav 循环依赖。 */
export type FormIssueDestination = 'basic' | PerfFormTemplateSubformType | 'preview' | 'history'

/** 前端换序动画用的稳定 key；后端 ValidationPipe whitelist 会剥掉。 */
export type WithClientKey = { id?: number; key?: string; clientKey?: string }

export const createClientKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`

export const formRowKey = (row: WithClientKey, fallback: string) =>
  row.clientKey ?? row.key ?? (row.id != null ? `id-${row.id}` : fallback)

/** view-transition-name 仅允许部分字符，避免 UUID 等非法 ident。 */
export const toViewTransitionName = (prefix: string, key: string) => `${prefix}-${key.replace(/[^a-zA-Z0-9_-]/g, '')}`

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
export const normalizeDimensionType = (
  dimension: PerfFormTemplateDimension,
  type: PerfFormDimensionType
): PerfFormTemplateDimension => {
  const fields = dimension.fields.map(field =>
    type === 'NON_SCORING' && field.requiredRule === 'CONDITIONAL'
      ? { ...field, requiredRule: 'OPTIONAL' as const, requiredLevels: [] }
      : field
  )

  return {
    ...dimension,
    type,
    scoringMethod: type === 'SCORING' ? (dimension.scoringMethod ?? 'RATING') : null,
    weight: type === 'SCORING' ? dimension.weight : null,
    isCore: type === 'SCORING' ? dimension.isCore : false,
    fields
  }
}

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

const SUBFORM_TYPES = new Set<PerfFormTemplateSubformType>(['SELF', 'PEER', 'MANAGER'])
const AUDIENCES = new Set<PerfFormAudience>(['EMPLOYEE', 'REVIEWER', 'LEADER'])

/** 单个维度上的校验落点：整卡高亮 + 维度属性 / 表单字段。 */
export type FormDimensionIssueMarkers = {
  hasError: boolean
  properties: Set<string>
  fields: Map<number, Set<string>>
}

/** 某个子表单导航下的校验落点。 */
export type FormSubformIssueMarkers = {
  hasError: boolean
  audiences: Set<PerfFormAudience>
  dimensions: Map<number, FormDimensionIssueMarkers>
}

/** 把发布校验 path 解析到左侧导航目标。 */
export const issueDestinationForPath = (path?: string): FormIssueDestination => {
  if (!path) return 'basic'

  const typed = /^subforms\.(SELF|PEER|MANAGER)(?:\.|$)/.exec(path)

  if (typed) return typed[1] as PerfFormTemplateSubformType

  return 'basic'
}

const ensureDimensionMarkers = (
  markers: FormSubformIssueMarkers,
  dimensionIndex: number
): FormDimensionIssueMarkers => {
  const existing = markers.dimensions.get(dimensionIndex)

  if (existing) return existing

  const created: FormDimensionIssueMarkers = {
    hasError: true,
    properties: new Set(),
    fields: new Map()
  }

  markers.dimensions.set(dimensionIndex, created)

  return created
}

/** 按子表单聚合校验问题，供导航红点与表单项描边使用。 */
export const collectFormIssueMarkers = (
  issues: FormTemplateValidationIssue[]
): Map<PerfFormTemplateSubformType, FormSubformIssueMarkers> => {
  const result = new Map<PerfFormTemplateSubformType, FormSubformIssueMarkers>()

  const ensureSubform = (type: PerfFormTemplateSubformType): FormSubformIssueMarkers => {
    const existing = result.get(type)

    if (existing) return existing

    const created: FormSubformIssueMarkers = {
      hasError: true,
      audiences: new Set(),
      dimensions: new Map()
    }

    result.set(type, created)

    return created
  }

  for (const issue of issues) {
    const path = issue.path

    if (!path) continue

    const typed = /^subforms\.(SELF|PEER|MANAGER)(?:\.(.*))?$/.exec(path)

    if (!typed) continue

    const subformType = typed[1] as PerfFormTemplateSubformType

    if (!SUBFORM_TYPES.has(subformType)) continue

    const markers = ensureSubform(subformType)
    const rest = typed[2]

    if (!rest) continue

    if (AUDIENCES.has(rest as PerfFormAudience)) {
      markers.audiences.add(rest as PerfFormAudience)
      continue
    }

    const dimensionMatch = /^dimensions(?:\[(\d+)\])?(?:\.(fields(?:\[(\d+)\])?(?:\.(.+))?|(.+)))?$/.exec(rest)

    if (!dimensionMatch) continue

    // 仅指向 dimensions 集合（如权重合计）时，整节导航标红即可
    if (dimensionMatch[1] == null) continue

    const dimensionIndex = Number(dimensionMatch[1])
    const dimMarkers = ensureDimensionMarkers(markers, dimensionIndex)
    const afterDimension = dimensionMatch[2]

    if (!afterDimension) continue

    if (afterDimension.startsWith('fields')) {
      dimMarkers.properties.add('fields')
      const fieldIndex = dimensionMatch[3] != null ? Number(dimensionMatch[3]) : null
      const fieldProperty = dimensionMatch[4]

      if (fieldIndex != null) {
        const properties = dimMarkers.fields.get(fieldIndex) ?? new Set<string>()

        properties.add(fieldProperty ?? 'root')
        dimMarkers.fields.set(fieldIndex, properties)
      }

      continue
    }

    const field = dimensionMatch[5]

    if (field) dimMarkers.properties.add(field)
  }

  return result
}
