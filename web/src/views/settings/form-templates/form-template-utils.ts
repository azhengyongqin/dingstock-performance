import type {
  PerfFormDimensionKind,
  PerfFormTemplateDimension,
  PerfFormTemplateVersionStatus
} from '@/lib/perf-api'

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
