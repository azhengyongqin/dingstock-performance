import type {
  PerfConfigConstraintProfiles,
  PerfConfigReviewerRelation,
  PerfConfigScheduleStage,
  PerfConfigTemplateVersion,
  PerfFormTemplateVersionSummary,
  PerfJobLevelPrefix,
  PerfPerformanceLevel
} from '@/lib/perf-api'

import {
  buildReminderFrequency,
  filterPublishedFormCandidates,
  replaceFormBindingForPrefix,
  summarizeReviewerRelationWeights
} from '../config-template-utils'

export const MODE_OPTIONS = [
  { value: 'WEIGHTED_RATING', label: '加权评级' },
  { value: 'WEIGHTED_SCORE', label: '加权评分' }
] as const

export const LEVEL_OPTIONS: Array<{ value: PerfPerformanceLevel; label: PerfPerformanceLevel }> = [
  'S',
  'A',
  'B',
  'C'
].map(value => ({ value: value as PerfPerformanceLevel, label: value as PerfPerformanceLevel }))

export const RELATIONS: Array<{ value: PerfConfigReviewerRelation; label: string }> = [
  { value: 'ORG_OWNER', label: '组织负责人' },
  { value: 'PROJECT_OWNER', label: '项目负责人' },
  { value: 'PEER', label: '同部门同事' },
  { value: 'CROSS_DEPT', label: '跨部门协作方' }
]

export const SCHEDULE_STAGES: Array<{ value: PerfConfigScheduleStage; label: string }> = [
  { value: 'SELF', label: '员工自评' },
  { value: 'PEER', label: '360°评估' },
  { value: 'MANAGER', label: '上级评估' }
]

export const RATING_CONSTRAINT_LABEL: Record<string, string> = {
  CORE_RATING_FORCE: '核心维度命中等级时强制定级',
  CORE_RATING_CAP: '核心维度命中等级时封顶',
  ANY_RATING_CAP: '任一维度命中等级时封顶'
}

export const SCORE_CONSTRAINT_LABEL: Record<string, string> = {
  CORE_SCORE_FORCE: '核心维度低于阈值时强制定级',
  CORE_SCORE_CAP: '核心维度低于阈值时封顶',
  ANY_SCORE_CAP: '任一维度低于阈值时封顶'
}

export const STAGE_MODE_ROWS = [
  { key: 'SELF' as const, label: '员工自评（固定）', fixed: true },
  { key: 'AI' as const, label: 'AI 评估（固定）', fixed: true },
  { key: 'PEER' as const, label: '360°阶段', fixed: false },
  { key: 'MANAGER' as const, label: '上级评估阶段', fixed: false }
]

export type RuleSectionProps = {
  value: PerfConfigTemplateVersion
  candidates: PerfFormTemplateVersionSummary[]
  editable: boolean
  onChange: (value: PerfConfigTemplateVersion) => void
}

export const createSectionHelpers = ({ value, candidates, editable, onChange }: RuleSectionProps) => {
  const patch = (next: Partial<PerfConfigTemplateVersion>) => onChange({ ...value, ...next })

  const patchConstraint = <K extends keyof PerfConfigConstraintProfiles>(
    profile: K,
    index: number,
    next: Partial<PerfConfigConstraintProfiles[K][number]>
  ) =>
    patch({
      constraintProfiles: {
        ...value.constraintProfiles,
        [profile]: value.constraintProfiles[profile].map((constraint, itemIndex) =>
          itemIndex === index ? { ...constraint, ...next } : constraint
        )
      } as PerfConfigConstraintProfiles
    })

  const selectedBinding = (prefix: PerfJobLevelPrefix) => {
    const expanded = value.formBindings?.find(binding => binding.jobLevelPrefix === prefix)
      ?.formTemplateVersionId

    const selectedFromIds = value.formTemplateVersionIds.find(
      id => candidates.find(item => item.id === id)?.jobLevelPrefix === prefix
    )

    if (selectedFromIds) return selectedFromIds
    if (editable) return expanded && value.formTemplateVersionIds.includes(expanded) ? expanded : undefined
    if (expanded) return expanded

    return undefined
  }

  const setBinding = (prefix: PerfJobLevelPrefix, versionId?: number) => {
    patch({
      formTemplateVersionIds: replaceFormBindingForPrefix({
        currentIds: value.formTemplateVersionIds,
        bindings: value.formBindings ?? [],
        candidates,
        prefix,
        nextId: versionId
      })
    })
  }

  const relationSummary = summarizeReviewerRelationWeights(value.reviewerRelationWeights)

  const scheduleFor = (stage: PerfConfigScheduleStage) =>
    value.schedulePreset.stages.find(item => item.stage === stage) ?? {
      stage,
      startOffsetMinutes: 0,
      reminderDeadlineOffsetMinutes: 0
    }

  const patchSchedule = (
    stage: PerfConfigScheduleStage,
    next: Partial<ReturnType<typeof scheduleFor>>
  ) =>
    patch({
      schedulePreset: {
        ...value.schedulePreset,
        stages: SCHEDULE_STAGES.map(item => {
          const current = scheduleFor(item.value)

          return item.value === stage ? { ...current, ...next } : current
        })
      }
    })

  const notificationFor = (stage: PerfConfigScheduleStage) =>
    value.notificationRules.stages.find(item => item.stage === stage) ?? {
      stage,
      taskOpened: { enabled: true, recipient: 'ASSIGNEE' as const, ccLeader: false, ccHr: false },
      reminder: {
        enabled: true,
        recipient: 'ASSIGNEE' as const,
        ccLeader: false,
        ccHr: false,
        frequency: { type: 'ONCE_AT_DEADLINE' as const }
      }
    }

  const patchNotification = (
    stage: PerfConfigScheduleStage,
    next: Partial<ReturnType<typeof notificationFor>>
  ) =>
    patch({
      notificationRules: {
        stages: SCHEDULE_STAGES.map(item => {
          const current = notificationFor(item.value)

          return item.value === stage ? { ...current, ...next } : current
        })
      }
    })

  const bindingOptions = (prefix: PerfJobLevelPrefix) => {
    const currentBinding = value.formBindings?.find(binding => binding.jobLevelPrefix === prefix)
    const publishedOptions = filterPublishedFormCandidates(candidates, prefix)
    const expandedCurrent = currentBinding?.formTemplateVersion

    const options =
      expandedCurrent && !publishedOptions.some(option => option.id === expandedCurrent.id)
        ? [...publishedOptions, expandedCurrent]
        : publishedOptions

    const selected = selectedBinding(prefix)
    const selectableValue =
      selected && options.some(option => option.id === selected) ? String(selected) : undefined

    return { currentBinding, expandedCurrent, options, selected, selectableValue }
  }

  return {
    patch,
    patchConstraint,
    setBinding,
    relationSummary,
    scheduleFor,
    patchSchedule,
    notificationFor,
    patchNotification,
    bindingOptions,
    buildReminderFrequency
  }
}
