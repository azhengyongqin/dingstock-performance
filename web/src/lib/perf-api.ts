// 绩效业务域 API 类型与常量：与后端 NestJS 接口/Prisma 枚举一一对应。
// 所有请求统一走 lib/api.ts 的 apiFetch（自动带 Bearer token）。

import { apiFetch } from './api'

// ===== 枚举（与 backend/prisma schema 对齐） =====

export type PerfCycleStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'ARCHIVED'
export type PerfEvaluationTaskType = 'SELF' | 'PEER' | 'MANAGER' | 'AI'

export type PerfParticipantStatus =
  | 'ACTIVE'
  | 'CALIBRATED'
  | 'RESULT_PUBLISHED'
  | 'CONFIRMED'
  | 'APPEALING'
  | 'RE_CONFIRMING'
  | 'NO_RESULT'
  | 'WITHDRAWN'

export type PerfCycleType = 'SEMI_ANNUAL' | 'QUARTERLY' | 'ANNUAL'
export type PerfRole = 'EMPLOYEE' | 'REVIEWER' | 'LEADER' | 'HR' | 'ADMIN'
export type PerfReviewStatus = 'DRAFT' | 'SUBMITTED'
export type PerfAppealStatus = 'PENDING' | 'IN_INTERVIEW' | 'RESOLVED'
export type PerfFormTemplateVersionStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
export type PerfJobLevelPrefix = 'D' | 'M'
export type PerfFormSubformType = 'SELF' | 'PEER' | 'MANAGER' | 'PROMOTION'
export type PerfFormDimensionKind = 'REGULAR' | 'TEXT' | 'PROMOTION'
export type PerfFormAudience = 'EMPLOYEE' | 'REVIEWER' | 'LEADER'
export type PerfFormItemType =
  | 'RATING'
  | 'SCORE'
  | 'SHORT_TEXT'
  | 'LONG_TEXT'
  | 'MARKDOWN'
  | 'SINGLE_SELECT'
  | 'MULTI_SELECT'
  | 'ATTACHMENT'
  | 'LINK'

export type PerfFormItemOption = { value: string; label: string }

export type PerfFormTemplateSubformType = Exclude<PerfFormSubformType, 'PROMOTION'>
export type PerfFormDimensionType = 'SCORING' | 'NON_SCORING'
export type PerfFormScoringMethod = 'RATING' | 'SCORE'
export type PerfFormFieldType = Exclude<PerfFormItemType, 'RATING' | 'SCORE'>
export type PerfFormFieldRequiredRule = 'OPTIONAL' | 'ALWAYS' | 'CONDITIONAL'

export type PerfFormItemConfig = {
  minLength?: number
  maxLength?: number
  defaultValue?: string
  options?: PerfFormItemOption[]
  minSelections?: number
  maxSelections?: number
  maxFiles?: number
  maxSizeMb?: number
  allowedExtensions?: string[]
  allowedProtocols?: string[]
}

// ===== 中文文案映射 =====

/**
 * 周期配置快照「可能已被手动修改」的统一提示文案片段。
 * 语义上评估规则或评估维度任一被手动改动即成立，故用「或」而非「与」；
 * cycle-setup-editor（只读块 + 重套确认弹窗）与 snapshot-provenance-card 共用同一常量，避免措辞漂移。
 */
export const CYCLE_SNAPSHOT_MANUALLY_MODIFIED_HINT = '评估规则或评估维度可能已被手动修改'

export const CYCLE_STATUS_LABEL: Record<PerfCycleStatus, string> = {
  DRAFT: '草稿',
  SCHEDULED: '待启动',
  ACTIVE: '进行中',
  ARCHIVED: '已归档'
}

export const CYCLE_STATUS_BADGE: Record<PerfCycleStatus, string> = {
  DRAFT: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  SCHEDULED: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  ACTIVE: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  ARCHIVED: 'bg-muted text-muted-foreground'
}

export const PARTICIPANT_STATUS_LABEL: Record<PerfParticipantStatus, string> = {
  ACTIVE: '评估进行中',
  CALIBRATED: '已校准',
  RESULT_PUBLISHED: '待确认结果',
  CONFIRMED: '已确认',
  APPEALING: '申诉中',
  RE_CONFIRMING: '待再次确认',
  NO_RESULT: '当前周期无绩效结果',
  WITHDRAWN: '已退出周期'
}

export const CYCLE_TYPE_LABEL: Record<PerfCycleType, string> = {
  SEMI_ANNUAL: '半年度',
  QUARTERLY: '季度',
  ANNUAL: '年度'
}

export const APPEAL_STATUS_LABEL: Record<PerfAppealStatus, string> = {
  PENDING: '待处理',
  IN_INTERVIEW: '面谈处理中',
  RESOLVED: '已处理'
}

// ===== 通用实体类型 =====

/** lark_users 精简投影（后端 join 返回） */
export type LarkUserBrief = {
  open_id: string
  name?: string
  avatar?: { avatar_72?: string; avatar_240?: string; avatar_origin?: string } | null
  job_title?: string | null
}

/** 评估填写页专用员工资料；360°响应不会包含可选的敏感字段。 */
export type PerfPeerSafeEmployeeProfile = {
  open_id: string
  name: string
  avatar?: LarkUserBrief['avatar']
  departmentPath: string | null
  jobTitle: string | null
}

export type PerfDetailedEmployeeProfile = PerfPeerSafeEmployeeProfile & {
  jobLevel: string | null
  effectiveDate: string | null
}

export type EvaluationRating = {
  symbol: string
  name: string
  minScore: number
  maxScore: number
  maxInclusive?: boolean
  remark?: string
}

export type CommentRequiredRules = { requiredRatingSymbols?: string[] }

export type PerfCycle = {
  id: number
  name: string
  type: PerfCycleType
  status: PerfCycleStatus
  plannedStartAt?: string | null
  ownerOpenId: string
  currentConfigVersionId?: number | null
  currentConfigVersion?: {
    id: number
    version: number
    sourceConfigTemplateVersionId?: number | null
  } | null
  _count?: { participants: number }
}

/** 周期看板的任务事实；openedAt 是硬开放的权威标记，提醒时间不参与可写判断。 */
export type PerfEvaluationTaskFact = {
  id: number
  participantId: number
  type: PerfEvaluationTaskType
  assigneeOpenId?: string | null
  startAt: string | null
  reminderDeadlineAt: string | null
  openedAt: string | null
  completedAt: string | null
  status: 'WAITING' | 'OPEN' | 'COMPLETED'
}

export type PerfCycleActivationIssue = {
  code: string
  message: string
  path?: string
  participantId?: number
  employeeOpenId?: string
}

export type PerfCycleProgress = {
  generatedAt: string
  cycle: Pick<PerfCycle, 'id' | 'name' | 'status' | 'plannedStartAt'>
  totals: {
    participants: number
    tasks: number
    notStarted: number
    open: number
    submitted: number
    locked: number
  }
  stages: Array<{
    stage: PerfEvaluationTaskType
    total: number
    notStarted: number
    open: number
    submitted: number
    failed: number
  }>
  tasks: PerfEvaluationTaskFact[]
  missingItems: Array<{
    code: string
    participantId?: number
    employeeOpenId?: string | null
    employeeName?: string | null
    stage?: PerfEvaluationTaskType
    message: string
    action?: string
  }>
  nextActions: Array<{ code: string; label: string; href?: string }>
  startFailure?: { occurredAt: string; issues: PerfCycleActivationIssue[] } | null
  activationIssues: PerfCycleActivationIssue[] | null
  schedules: Array<{
    stage: PerfEvaluationTaskType
    startAt: string | null
    reminderDeadlineAt: string | null
  }>
}

export const getPerfCycleProgress = (cycleId: number) => apiFetch<PerfCycleProgress>(`/cycles/${cycleId}/progress`)

export type PerfParticipantItem = {
  id: number
  cycleId: number
  employeeOpenId: string
  leaderOpenIdSnapshot: string | null
  departmentIdSnapshot: string | null
  isPromotionEnabled: boolean
  status: PerfParticipantStatus
  employee: LarkUserBrief | null
  leader: LarkUserBrief | null
  departmentName: string | null
  jobLevelCodeSnapshot?: string | null
  jobLevelPrefixSnapshot?: PerfJobLevelPrefix | null
  formSnapshotId?: number | null
  selfSubmission?: { status: PerfReviewStatus; submittedAt?: string | null } | null
  managerSubmission?: { status: PerfReviewStatus; submittedAt?: string | null } | null
  managerInitialLevel?: string | null
  resultVersion?: { finalLevel: string; confirmedByEmployee: boolean } | null
  _count?: { reviewerAssignments: number }
}

export type DimensionScore = {
  dimensionId: number
  level?: string
  score?: number
  conclusion?: string
  comment?: string
  text?: string
}

export type ReviewTaskItem = {
  taskType: 'REVIEW' | 'MANAGER_REVIEW'
  participantId: number
  assignmentId?: number
  relation?: string
  status: 'PENDING' | 'SUBMITTED'
  submittedAt?: string | null
  cycle: { id: number; name: string; status: PerfCycleStatus }
  employee: LarkUserBrief | null
}

export type CycleSetupStepTarget = 'basic' | 'participants' | 'plan' | 'advanced'

export type StartCheckItem = {
  key: string
  ok: boolean
  message: string
  target?: CycleSetupStepTarget
  actionLabel?: string
  issues?: Array<{ code: string; path: string; message: string; participantId?: number; employeeOpenId?: string }>
}

// ===== 版本化评估表单模板 =====

export type PerfFormTemplateField = {
  id?: number
  dimensionId?: number
  key?: string
  type: PerfFormFieldType
  title: string
  description?: string | null
  placeholder?: string | null
  requiredRule: PerfFormFieldRequiredRule
  requiredLevels: PerfPerformanceLevel[]
  sortOrder: number
  config?: PerfFormItemConfig | null
  clientKey?: string
}

export type PerfFormTemplateDimension = {
  id?: number
  subformId?: number
  key?: string
  type: PerfFormDimensionType
  scoringMethod?: PerfFormScoringMethod | null
  audience: PerfFormAudience
  name: string
  description?: string | null
  weight?: string | number | null
  isCore: boolean
  sortOrder: number
  fields: PerfFormTemplateField[]
  clientKey?: string
}

export type PerfFormTemplateSubform = {
  id?: number
  versionId?: number
  type: PerfFormTemplateSubformType
  title: string
  description?: string | null
  sortOrder: number
  dimensions: PerfFormTemplateDimension[]
}

export type PerfFormTemplateVersionSummary = {
  id: number
  templateId: number
  systemKey?: string | null
  name: string
  description?: string | null
  version: number
  status: PerfFormTemplateVersionStatus
  jobLevelPrefix: PerfJobLevelPrefix
  sourceVersionId?: number | null
  publishedAt?: string | null
  archivedAt?: string | null
  updatedAt: string
  subformCount?: number
}

export type PerfFormTemplateVersion = PerfFormTemplateVersionSummary & {
  createdByOpenId?: string
  updatedByOpenId?: string
  publishedByOpenId?: string | null
  archivedByOpenId?: string | null
  createdAt?: string
  subforms: PerfFormTemplateSubform[]
  legacyPromotionSubform?: {
    title: string
    description?: string | null
    dimensions: Array<{
      key: string
      name: string
      description?: string | null
      audience: 'EMPLOYEE' | 'LEADER'
      sortOrder: number
      fields: Array<{
        key: string
        title: string
        type: PerfFormItemType
        description?: string | null
        placeholder?: string | null
        required: boolean
        sortOrder: number
        config?: PerfFormItemConfig | null
      }>
    }>
  } | null
}

export type FormTemplateValidationIssue = {
  code: string
  message: string
  path?: string
}

export type FormTemplatePrefixCoverage = {
  complete: boolean
  matches: Record<PerfJobLevelPrefix, number[]>
  issues: Array<{
    code: 'PREFIX_MISSING' | 'PREFIX_DUPLICATE'
    prefix: PerfJobLevelPrefix
    versionIds: number[]
    message: string
  }>
}

export type CreatePerfFormTemplateInput = {
  name: string
  description?: string
  jobLevelPrefix: PerfJobLevelPrefix
}

export type UpdatePerfFormTemplateVersionInput = Pick<
  PerfFormTemplateVersion,
  'name' | 'description' | 'jobLevelPrefix' | 'subforms'
>

export type ListResponse<T> = { items: T[]; total: number }

/** 版本化评估表单模板 API：视图只调用这些明确操作，避免散落拼接生命周期路径。 */
export const listPerfFormTemplates = () => apiFetch<ListResponse<PerfFormTemplateVersionSummary>>('/form-templates')

export const createPerfFormTemplate = (input: CreatePerfFormTemplateInput) =>
  apiFetch<PerfFormTemplateVersion>('/form-templates', { method: 'POST', body: JSON.stringify(input) })

export const analyzePerfFormTemplatePrefixCoverage = (versionIds: number[]) =>
  apiFetch<FormTemplatePrefixCoverage>('/form-templates/prefix-coverage', {
    method: 'POST',
    body: JSON.stringify({ versionIds })
  })

export const listPerfFormTemplateVersions = (templateId: number) =>
  apiFetch<ListResponse<PerfFormTemplateVersionSummary>>(`/form-templates/${templateId}/versions`)

export const getPerfFormTemplateVersion = (versionId: number) =>
  apiFetch<PerfFormTemplateVersion>(`/form-templates/versions/${versionId}`)

export const updatePerfFormTemplateVersion = (versionId: number, input: UpdatePerfFormTemplateVersionInput) =>
  apiFetch<PerfFormTemplateVersion>(`/form-templates/versions/${versionId}`, {
    method: 'PUT',
    body: JSON.stringify(input)
  })

export const publishPerfFormTemplateVersion = (versionId: number) =>
  apiFetch<PerfFormTemplateVersion>(`/form-templates/versions/${versionId}/publish`, { method: 'POST' })

export const createPerfFormTemplateDraft = (versionId: number) =>
  apiFetch<PerfFormTemplateVersion>(`/form-templates/versions/${versionId}/new-draft`, { method: 'POST' })

export const archivePerfFormTemplateVersion = (versionId: number) =>
  apiFetch<PerfFormTemplateVersion>(`/form-templates/versions/${versionId}/archive`, { method: 'POST' })

// ===== 版本化配置模板 =====

export type PerfConfigTemplateVersionStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
export type PerfPerformanceLevel = 'S' | 'A' | 'B' | 'C'
export type PerfConfigReviewerRelation = 'ORG_OWNER' | 'PROJECT_OWNER' | 'PEER' | 'CROSS_DEPT'
export type PerfConfigScheduleStage = 'SELF' | 'PEER' | 'MANAGER'

export type PerfConfigTemplateRating = {
  symbol: PerfPerformanceLevel
  name: string
  description?: string | null
  minScore: string
  maxScore: string
  mappingScore: string
}

export type PerfConfigSchedulePreset = {
  allowStageOverlap: boolean
  stages: Array<{
    stage: PerfConfigScheduleStage
    startOffsetMinutes: number
    reminderDeadlineOffsetMinutes: number
  }>
}

export type PerfConfigNotificationRules = {
  stages: Array<{
    stage: PerfConfigScheduleStage
    taskOpened: {
      enabled: boolean
      recipient: 'ASSIGNEE'
      ccLeader: boolean
      ccHr: boolean
    }
    reminder: {
      enabled: boolean
      recipient: 'ASSIGNEE'
      ccLeader: boolean
      ccHr: boolean
      frequency: {
        type: 'ONCE_AT_DEADLINE' | 'DAILY_AFTER_DEADLINE' | 'EVERY_N_DAYS_AFTER_DEADLINE'
        intervalDays?: number
      }
    }
  }>
}

// ===== 绩效周期四步创建与独立快照 =====

export type PerfParticipantPrefixCheckStatus =
  | 'MATCHED'
  | 'MISSING_JOB_LEVEL'
  | 'UNSUPPORTED_PREFIX'
  | 'NO_FORM'
  | 'AMBIGUOUS_FORM'

export type PerfParticipantPrefixCheck = {
  participantId: number
  employeeOpenId: string
  status: PerfParticipantPrefixCheckStatus
  jobLevelCode: string | null
  jobLevelPrefix: PerfJobLevelPrefix | null
  formTemplateVersionId?: number | null
  formSnapshotId?: number | null
  formTemplateName?: string | null
  message: string
}

export type PerfParticipantPrefixCheckResponse = {
  ok: boolean
  items: PerfParticipantPrefixCheck[]
}

export type PerfCycleSetupParticipant = PerfParticipantItem & {
  jobLevelCodeSnapshot: string | null
  jobLevelPrefixSnapshot: PerfJobLevelPrefix | null
}

export type PerfCycleSchedule = {
  id?: number
  stage: PerfConfigScheduleStage
  startAt: string
  reminderDeadlineAt: string
}

export type PerfCyclePlan = {
  allowStageOverlap: boolean
  stages: PerfCycleSchedule[]
  notificationRules: PerfConfigNotificationRules
  issues?: StartCheckItem[]
}

export type PerfCycleFormSnapshotSummary = {
  id: number
  jobLevelPrefix: PerfJobLevelPrefix
  sourceFormTemplateVersionId: number
  name?: string
  version?: number
  content?: { name?: string; version?: number; [key: string]: unknown }
}

export type PerfCycleConfigSnapshot = {
  id: number
  cycleId: number
  version: number
  sourceConfigTemplateVersionId: number | null
  source?: {
    id: number
    templateId?: number
    name: string
    version: number
  } | null
  ratings: PerfConfigTemplateRating[]
  reviewerRelationWeights: Record<PerfConfigReviewerRelation, string>
  notificationRules: PerfConfigNotificationRules
  allowStageOverlap: boolean
  forms: PerfCycleFormSnapshotSummary[]

  /** 快照在创建/最近重套后是否被手动调整过（高级配置或计划调整都算），决定重新套用模板时是否需要覆盖确认。 */
  manuallyModified?: boolean
}

export type CreatePerfCycleInput = {
  name: string
  configTemplateVersionId: number
  plannedStartAt: string
}

export type UpdatePerfCycleBasicInput = {
  name: string
  plannedStartAt: string
}

export type UpdatePerfCycleAdvancedConfigInput = Pick<PerfConfigTemplateVersion, 'ratings' | 'reviewerRelationWeights'>

/** ACTIVE 周期配置输入；expectedConfigVersionId 用于拒绝并发静默覆盖。 */
export type ActivePerfCycleConfigInput = UpdatePerfCycleAdvancedConfigInput & {
  expectedConfigVersionId: number
  dimensionOverrides: ActivePerfCycleDimensionOverride[]
}

export type ActivePerfCycleDimensionOverride = {
  jobLevelPrefix: 'D' | 'M'
  dimensionKey: string
  weight: string
  isCore: boolean
}

export type ActivePerfCycleConfigImpact = {
  cycleId: number
  currentConfigVersionId: number
  currentVersion: number
  nextVersion: number
  impactRevision: string
  summary: {
    affectedParticipantCount: number
    affectedStageResultCount: number
    changedStageResultCount: number
    calibratedParticipantCount: number
    publishedParticipantCount: number
    confirmedParticipantCount: number
    automaticRecalibrationParticipantCount: 0
    affectedCalculationDimensionCount: number
    changedCalculationDimensionCount: number
  }
  stageChanges: Array<{
    participantId: number
    employeeOpenId: string
    stage: 'PEER' | 'MANAGER'
    before: ActivePerfStageImpactResult | null
    after: ActivePerfStageImpactResult
    changed: boolean
    finalResultProtected: boolean
  }>
  calculationDimensionChanges: Array<{
    participantId: number
    employeeOpenId: string
    submissionId: number
    stage: string
    status: string
    dimensionKey: string
    before: string | null
    after: string
    changed: boolean
  }>
}

type ActivePerfStageImpactResult = {
  compositeScore: string | null
  stageLevel: string | null
  dimensions: Array<{
    key: string
    name: string
    weight: string
    isCore: boolean
    score: string
    level: string
  }>
  matchedConstraints: unknown[]
}

export type ConfigTemplateValidationIssue = {
  code: string
  message: string
  path?: string
}

export type PerfConfigFormBinding = {
  id?: number
  formTemplateVersionId: number
  jobLevelPrefix: PerfJobLevelPrefix
  formTemplateVersion?: PerfFormTemplateVersion
  status?: PerfFormTemplateVersionStatus
  subforms?: PerfFormTemplateSubform[]
}

export type PerfConfigTemplateVersionSummary = {
  id: number
  templateId: number
  systemKey?: string | null
  name: string
  description?: string | null
  version: number
  status: PerfConfigTemplateVersionStatus
  sourceVersionId?: number | null
  publishedAt?: string | null
  archivedAt?: string | null
  updatedAt: string
  available?: boolean
  isUsable?: boolean
  publicationIssues?: ConfigTemplateValidationIssue[]
  publishIssues?: ConfigTemplateValidationIssue[]
  unavailableReasons?: Array<ConfigTemplateValidationIssue | string>
  formBindings?: PerfConfigFormBinding[]
}

export type PerfConfigTemplateVersion = PerfConfigTemplateVersionSummary & {
  createdByOpenId?: string
  updatedByOpenId?: string
  publishedByOpenId?: string | null
  archivedByOpenId?: string | null
  createdAt?: string
  ratings: PerfConfigTemplateRating[]
  reviewerRelationWeights: Record<PerfConfigReviewerRelation, string>
  formTemplateVersionIds: number[]
  formBindings?: PerfConfigFormBinding[]
  schedulePreset: PerfConfigSchedulePreset
  notificationRules: PerfConfigNotificationRules
}

export type CreatePerfConfigTemplateInput = {
  name: string
  description?: string
}

export type UpdatePerfConfigTemplateVersionInput = Pick<
  PerfConfigTemplateVersion,
  | 'name'
  | 'description'
  | 'ratings'
  | 'reviewerRelationWeights'
  | 'formTemplateVersionIds'
  | 'schedulePreset'
  | 'notificationRules'
>

export type PerfConfigCalculationPreviewInput = {
  stage: 'SELF' | 'PEER' | 'MANAGER' | 'AI'
  jobLevelPrefix: PerfJobLevelPrefix
  directRating?: PerfPerformanceLevel
  dimensions?: Array<{
    dimensionId: number
    relations: Array<{
      type: 'LEADER' | 'DIRECT' | PerfConfigReviewerRelation
      rawValues: string[]
    }>
  }>
}

export type PerfConfigCalculationPreviewResponse<T = Record<string, unknown>> =
  | { status: 'READY'; result: T }
  | { status: 'UNAVAILABLE'; issues: ConfigTemplateValidationIssue[] }

export const listPerfConfigTemplates = () =>
  apiFetch<ListResponse<PerfConfigTemplateVersionSummary>>('/config-templates')

export const createPerfConfigTemplate = (input: CreatePerfConfigTemplateInput) =>
  apiFetch<PerfConfigTemplateVersion>('/config-templates', { method: 'POST', body: JSON.stringify(input) })

export const listPerfConfigTemplateVersions = (templateId: number) =>
  apiFetch<ListResponse<PerfConfigTemplateVersionSummary>>(`/config-templates/${templateId}/versions`)

export const getPerfConfigTemplateVersion = (versionId: number) =>
  apiFetch<PerfConfigTemplateVersion>(`/config-templates/versions/${versionId}`)

export const updatePerfConfigTemplateVersion = (versionId: number, input: UpdatePerfConfigTemplateVersionInput) =>
  apiFetch<PerfConfigTemplateVersion>(`/config-templates/versions/${versionId}`, {
    method: 'PUT',
    body: JSON.stringify(input)
  })

export const validatePerfConfigTemplateVersion = (versionId: number) =>
  apiFetch<{ valid: boolean; issues: ConfigTemplateValidationIssue[] }>(
    `/config-templates/versions/${versionId}/validate`,
    { method: 'POST' }
  )

export const publishPerfConfigTemplateVersion = (versionId: number) =>
  apiFetch<PerfConfigTemplateVersion>(`/config-templates/versions/${versionId}/publish`, { method: 'POST' })

export const createPerfConfigTemplateDraft = (versionId: number) =>
  apiFetch<PerfConfigTemplateVersion>(`/config-templates/versions/${versionId}/new-draft`, { method: 'POST' })

export const archivePerfConfigTemplateVersion = (versionId: number) =>
  apiFetch<PerfConfigTemplateVersion>(`/config-templates/versions/${versionId}/archive`, { method: 'POST' })

export const previewPerfConfigTemplateCalculation = <T = Record<string, unknown>>(
  versionId: number,
  input: PerfConfigCalculationPreviewInput
) =>
  apiFetch<PerfConfigCalculationPreviewResponse<T>>(`/config-templates/versions/${versionId}/calculation-preview`, {
    method: 'POST',
    body: JSON.stringify(input)
  })

/** 四步创建接口集中在业务 API 层，页面不再拼接旧模板或直接启动路径。 */
export const createPerfCycle = (input: CreatePerfCycleInput) =>
  apiFetch<PerfCycle>('/cycles', { method: 'POST', body: JSON.stringify(input) })

export const updatePerfCycleBasic = (cycleId: number, input: UpdatePerfCycleBasicInput) =>
  apiFetch<PerfCycle>(`/cycles/${cycleId}`, { method: 'PATCH', body: JSON.stringify(input) })

/** 旧周期迁为 DRAFT 后，由用户选择配置并一次性补齐新版快照。 */
export const initializePerfCycleSetup = (cycleId: number, input: CreatePerfCycleInput) =>
  apiFetch<PerfCycle>(`/cycles/${cycleId}/config-snapshot/initialize`, {
    method: 'POST',
    body: JSON.stringify(input)
  })

export const getPerfCycleConfigSnapshot = (cycleId: number) =>
  apiFetch<PerfCycleConfigSnapshot>(`/cycles/${cycleId}/config-snapshot`)

export const updatePerfCycleAdvancedConfig = (cycleId: number, input: UpdatePerfCycleAdvancedConfigInput) =>
  apiFetch<PerfCycleConfigSnapshot>(`/cycles/${cycleId}/config-snapshot`, {
    method: 'PUT',
    body: JSON.stringify(input)
  })

/** ACTIVE 周期必须先预览影响；此接口只读，不创建配置版本或阶段结果。 */
export const previewActivePerfCycleConfig = (cycleId: number, input: ActivePerfCycleConfigInput) =>
  apiFetch<ActivePerfCycleConfigImpact>(`/cycles/${cycleId}/active-config/preview`, {
    method: 'POST',
    body: JSON.stringify(input)
  })

/** 使用预览时的版本令牌、原因与显式确认，原子创建新版本并统一重算。 */
export const applyActivePerfCycleConfig = (
  cycleId: number,
  input: ActivePerfCycleConfigInput & { impactRevision: string; reason: string; confirmed: true }
) =>
  apiFetch<{
    cycleId: number
    configVersionId: number
    version: number
    impact: ActivePerfCycleConfigImpact['summary']
  }>(`/cycles/${cycleId}/active-config/apply`, { method: 'POST', body: JSON.stringify(input) })

/** 启动前重新套用已发布模板版本：整套覆盖当前快照，不做字段级合并。 */
export const reapplyPerfCycleConfigSnapshot = (cycleId: number, configTemplateVersionId: number) =>
  apiFetch<PerfCycleConfigSnapshot>(`/cycles/${cycleId}/config-snapshot/reapply`, {
    method: 'POST',
    body: JSON.stringify({ configTemplateVersionId })
  })

export const getPerfCycleParticipantPrefixCheck = (cycleId: number) =>
  apiFetch<PerfParticipantPrefixCheckResponse>(`/cycles/${cycleId}/participants/prefix-check`)

export const getPerfCyclePlan = (cycleId: number) => apiFetch<PerfCyclePlan>(`/cycles/${cycleId}/plan`)

export const updatePerfCyclePlan = (cycleId: number, input: PerfCyclePlan) =>
  apiFetch<PerfCyclePlan>(`/cycles/${cycleId}/plan`, { method: 'PUT', body: JSON.stringify(input) })

export const getPerfCycleStartCheck = (cycleId: number) =>
  apiFetch<{ items: StartCheckItem[]; ok: boolean }>(`/cycles/${cycleId}/start-check`)

export const schedulePerfCycle = (cycleId: number) =>
  apiFetch<{ changed: boolean; cycle: PerfCycle }>(`/cycles/${cycleId}/schedule`, { method: 'POST' })

export const returnPerfCycleToDraft = (cycleId: number) =>
  apiFetch<{ changed: boolean; cycle: PerfCycle }>(`/cycles/${cycleId}/return-to-draft`, { method: 'POST' })

// ===== 统一评估提交（Ticket 06，员工自评） =====

/** 旧评估项形状仅供尚未迁移的结果消费者读取；三类填写链路均使用维度 + 字段。 */
export type PerfEvalFormItem = {
  key: string
  type: PerfFormItemType
  title: string
  description?: string | null
  placeholder?: string | null
  required: boolean
  sortOrder: number
  config?: PerfFormItemConfig | null
}

export type PerfEvalFormField = {
  key: string
  type: PerfFormFieldType
  title: string
  description?: string | null
  placeholder?: string | null
  requiredRule: PerfFormFieldRequiredRule
  requiredLevels?: PerfPerformanceLevel[]
  sortOrder: number
  config?: PerfFormItemConfig | null
}

export type PerfEvalFormDimension = {
  key: string
  type?: 'SCORING' | 'NON_SCORING'
  kind?: PerfFormDimensionKind
  scoringMethod?: 'RATING' | 'SCORE' | null
  audience: PerfFormAudience
  name: string
  description?: string | null
  weight?: string | number | null
  isCore?: boolean
  sortOrder: number
  fields?: PerfEvalFormField[]
  items?: PerfEvalFormItem[]
}

export type PerfEvalFormSubform = {
  key: string
  type: PerfFormSubformType
  title: string
  description?: string | null
  sortOrder: number
  dimensions: PerfEvalFormDimension[]
}

/** PUT /evaluations/self/draft、POST /evaluations/self/submit 共用的单项作答载荷 */
export type PerfEvaluationItemAnswer = {
  subformKey: string
  dimensionKey: string
  itemKey: string
  rawLevel?: PerfPerformanceLevel
  rawScore?: number
  value?: unknown
}

/** 已保存明细行（PerfEvaluationItemResult 投影）：Decimal 字段以字符串下发 */
export type PerfEvaluationItemResult = {
  id: number
  submissionId: number
  subformKey: string
  dimensionKey: string
  itemKey: string
  itemType: PerfFormItemType
  rawLevel?: PerfPerformanceLevel | null
  rawScore?: string | null
  calculationScore?: string | null
  value?: unknown
}

export type PerfEvaluationSubmissionRecord = {
  id: number
  cycleId: number
  participantId: number
  stage: PerfEvaluationTaskType
  reviewerOpenId: string
  status: PerfReviewStatus
  submittedAt?: string | null
  submittedByOpenId?: string | null
  items?: PerfEvaluationItemResult[]
  dimensionAnswers?: PerfEvaluationDimensionAnswer[]
}

export type PerfEvaluationFieldAnswer = {
  id: number
  fieldKey: string
  fieldType: PerfFormFieldType
  value: unknown
}

export type PerfEvaluationDimensionAnswer = {
  id: number
  submissionId: number
  subformKey: string
  dimensionKey: string
  scoringMethod?: 'RATING' | 'SCORE' | null
  rawLevel?: PerfPerformanceLevel | null
  rawScore?: string | null
  calculationScore?: string | null
  derivedLevel?: PerfPerformanceLevel | null
  fields: PerfEvaluationFieldAnswer[]
}

export type PerfEvaluationDimensionAnswerInput = {
  subformKey: string
  dimensionKey: string
  rawLevel?: PerfPerformanceLevel
  rawScore?: number
  fields: Array<{ fieldKey: string; value: unknown }>
}

/** 自评任务事实：只取前端网关需要的开放门槛字段，其余原样透传但不声明 */
export type PerfSelfEvaluationTask = {
  id: number
  startAt: string | null
  openedAt: string | null
  completedAt?: string | null
  reminderDeadlineAt?: string | null
} | null

export type PerfSelfEvaluationState = 'DRAFT' | 'EFFECTIVE' | 'PENDING_RESUBMIT' | null

export type PerfSelfEvaluationParticipant = {
  id: number
  cycleId: number
  employeeOpenId: string
  status: PerfParticipantStatus
  isPromotionEnabled: boolean
  formSnapshotId: number | null
  cycle: {
    id: number
    name: string
    status: PerfCycleStatus
    currentConfigVersion?: { ratings: PerfConfigTemplateRating[] } | null
  }
} | null

export type PerfSelfEvaluationContext = {
  participant: PerfSelfEvaluationParticipant
  employee: PerfDetailedEmployeeProfile | null
  task: PerfSelfEvaluationTask
  form: { formSnapshotId: number | null; subforms: PerfEvalFormSubform[] } | null
  submitted: PerfEvaluationSubmissionRecord | null
  draft: PerfEvaluationSubmissionRecord | null
  state: PerfSelfEvaluationState
}

export type SaveSelfEvaluationInput = {
  cycleId: number
  dimensions: PerfEvaluationDimensionAnswerInput[]
}

export const getSelfEvaluationContext = (cycleId?: number) =>
  apiFetch<PerfSelfEvaluationContext>(`/evaluations/self${cycleId ? `?cycleId=${cycleId}` : ''}`)

/**
 * 草稿保存返回的提交行：对应后端 saveSelfDraft 事务内 findFirst/create 的裸 Prisma 行，
 * 不 include 明细，因此不含 items（与 PerfEvaluationSubmissionRecord 的区别）。
 */
export type PerfEvaluationSubmissionDraftRecord = Omit<PerfEvaluationSubmissionRecord, 'items' | 'dimensionAnswers'>

export const saveSelfEvaluationDraft = (input: SaveSelfEvaluationInput) =>
  apiFetch<PerfEvaluationSubmissionDraftRecord>('/evaluations/self/draft', {
    method: 'PUT',
    body: JSON.stringify(input)
  })

export const submitSelfEvaluation = (input: SaveSelfEvaluationInput) =>
  apiFetch<{ ok: true }>('/evaluations/self/submit', { method: 'POST', body: JSON.stringify(input) })

// ===== 统一评估提交（Ticket 07，360°动态表单） =====

export type PerfPeerEvaluationState = PerfSelfEvaluationState

export type PerfPeerEvaluationContext = {
  assignment: { id: number; relation: PerfConfigReviewerRelation; status: 'PENDING' | 'SUBMITTED' } | null
  participant: { id: number; cycleId: number } | null
  cycle: {
    id: number
    name: string
    status: PerfCycleStatus
    currentConfigVersion?: { ratings: PerfConfigTemplateRating[] } | null
  } | null
  employee: PerfPeerSafeEmployeeProfile | null
  task: PerfSelfEvaluationTask
  form: { formSnapshotId: number | null; subforms: PerfEvalFormSubform[] } | null
  submitted: PerfEvaluationSubmissionRecord | null
  draft: PerfEvaluationSubmissionRecord | null
  state: PerfPeerEvaluationState

  /** 被评估人已生效自评，供左侧参考区只读展示 */
  selfEvaluation: PerfEvaluationSubmissionRecord | null
}

export type SavePeerEvaluationInput = {
  assignmentId: number
  dimensions: PerfEvaluationDimensionAnswerInput[]
}

export const getPeerEvaluationContext = (assignmentId: number) =>
  apiFetch<PerfPeerEvaluationContext>(`/evaluations/peer?assignmentId=${assignmentId}`)

export const savePeerEvaluationDraft = (input: SavePeerEvaluationInput) =>
  apiFetch<PerfEvaluationSubmissionDraftRecord>('/evaluations/peer/draft', {
    method: 'PUT',
    body: JSON.stringify(input)
  })

export const submitPeerEvaluation = (input: SavePeerEvaluationInput) =>
  apiFetch<{ ok: true }>('/evaluations/peer/submit', { method: 'POST', body: JSON.stringify(input) })

// ===== 统一评估提交（Ticket 09，上级动态表单与权威阶段等级） =====

export type PerfStageDimensionResultView = {
  id: string
  name: string
  weight?: string
  isCore?: boolean
  score: string
  level: PerfPerformanceLevel
}

export type PerfManagerStageResult = {
  status: 'READY' | 'NO_DATA'
  reviewerCount: number
  compositeScore: string | null
  initialLevel: PerfPerformanceLevel | null
  stageLevel: PerfPerformanceLevel | null
  constraintReasons: Array<{
    id: string
    type: string
    beforeLevel: PerfPerformanceLevel
    afterLevel: PerfPerformanceLevel
  }>
  dimensions: PerfStageDimensionResultView[]
}

export type PerfPeerReviewAnalysisField = {
  fieldKey: string
  title: string
  type: PerfFormFieldType
  value: unknown
}

export type PerfPeerReviewAnalysisDimension = {
  id: string
  name: string
  rawLevel: PerfPerformanceLevel | null
  rawScore: string | null
  mappedLevel: PerfPerformanceLevel | null
  fields: PerfPeerReviewAnalysisField[]
}

export type PerfPeerReviewAnalysis = {
  assignedReviewerCount: number
  submittedReviewerCount: number
  relationCounts: Array<{
    relation: PerfConfigReviewerRelation
    reviewerCount: number
  }>
  dimensions: Array<{
    id: string
    name: string
    score: string
    level: PerfPerformanceLevel
    distribution: Record<PerfPerformanceLevel, number>
  }>
  reviewers: Array<{
    submissionId: number
    reviewerOpenId: string
    relation: PerfConfigReviewerRelation
    reviewer: PerfPeerSafeEmployeeProfile | null
    dimensions: PerfPeerReviewAnalysisDimension[]
  }>
}

export type PerfPeerStageResult = PerfManagerStageResult & {
  analysis: PerfPeerReviewAnalysis
}

export type PerfManagerEvaluationContext = {
  participant: { id: number; cycleId: number; isPromotionEnabled: boolean }
  cycle: {
    id: number
    name: string
    status: PerfCycleStatus
    currentConfigVersion?: { ratings: PerfConfigTemplateRating[] } | null
  }
  employee: PerfDetailedEmployeeProfile | null
  task: PerfSelfEvaluationTask
  form: { formSnapshotId: number | null; subforms: PerfEvalFormSubform[] } | null
  submitted: PerfEvaluationSubmissionRecord | null
  draft: PerfEvaluationSubmissionRecord | null
  state: PerfPeerEvaluationState
  selfEvaluation: PerfEvaluationSubmissionRecord | null
  peerResult: PerfPeerStageResult | null
  managerResult: PerfManagerStageResult | null
  history: Array<{
    finalLevel: string
    promotionResult?: string | null
    participant: { cycle: { id: number; name: string } }
  }>
}

export type SaveManagerEvaluationInput = {
  participantId: number
  dimensions: PerfEvaluationDimensionAnswerInput[]
}

export const getManagerEvaluationContext = (participantId: number) =>
  apiFetch<PerfManagerEvaluationContext>(`/evaluations/manager?participantId=${participantId}`)

export const saveManagerEvaluationDraft = (input: SaveManagerEvaluationInput) =>
  apiFetch<PerfEvaluationSubmissionDraftRecord>('/evaluations/manager/draft', {
    method: 'PUT',
    body: JSON.stringify(input)
  })

export const submitManagerEvaluation = (input: SaveManagerEvaluationInput) =>
  apiFetch<{ ok: true; result: PerfManagerStageResult }>('/evaluations/manager/submit', {
    method: 'POST',
    body: JSON.stringify(input)
  })

// ===== 评估参考区：飞书 OKR 本地快照 + 单人异步刷新 =====

export type OkrSyncStatus = {
  status: 'idle' | 'running' | 'success' | 'partial_success' | 'failed'
  startedAt?: string
  finishedAt?: string
  error?: string
}

export type OkrRichText = {
  blocks?: Array<{
    block_element_type?: 'paragraph' | 'gallery'
    paragraph?: {
      elements?: Array<{
        paragraph_element_type?: 'textRun' | 'docsLink' | 'mention'
        text_run?: { text?: string }
        docs_link?: { url?: string; title?: string }
        mention?: { user_id?: string }
      }>
    }
    gallery?: { images?: Array<{ src?: string }> }
  }>
}

export type OkrIndicatorView = {
  id: string
  status: number
  startValue: number | null
  targetValue: number | null
  currentValue: number | null
  unit: unknown
} | null

export type OkrProgressView = {
  id: string
  content: OkrRichText | null
  progressPercent: number | null
  status: number | null
  createTime: string
  updateTime: string
} | null

export type OkrKeyResultView = {
  id: string
  position: number
  content: OkrRichText | null
  score: number | null
  weight: number | null
  deadline: string | null
  indicator: OkrIndicatorView
  latestProgress: OkrProgressView
}

export type OkrObjectiveView = {
  id: string
  position: number
  content: OkrRichText | null
  notes: OkrRichText | null
  score: number | null
  weight: number | null
  deadline: string | null
  category: { id: string; name: { zh?: string; en?: string; ja?: string }; color: string } | null
  indicator: OkrIndicatorView
  latestProgress: OkrProgressView
  keyResults: OkrKeyResultView[]
}

export type ParticipantOkrSnapshot = {
  participantId: number
  employeeOpenId: string
  lastSyncedAt: string | null
  sync: OkrSyncStatus
  cycles: Array<{
    id: string
    tenantCycleId: string
    startTime: string
    endTime: string
    status: number | null
    score: number | null
    objectives: OkrObjectiveView[]
  }>
}

export const getParticipantOkr = (participantId: number) =>
  apiFetch<ParticipantOkrSnapshot>(`/okr/participants/${participantId}`)

export const triggerParticipantOkrSync = (participantId: number) =>
  apiFetch<{ ok: true } & OkrSyncStatus>(`/okr/participants/${participantId}/sync`, { method: 'POST' })

// ===== 小工具 =====

/** 头像 URL 提取（LarkUser.avatar JSONB） */
export const avatarUrlOf = (user?: LarkUserBrief | null): string | undefined => {
  const avatar = user?.avatar

  if (!avatar) return undefined

  return avatar.avatar_240 ?? avatar.avatar_72 ?? avatar.avatar_origin ?? undefined
}

/** 日期显示：ISO → YYYY-MM-DD */
export const formatDate = (value?: string | Date | null): string => {
  if (!value) return '-'
  const date = typeof value === 'string' ? new Date(value) : value

  if (Number.isNaN(date.getTime())) return '-'

  return date.toISOString().slice(0, 10)
}

/** 日期时间显示（本地时区） */
export const formatDateTime = (value?: string | Date | null): string => {
  if (!value) return '-'
  const date = typeof value === 'string' ? new Date(value) : value

  if (Number.isNaN(date.getTime())) return '-'

  return date.toLocaleString('zh-CN', { hour12: false })
}
