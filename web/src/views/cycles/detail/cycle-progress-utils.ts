import type {
  CycleSetupStepTarget,
  PerfCycleActivationIssue,
  PerfCycleProgress,
  PerfCycleStatus,
  PerfEvaluationTaskFact,
  PerfEvaluationTaskType
} from '@/lib/perf-api'

const STAGES: PerfEvaluationTaskType[] = ['SELF', 'PEER', 'MANAGER', 'AI']

export const TASK_STAGE_LABEL: Record<PerfEvaluationTaskType, string> = {
  SELF: '员工自评',
  PEER: '360°评估',
  MANAGER: '上级评估',
  AI: 'AI 参考'
}

export type CycleTaskDisplayState = 'WAITING' | 'OPEN' | 'COMPLETED'

export type CycleProgressMissingItem = {
  code: string
  message: string
  taskId?: number
  participantId?: number
  stage?: PerfEvaluationTaskType
  target?: CycleSetupStepTarget
}

export type CycleProgressView = {
  headline: string
  description: string
  summary: { total: number; waiting: number; open: number; completed: number }
  stages: Array<{
    stage: PerfEvaluationTaskType
    label: string
    total: number
    waiting: number
    open: number
    completed: number
    percent: number
  }>
  missingItems: CycleProgressMissingItem[]
  nextAction: { label: string; target?: CycleSetupStepTarget }
}

export function taskDisplayState(task: PerfEvaluationTaskFact): CycleTaskDisplayState {
  if (task.completedAt) return 'COMPLETED'
  if (task.openedAt) return 'OPEN'

  return 'WAITING'
}

function lifecycleCopy(status: PerfCycleStatus) {
  const copy: Record<PerfCycleStatus, Pick<CycleProgressView, 'headline' | 'description' | 'nextAction'>> = {
    DRAFT: {
      headline: '完善周期配置',
      description: '草稿尚未生成评估任务，请先完成参与者、计划和启动检查。',
      nextAction: { label: '编辑周期', target: 'basic' }
    },
    SCHEDULED: {
      headline: '等待自动启动',
      description: '周期已排期，系统会在计划启动时间复核配置并原子生成任务。',
      nextAction: { label: '查看启动检查', target: 'advanced' }
    },
    ACTIVE: {
      headline: '任务并行进行中',
      description: '各参与者按任务事实独立推进，不使用周期状态伪造统一业务阶段。',
      nextAction: { label: '查看待处理任务', target: 'participants' }
    },
    ARCHIVED: {
      headline: '周期已归档',
      description: '周期已经进入永久只读终态，任务与结果仅供历史查看。',
      nextAction: { label: '查看历史结果' }
    }
  }

  return copy[status]
}

function participantName(progress: PerfCycleProgress, participantId: number) {
  const missing = progress.missingItems.find(item => item.participantId === participantId)

  return missing?.employeeName || missing?.employeeOpenId || `参与者 #${participantId}`
}

function activationIssueTarget(issue: PerfCycleActivationIssue): CycleSetupStepTarget {
  const path = issue.path?.toLowerCase() ?? ''

  if (path.startsWith('participants')) return 'participants'
  if (path.startsWith('plan') || path.includes('schedule') || path.includes('window')) return 'plan'
  if (path === 'name' || path.includes('plannedstartat')) return 'basic'

  return 'advanced'
}

function activationMissingItems(issues: PerfCycleActivationIssue[]): CycleProgressMissingItem[] {
  return issues.map(issue => ({
    code: issue.code,
    message: issue.message,
    participantId: issue.participantId,
    target: activationIssueTarget(issue)
  }))
}

function taskMissingItem(
  progress: PerfCycleProgress,
  task: PerfEvaluationTaskFact,
  now: number
): CycleProgressMissingItem | null {
  if (task.completedAt || task.type === 'AI') return null
  const name = participantName(progress, task.participantId)
  const stage = TASK_STAGE_LABEL[task.type]

  if (!task.openedAt) {
    return {
      code: 'WAITING_TO_OPEN',
      taskId: task.id,
      participantId: task.participantId,
      stage: task.type,
      target: 'plan',
      message: `${name}的${stage}尚未开放；开始时间前不可填写或提交。`
    }
  }

  const reminderDue = task.reminderDeadlineAt != null && Date.parse(task.reminderDeadlineAt) <= now

  return {
    code: reminderDue ? 'SUBMISSION_REMINDER_DUE' : 'SUBMISSION_PENDING',
    taskId: task.id,
    participantId: task.participantId,
    stage: task.type,
    target: 'participants',
    message: reminderDue
      ? `${name}的${stage}填写提醒时间已到，任务仍可提交、编辑或重新提交。`
      : `${name}的${stage}已开放，等待完成。`
  }
}

/**
 * 把后端任务事实转换成看板文案。参与者状态只保留结果主链语义，绝不用于推断任务是否开放或完成。
 */
export function buildCycleProgressView(progress: PerfCycleProgress): CycleProgressView {
  const counts = { total: progress.tasks.length, waiting: 0, open: 0, completed: 0 }

  for (const task of progress.tasks) {
    const state = taskDisplayState(task)

    if (state === 'WAITING') counts.waiting += 1
    if (state === 'OPEN') counts.open += 1
    if (state === 'COMPLETED') counts.completed += 1
  }

  const stages = STAGES.map(stage => {
    const tasks = progress.tasks.filter(task => task.type === stage)
    const completed = tasks.filter(task => taskDisplayState(task) === 'COMPLETED').length
    const open = tasks.filter(task => taskDisplayState(task) === 'OPEN').length
    const waiting = tasks.length - completed - open

    return {
      stage,
      label: TASK_STAGE_LABEL[stage],
      total: tasks.length,
      waiting,
      open,
      completed,
      percent: tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0
    }
  })

  const lifecycle = lifecycleCopy(progress.cycle.status)
  const generatedAt = Date.parse(progress.generatedAt)
  const now = Number.isFinite(generatedAt) ? generatedAt : Date.now()
  let missingItems = progress.tasks
    .map(task => taskMissingItem(progress, task, now))
    .filter((item): item is CycleProgressMissingItem => item != null)
  let headline = lifecycle.headline
  let description = lifecycle.description
  let nextAction = lifecycle.nextAction

  const activationIssues = progress.activationIssues ?? []

  if (progress.cycle.status === 'SCHEDULED' && progress.startFailure) {
    // 自动启动异常是可审计事实；不能继续展示“正常等待”，否则管理员无法判断为何未进入 ACTIVE。
    const failureIssues = activationIssues.length > 0 ? activationIssues : progress.startFailure.issues

    headline = '自动启动失败'
    description = '周期仍保持待启动，请修正问题后等待系统重试。'
    missingItems =
      failureIssues.length > 0
        ? activationMissingItems(failureIssues)
        : [{ code: 'CYCLE_START_FAILED', message: '周期自动启动失败，请检查配置后重试。', target: 'advanced' }]
    nextAction = {
      label: '修正启动问题',
      target: missingItems[0]?.target ?? 'advanced'
    }
  } else if (progress.cycle.status === 'SCHEDULED' && activationIssues.length > 0) {
    headline = '自动启动未通过复核'
    description = '周期保持待启动，请修正全部问题后等待重试。'
    missingItems = activationMissingItems(activationIssues)
    nextAction = {
      label: '修正启动问题',
      target: missingItems[0]?.target ?? 'advanced'
    }
  } else if (progress.cycle.status === 'ACTIVE') {
    const actionable = missingItems.some(item => item.code !== 'WAITING_TO_OPEN')

    nextAction = actionable
      ? { label: '查看待处理任务', target: 'participants' }
      : missingItems.length > 0
        ? { label: '等待任务开放', target: 'plan' }
        : { label: '任务已完成，进入后续处理', target: 'participants' }
  }

  return { headline, description, summary: counts, stages, missingItems, nextAction }
}
