import type { PerfConfigTemplateVersionSummary, PerfJobLevelPrefix } from '@/lib/perf-api'

export const CYCLE_SETUP_STEPS = [
  { key: 'basic', title: '基本信息', description: '周期名称、配置模板版本与计划启动时间' },
  { key: 'participants', title: '参与者', description: '圈定参与者并检查职级前缀' },
  { key: 'plan', title: '计划预览', description: '调整任务开始时间、提醒时间与通知' },
  { key: 'checks', title: '启动检查', description: '处理阻塞问题并保存草稿或设为待启动' }
] as const

export type CycleSetupStepKey = (typeof CYCLE_SETUP_STEPS)[number]['key']

export type ConfigTemplateOption = {
  value: string
  label: string
  disabled: boolean
  reason: string
}

/** 将后端结构化不可用原因统一为选择器可直接展示的中文文案。 */
const unavailableMessage = (reason: string | { message: string }) =>
  typeof reason === 'string' ? reason : reason.message

export const toConfigTemplateOptions = (
  versions: PerfConfigTemplateVersionSummary[]
): ConfigTemplateOption[] =>
  versions.map(version => {
    const reasons = (version.unavailableReasons ?? []).map(unavailableMessage).filter(Boolean)
    const usable = version.status === 'PUBLISHED' && version.isUsable !== false && reasons.length === 0

    return {
      value: String(version.id),
      label: `${version.name} · v${version.version}`,
      disabled: !usable,
      reason: usable ? '' : reasons.join('；') || '该配置模板版本当前不可用于创建周期'
    }
  })

export type ParticipantPrefixCheckLike = {
  participantId: number
  status: string
  jobLevelPrefix: PerfJobLevelPrefix | null
  message: string
}

export const summarizePrefixChecks = (items: ParticipantPrefixCheckLike[]) => ({
  total: items.length,
  matchedD: items.filter(item => item.status === 'MATCHED' && item.jobLevelPrefix === 'D').length,
  matchedM: items.filter(item => item.status === 'MATCHED' && item.jobLevelPrefix === 'M').length,
  errors: items.filter(item => item.status !== 'MATCHED').length
})

/** DateTimePicker 使用本地时间字符串，不能直接截取 UTC ISO。 */
export const toDateTimeInputValue = (value?: string | Date | null): string => {
  if (!value) return ''
  const date = typeof value === 'string' ? new Date(value) : value

  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export const toIsoDateTimeValue = (value: string): string => new Date(value).toISOString()
