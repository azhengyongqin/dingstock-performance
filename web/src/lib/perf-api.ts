// 绩效业务域 API 类型与常量：与后端 NestJS 接口/Prisma 枚举一一对应。
// 所有请求统一走 lib/api.ts 的 apiFetch（自动带 Bearer token）。

import { apiFetch } from './api'

// ===== 枚举（与 backend/prisma schema 对齐） =====

export type PerfCycleStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'ARCHIVED'
export type PerfEvaluationTaskType = 'SELF' | 'PEER' | 'MANAGER' | 'AI'

export type PerfParticipantStatus =
  | 'PENDING_SELF_REVIEW'
  | 'SELF_SUBMITTED'
  | 'RETURNED'
  | 'REVIEWED'
  | 'AI_DONE'
  | 'CALIBRATED'
  | 'RESULT_PUSHED'
  | 'CONFIRMED'
  | 'APPEALING'
  | 'RE_CONFIRMING'
  | 'ARCHIVED'

export type PerfCycleType = 'SEMI_ANNUAL' | 'QUARTERLY' | 'ANNUAL'
export type PerfDimensionType = 'REGULAR' | 'PROMOTION' | 'TEXT' | 'METRIC'
export type PerfScoringMethod = 'LEVEL' | 'SCORE' | 'CONCLUSION' | 'TEXT'
export type PerfRole = 'EMPLOYEE' | 'REVIEWER' | 'LEADER' | 'HR' | 'ADMIN'
export type PerfReviewStatus = 'DRAFT' | 'SUBMITTED'
export type PerfSelfReviewStatus = 'DRAFT' | 'SUBMITTED' | 'RETURNED'
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
  PENDING_SELF_REVIEW: '待自评',
  SELF_SUBMITTED: '自评已提交',
  RETURNED: '自评被退回',
  REVIEWED: '评审完成',
  AI_DONE: 'AI 分析完成',
  CALIBRATED: '已校准',
  RESULT_PUSHED: '待确认结果',
  CONFIRMED: '已确认',
  APPEALING: '申诉中',
  RE_CONFIRMING: '待再次确认',
  ARCHIVED: '已归档'
}

export const CYCLE_TYPE_LABEL: Record<PerfCycleType, string> = {
  SEMI_ANNUAL: '半年度',
  QUARTERLY: '季度',
  ANNUAL: '年度'
}

export const DIMENSION_TYPE_LABEL: Record<PerfDimensionType, string> = {
  REGULAR: '常规评估',
  PROMOTION: '晋升评估',
  TEXT: '文本反馈',
  METRIC: '系统指标'
}

export const SCORING_METHOD_LABEL: Record<PerfScoringMethod, string> = {
  LEVEL: '等级',
  SCORE: '分值',
  CONCLUSION: '结论型',
  TEXT: '文本'
}

export const APPEAL_STATUS_LABEL: Record<PerfAppealStatus, string> = {
  PENDING: '待处理',
  IN_INTERVIEW: '面谈处理中',
  RESOLVED: '已处理'
}

export const SELF_REVIEW_STATUS_LABEL: Record<PerfSelfReviewStatus, string> = {
  DRAFT: '草稿',
  SUBMITTED: '已提交',
  RETURNED: '已退回'
}

// ===== 通用实体类型 =====

/** lark_users 精简投影（后端 join 返回） */
export type LarkUserBrief = {
  open_id: string
  name?: string
  avatar?: { avatar_72?: string; avatar_240?: string; avatar_origin?: string } | null
  job_title?: string | null
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

export type PerfDimension = {
  id: number
  cycleId: number
  name: string
  type: PerfDimensionType
  scoringMethod: PerfScoringMethod
  weight: string | number | null
  required: boolean
  sortOrder: number
  visibleRoles: PerfRole[]
  editableRoles: PerfRole[]
  formSchema?: Record<string, unknown> | null
  applicableScope?: Record<string, unknown> | null
  conclusionOptions?: string[] | null
  employeeVisible?: boolean | null
}

export type PerfEvaluationRule = {
  id: number
  cycleId: number
  levels: EvaluationRating[]
  commentRequiredRules?: CommentRequiredRules | null
}

export type PerfCycle = {
  id: number
  name: string
  type: PerfCycleType
  status: PerfCycleStatus
  plannedStartAt?: string | null
  ownerOpenId: string
  templateId?: number | null
  template?: { id: number; name: string } | null
  currentConfigVersionId?: number | null
  currentConfigVersion?: {
    id: number
    version: number
    sourceConfigTemplateVersionId?: number | null
  } | null
  windows?: Record<string, { startAt?: string; endAt?: string }> | null
  notificationRules?: Record<string, unknown> | null
  evaluationRule?: PerfEvaluationRule | null
  dimensions?: PerfDimension[]
  _count?: { participants: number; dimensions?: number }
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

export const getPerfCycleProgress = (cycleId: number) =>
  apiFetch<PerfCycleProgress>(`/cycles/${cycleId}/progress`)

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
  selfReview?: { status: PerfSelfReviewStatus; submittedAt?: string | null } | null
  managerReview?: { status: PerfReviewStatus; initialLevel?: string | null } | null
  result?: { finalLevel: string; confirmedByEmployee: boolean } | null
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

export type PerfTemplate = {
  id: number
  name: string
  description?: string | null
  isDefault: boolean
  canCreateCycle?: boolean
  unavailableReasons?: string[]
  levels: EvaluationRating[]
  commentRequiredRules?: CommentRequiredRules | null
  dimensions?: PerfDimensionTemplateItem[]
  _count?: { dimensions: number; cycles: number }
}

export type PerfDimensionTemplateItem = Omit<PerfDimension, 'cycleId'> & { templateId: number }

// ===== 版本化评估表单模板 =====

export type PerfFormTemplateItem = {
  id?: number
  dimensionId?: number
  type: PerfFormItemType
  title: string
  description?: string | null
  placeholder?: string | null
  required: boolean
  sortOrder: number
  config?: PerfFormItemConfig | null
}

export type PerfFormTemplateDimension = {
  id?: number
  subformId?: number
  kind: PerfFormDimensionKind
  audience: PerfFormAudience
  name: string
  description?: string | null
  weight?: string | number | null
  isCore: boolean
  sortOrder: number
  items: PerfFormTemplateItem[]
}

export type PerfFormTemplateSubform = {
  id?: number
  versionId?: number
  type: PerfFormSubformType
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
export type PerfConfigStageMode = 'DIRECT_RATING' | 'WEIGHTED_RATING' | 'WEIGHTED_SCORE'
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
  commentRequired: boolean
}

export type PerfConfigRatingConstraint = {
  id: string
  type: 'CORE_RATING_FORCE' | 'CORE_RATING_CAP' | 'ANY_RATING_CAP'
  enabled: boolean
  triggerRating: PerfPerformanceLevel
  targetLevel: PerfPerformanceLevel
}

export type PerfConfigScoreConstraint = {
  id: string
  type: 'CORE_SCORE_FORCE' | 'CORE_SCORE_CAP' | 'ANY_SCORE_CAP'
  enabled: boolean
  threshold: string
  targetLevel: PerfPerformanceLevel
}

export type PerfConfigConstraintProfiles = {
  WEIGHTED_RATING: PerfConfigRatingConstraint[]
  WEIGHTED_SCORE: PerfConfigScoreConstraint[]
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
  stageModes: PerfConfigTemplateVersion['stageModes']
  ratings: PerfConfigTemplateRating[]
  constraintProfiles: PerfConfigConstraintProfiles
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

export type UpdatePerfCycleAdvancedConfigInput = Pick<
  PerfConfigTemplateVersion,
  'stageModes' | 'ratings' | 'constraintProfiles' | 'reviewerRelationWeights'
>

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
  stageModes: {
    SELF: 'DIRECT_RATING'
    PEER: 'WEIGHTED_RATING' | 'WEIGHTED_SCORE'
    MANAGER: 'WEIGHTED_RATING' | 'WEIGHTED_SCORE'
    AI: 'DIRECT_RATING'
  }
  ratings: PerfConfigTemplateRating[]
  constraintProfiles: PerfConfigConstraintProfiles
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
  | 'stageModes'
  | 'ratings'
  | 'constraintProfiles'
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
      type: 'LEADER' | PerfConfigReviewerRelation
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
