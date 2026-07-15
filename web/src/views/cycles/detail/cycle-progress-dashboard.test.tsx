import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { PerfCycleProgress } from '@/lib/perf-api'

import CycleProgressDashboard from './cycle-progress-dashboard'

const progress: PerfCycleProgress = {
  generatedAt: '2026-07-14T04:00:00.000Z',
  cycle: { id: 1, name: '2026 上半年', status: 'ACTIVE', plannedStartAt: '2026-07-14T01:00:00.000Z' },
  totals: { participants: 1, tasks: 2, notStarted: 1, open: 1, submitted: 0, locked: 0 },
  stages: [],
  tasks: [
    {
      id: 100,
      participantId: 10,
      type: 'SELF',
      startAt: '2026-07-14T01:00:00.000Z',
      reminderDeadlineAt: '2026-07-14T03:00:00.000Z',
      openedAt: '2026-07-14T01:00:00.000Z',
      completedAt: null,
      status: 'OPEN'
    },
    {
      id: 101,
      participantId: 10,
      type: 'MANAGER',
      startAt: '2026-07-14T05:00:00.000Z',
      reminderDeadlineAt: '2026-07-14T08:00:00.000Z',
      openedAt: null,
      completedAt: null,
      status: 'WAITING'
    }
  ],
  missingItems: [
    { code: 'TASK_INCOMPLETE', participantId: 10, employeeOpenId: '张三', stage: 'SELF', message: 'SELF 任务尚未完成' },
    { code: 'TASK_NOT_OPEN', participantId: 10, employeeOpenId: '张三', stage: 'MANAGER', message: 'MANAGER 任务尚未开放' }
  ],
  nextActions: [],
  startFailure: null,
  activationIssues: [],
  schedules: []
}

describe('CycleProgressDashboard', () => {
  it('展示由任务事实派生的进度与软截止文案', () => {
    render(<CycleProgressDashboard progress={progress} />)

    expect(screen.getByText('任务并行进行中')).toBeInTheDocument()
    expect(screen.getByText('开放中').parentElement).toHaveTextContent('1')
    expect(screen.getByText(/提醒时间已到，任务仍可提交、编辑或重新提交/)).toBeInTheDocument()
    expect(screen.getByText(/开始时间前不可填写或提交/)).toBeInTheDocument()
    expect(screen.queryByText('自评中')).not.toBeInTheDocument()
  })

  it('下一步操作通过公开回调定位到参与者或计划', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()

    render(<CycleProgressDashboard progress={progress} onNavigate={onNavigate} />)
    await user.click(screen.getByRole('button', { name: '查看待处理任务' }))

    expect(onNavigate).toHaveBeenCalledWith('participants')
  })
})
