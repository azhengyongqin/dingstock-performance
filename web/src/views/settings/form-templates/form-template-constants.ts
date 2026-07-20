import type {
  PerfFormFieldType,
  PerfFormItemConfig,
  PerfFormTemplateSubformType,
  PerfFormTemplateVersionStatus,
  PerfJobLevelPrefix
} from '@/lib/perf-api'

export const FORM_TEMPLATE_STATUS_LABEL: Record<PerfFormTemplateVersionStatus, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  ARCHIVED: '已归档'
}

export const FORM_TEMPLATE_STATUS_OPTIONS = Object.values(FORM_TEMPLATE_STATUS_LABEL)

export const JOB_LEVEL_PREFIX_LABEL: Record<PerfJobLevelPrefix, string> = {
  D: 'D 普通岗',
  M: 'M 管理岗'
}

export const JOB_LEVEL_PREFIX_OPTIONS = Object.values(JOB_LEVEL_PREFIX_LABEL)

export const FORM_SUBFORM_LABEL: Record<PerfFormTemplateSubformType, string> = {
  SELF: '员工自评',
  PEER: '360°评估',
  MANAGER: '上级评估'
}

export const FORM_FIELD_TYPES: { value: PerfFormFieldType; label: string }[] = [
  { value: 'SHORT_TEXT', label: '单行文本' },
  { value: 'LONG_TEXT', label: '多行文本' },
  { value: 'MARKDOWN', label: 'Markdown' },
  { value: 'SINGLE_SELECT', label: '单选' },
  { value: 'MULTI_SELECT', label: '多选' },
  { value: 'ATTACHMENT', label: '文件附件' },
  { value: 'LINK', label: '链接' }
]

export const FORM_FIELD_TYPE_LABEL = Object.fromEntries(
  FORM_FIELD_TYPES.map(item => [item.value, item.label])
) as Record<PerfFormFieldType, string>

/** 切换表单字段类型时清理旧配置，并提供满足受控 Schema 的最小初始值。 */
export const createDefaultFieldConfig = (type: PerfFormFieldType): PerfFormItemConfig | null => {
  if (type === 'SINGLE_SELECT') return { options: [{ value: 'OPTION_1', label: '选项 1' }] }

  if (type === 'MULTI_SELECT') {
    return { options: [{ value: 'OPTION_1', label: '选项 1' }], minSelections: 0, maxSelections: 1 }
  }

  if (type === 'SHORT_TEXT' || type === 'LONG_TEXT' || type === 'MARKDOWN' || type === 'ATTACHMENT') return {}
  if (type === 'LINK') return { allowedProtocols: ['http', 'https'] }

  return null
}
