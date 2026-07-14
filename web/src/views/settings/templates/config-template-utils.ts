import type {
  PerfConfigFormBinding,
  PerfConfigReviewerRelation,
  PerfConfigTemplateVersionSummary,
  PerfConfigTemplateVersionStatus,
  PerfFormTemplateVersionSummary,
  PerfJobLevelPrefix
} from '@/lib/perf-api'

export type ConfigTemplateSection =
  | 'basic'
  | 'ratings'
  | 'constraints'
  | 'relations'
  | 'bindings'
  | 'schedule'
  | 'preview'
  | 'history'

export const getConfigTemplateActions = (status: PerfConfigTemplateVersionStatus, isAdmin: boolean) => {
  const canEdit = isAdmin && status === 'DRAFT'

  return {
    canEdit,
    canValidate: canEdit,
    canPublish: canEdit,
    canCreateDraft: isAdmin && status === 'PUBLISHED',
    canArchive: isAdmin && status === 'PUBLISHED'
  }
}

const toHundredths = (value: string): number | null => {
  const normalized = value.trim()

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  const [integer, fraction = ''] = normalized.split('.')

  return Number(integer) * 100 + Number(fraction.padEnd(2, '0'))
}

/** 权重用百分之一为最小单位累加，避免 33.33 等小数被浮点误差误判。 */
export const summarizeReviewerRelationWeights = (
  weights: Record<PerfConfigReviewerRelation, string>
): { total: string; difference: string; valid: boolean } => {
  const values = Object.values(weights).map(toHundredths)

  if (values.some(value => value == null)) return { total: '--', difference: '--', valid: false }
  const exactValues = values as number[]
  const total = exactValues.reduce((sum, value) => sum + value, 0)
  const difference = 10000 - total
  const display = (value: number) => (value / 100).toFixed(2)

  return {
    total: display(total),
    difference: display(difference),
    valid: difference === 0 && exactValues.every(value => value > 0 && value <= 10000)
  }
}

export const filterPublishedFormCandidates = (
  candidates: PerfFormTemplateVersionSummary[],
  prefix: PerfJobLevelPrefix
) => candidates.filter(candidate => candidate.status === 'PUBLISHED' && candidate.jobLevelPrefix === prefix)

/**
 * 替换单一职级前缀的绑定：详情中的历史绑定是权威清理来源，候选列表用于补齐尚未展开的同前缀版本。
 * 即使旧绑定在编辑期间被归档、不再出现在已发布候选中，也不会残留到提交载荷。
 */
export const replaceFormBindingForPrefix = ({
  currentIds,
  bindings,
  candidates,
  prefix,
  nextId
}: {
  currentIds: number[]
  bindings: PerfConfigFormBinding[]
  candidates: PerfFormTemplateVersionSummary[]
  prefix: PerfJobLevelPrefix
  nextId?: number
}) => {
  const idsToRemove = new Set([
    ...bindings.filter(binding => binding.jobLevelPrefix === prefix).map(binding => binding.formTemplateVersionId),
    ...candidates.filter(candidate => candidate.jobLevelPrefix === prefix).map(candidate => candidate.id)
  ])

  const retained = currentIds.filter(id => !idsToRemove.has(id))

  return nextId ? [...retained, nextId] : retained
}

/** 归一化 subforms 用于发布校验展示；计算预览必须优先读取保留数据库 ID 的展开版本。 */
export const resolveBindingSubforms = (binding?: Pick<PerfConfigFormBinding, 'formTemplateVersion' | 'subforms'>) =>
  binding?.formTemplateVersion?.subforms ?? binding?.subforms

type ReminderFrequencyType =
  | 'ONCE_AT_DEADLINE'
  | 'DAILY_AFTER_DEADLINE'
  | 'EVERY_N_DAYS_AFTER_DEADLINE'

/** 非每 N 天模式不允许携带 intervalDays，切换时必须重新构造受控联合类型。 */
export const buildReminderFrequency = (type: ReminderFrequencyType, intervalDays?: number) =>
  type === 'EVERY_N_DAYS_AFTER_DEADLINE'
    ? { type, intervalDays: intervalDays && intervalDays > 0 ? intervalDays : 1 }
    : { type }

/** 合并发布与生命周期问题；空发布问题数组不能遮蔽归档等不可用原因。 */
export const mergeConfigTemplateIssues = (
  value: Pick<
    PerfConfigTemplateVersionSummary,
    'publicationIssues' | 'publishIssues' | 'unavailableReasons'
  >
) => {
  const issues = [
    ...(value.publicationIssues ?? []),
    ...(value.publishIssues ?? []),
    ...(value.unavailableReasons ?? []).map(issue =>
      typeof issue === 'string' ? { code: 'UNAVAILABLE', message: issue } : issue
    )
  ]

  const unique = new Map(issues.map(issue => [`${issue.code}|${issue.path ?? ''}|${issue.message}`, issue]))

  return [...unique.values()]
}

/** 后端问题路径映射到编辑器 Tab，点击问题即可跳到可修正的位置。 */
export const issueSectionForPath = (path?: string): ConfigTemplateSection => {
  if (!path) return 'basic'
  if (path.startsWith('ratings') || path.startsWith('stageModes')) return 'ratings'
  if (path.startsWith('constraintProfiles')) return 'constraints'
  if (path.startsWith('reviewerRelationWeights')) return 'relations'
  if (path.startsWith('formTemplateVersionIds') || path.startsWith('formBindings')) return 'bindings'
  if (path.startsWith('schedulePreset') || path.startsWith('notificationRules')) return 'schedule'

  return 'basic'
}
