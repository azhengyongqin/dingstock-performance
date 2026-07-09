import type { PerfTemplate } from '@/lib/perf-api'

export type TemplateOption = {
  value: string
  label: string
  disabled: boolean
  reason: string
}

export const toTemplateOptions = (templates: PerfTemplate[]): TemplateOption[] =>
  templates.map(template => ({
    value: String(template.id),
    label: `${template.name}${template.isDefault ? '（默认）' : ''}`,
    disabled: template.canCreateCycle === false,
    reason: template.unavailableReasons?.join('；') ?? ''
  }))

export const findDefaultUsableTemplateId = (templates: PerfTemplate[]): string =>
  String(templates.find(template => template.isDefault && template.canCreateCycle !== false)?.id ?? '')

export const shouldConfirmTemplateOverwrite = (configDirty: boolean): boolean => configDirty
