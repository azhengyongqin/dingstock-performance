import { describe, expect, it } from 'vitest'

import type { PerfCycleProgress } from '@/lib/perf-api'

import { buildCycleProgressView } from './cycle-progress-utils'

const activeProgress: PerfCycleProgress = {
  generatedAt: '2026-07-14T04:00:00.000Z',
  cycle: { id: 9, name: '2026 上半年', status: 'ACTIVE', plannedStartAt: '2026-07-14T01:00:00.000Z' },
  totals: { participants: 2, tasks: 5, notStarted: 2, open: 2, submitted: 1, locked: 0 },
  stages: [],
  tasks: [
    {
      id: 1,
      participantId: 101,
      type: 'SELF',
      startAt: '2026-07-14T01:00:00.000Z',
      reminderDeadlineAt: '2026-07-14T03:00:00.000Z',
      openedAt: '2026-07-14T01:00:00.000Z',
      completedAt: '2026-07-14T02:00:00.000Z',
      status: 'COMPLETED'
    },
    {
      id: 2,
      participantId: 101,
      type: 'PEER',
      startAt: '2026-07-14T05:00:00.000Z',
      reminderDeadlineAt: '2026-07-14T08:00:00.000Z',
      openedAt: null,
      completedAt: null,
      status: 'WAITING'
    },
    {
      id: 3,
      participantId: 101,
      type: 'MANAGER',
      startAt: '2026-07-14T01:00:00.000Z',
      reminderDeadlineAt: '2026-07-14T03:00:00.000Z',
      openedAt: '2026-07-14T01:00:00.000Z',
      completedAt: null,
      status: 'OPEN'
    },
    {
      id: 4,
      participantId: 101,
      type: 'AI',
      startAt: null,
      reminderDeadlineAt: null,
      openedAt: null,
      completedAt: null,
      status: 'WAITING'
    },
    {
      id: 5,
      participantId: 102,
      type: 'SELF',
      startAt: '2026-07-14T01:00:00.000Z',
      reminderDeadlineAt: '2026-07-14T03:00:00.000Z',
      openedAt: '2026-07-14T01:00:00.000Z',
      completedAt: null,
      status: 'OPEN'
    }
  ],
  missingItems: [
    { code: 'TASK_NOT_OPEN', participantId: 101, employeeOpenId: '张三', stage: 'PEER', message: 'PEER 任务尚未开放' },
    { code: 'TASK_INCOMPLETE', participantId: 101, employeeOpenId: '张三', stage: 'MANAGER', message: 'MANAGER 任务尚未完成' },
    { code: 'TASK_INCOMPLETE', participantId: 102, employeeOpenId: '李四', stage: 'SELF', message: 'SELF 任务尚未完成' }
  ],
  nextActions: [],
  startFailure: null,
  activationIssues: [],
  schedules: []
}

describe('buildCycleProgressView', () => {
  it('只按任务事实汇总阶段进度，不把参与者旧细粒度状态当作当前阶段', () => {
    const result = buildCycleProgressView(activeProgress)

    expect(result.summary).toEqual({ total: 5, waiting: 2, open: 2, completed: 1 })
    expect(result.stages.find(stage => stage.stage === 'SELF')).toMatchObject({ total: 2, open: 1, completed: 1 })
    expect(result.stages.find(stage => stage.stage === 'MANAGER')).toMatchObject({ total: 1, open: 1 })
    expect(result.headline).toBe('任务并行进行中')
  })

  it('开始时间未到显示硬开放门槛；提醒时间已过仍明确允许提交', () => {
    const result = buildCycleProgressView(activeProgress)

    expect(result.missingItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskId: 2, code: 'WAITING_TO_OPEN', message: expect.stringContaining('开始时间前不可填写') }),
        expect.objectContaining({ taskId: 3, code: 'SUBMISSION_REMINDER_DUE', message: expect.stringContaining('仍可提交') }),
        expect.objectContaining({ taskId: 5, code: 'SUBMISSION_REMINDER_DUE', message: expect.stringContaining('仍可提交') })
      ])
    )
  })

  it.each([
    ['DRAFT', '完善周期配置', '编辑周期'],
    ['SCHEDULED', '等待自动启动', '查看启动检查'],
    ['ARCHIVED', '周期已归档', '查看历史结果']
  ] as const)('%s 只表达粗粒度生命周期，不伪造业务阶段', (status, headline, actionLabel) => {
    const result = buildCycleProgressView({
      ...activeProgress,
      cycle: { ...activeProgress.cycle, status },
      tasks: [],
      totals: { ...activeProgress.totals, tasks: 0, notStarted: 0, open: 0, submitted: 0 }
    })

    expect(result.headline).toBe(headline)
    expect(result.nextAction.label).toBe(actionLabel)
  })

  it('启动复核失败优先展示全部可操作问题，不把 SCHEDULED 误写成正常等待', () => {
    const result = buildCycleProgressView({
      ...activeProgress,
      cycle: { ...activeProgress.cycle, status: 'SCHEDULED' },
      tasks: [],
      activationIssues: [
        { code: 'PARTICIPANTS_EMPTY', message: '尚未添加参与者', path: 'participants' },
        { code: 'PLAN_INVALID', message: '任务计划不完整', path: 'plan.stages' }
      ]
    })

    expect(result.headline).toBe('自动启动未通过复核')
    expect(result.missingItems.map(item => item.code)).toEqual(['PARTICIPANTS_EMPTY', 'PLAN_INVALID'])
    expect(result.nextAction).toMatchObject({ label: '修正启动问题', target: 'participants' })
  })

  it('启动执行失败时展示失败事实，并引导修正后重试', () => {
    const result = buildCycleProgressView({
      ...activeProgress,
      cycle: { ...activeProgress.cycle, status: 'SCHEDULED' },
      tasks: [],
      startFailure: {
        occurredAt: '2026-07-14T04:00:00.000Z',
        issues: [{ code: 'PLAN_INVALID', message: '生成评估任务失败，请检查任务计划。', path: 'plan.stages' }]
      },
      activationIssues: [{ code: 'PLAN_INVALID', message: '生成评估任务失败，请检查任务计划。', path: 'plan.stages' }]
    })

    expect(result.headline).toBe('自动启动失败')
    expect(result.missingItems).toEqual([
      expect.objectContaining({ code: 'PLAN_INVALID', message: expect.stringContaining('生成评估任务失败') })
    ])
    expect(result.nextAction).toMatchObject({ label: '修正启动问题', target: 'plan' })
  })
})
