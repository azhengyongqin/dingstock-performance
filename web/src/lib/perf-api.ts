// 绩效业务域 API 类型与常量：与后端 NestJS 接口/Prisma 枚举一一对应。
// 所有请求统一走 lib/api.ts 的 apiFetch（自动带 Bearer token）。

// ===== 枚举（与 backend/prisma schema 对齐） =====

export type PerfCycleStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'SELF_REVIEW'
  | 'REVIEWING'
  | 'AI_ANALYZING'
  | 'CALIBRATING'
  | 'CONFIRMING'
  | 'ARCHIVED'

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

// ===== 中文文案映射 =====

export const CYCLE_STATUS_LABEL: Record<PerfCycleStatus, string> = {
  DRAFT: '草稿',
  PENDING: '待启动',
  SELF_REVIEW: '自评中',
  REVIEWING: '评审中',
  AI_ANALYZING: 'AI 分析中',
  CALIBRATING: '校准中',
  CONFIRMING: '结果确认中',
  ARCHIVED: '已归档'
}

export const CYCLE_STATUS_BADGE: Record<PerfCycleStatus, string> = {
  DRAFT: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  PENDING: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  SELF_REVIEW: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  REVIEWING: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  AI_ANALYZING: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  CALIBRATING: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  CONFIRMING: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
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

export type ScoringLevel = { level: string; scoreRange?: [number, number]; description?: string }

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

export type PerfScoringRule = {
  id: number
  cycleId: number
  levels: ScoringLevel[]
  distribution?: { level: string; minRatio?: number; maxRatio?: number; enforced?: boolean }[] | null
  commentRequiredRules?: Record<string, unknown> | null
}

export type PerfCycle = {
  id: number
  name: string
  type: PerfCycleType
  status: PerfCycleStatus
  startDate: string
  endDate: string
  ownerOpenId: string
  templateId?: number | null
  template?: { id: number; name: string } | null
  windows?: Record<string, { startAt?: string; endAt?: string }> | null
  notificationRules?: Record<string, unknown> | null
  scoringRule?: PerfScoringRule | null
  dimensions?: PerfDimension[]
  _count?: { participants: number; dimensions?: number }
}

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

export type StartCheckItem = { key: string; ok: boolean; message: string }

export type PerfTemplate = {
  id: number
  name: string
  description?: string | null
  isDefault: boolean
  canCreateCycle?: boolean
  unavailableReasons?: string[]
  levels: ScoringLevel[]
  distribution?: Record<string, unknown>[] | null
  dimensions?: PerfDimensionTemplateItem[]
  _count?: { dimensions: number; cycles: number }
}

export type PerfDimensionTemplateItem = Omit<PerfDimension, 'cycleId'> & { templateId: number }

export type ListResponse<T> = { items: T[]; total: number }

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
