import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as PerfApi from '@/lib/perf-api'

import ManagerReviewFill from './manager-review-fill'

const {
  routerPush,
  getManagerEvaluationContext,
  saveManagerEvaluationDraft,
  submitManagerEvaluation,
  getParticipantOkr,
  triggerParticipantOkrSync
} = vi.hoisted(() => ({
    routerPush: vi.fn(),
    getManagerEvaluationContext: vi.fn(),
    saveManagerEvaluationDraft: vi.fn(),
    submitManagerEvaluation: vi.fn(),
    getParticipantOkr: vi.fn(),
    triggerParticipantOkrSync: vi.fn()
  }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: routerPush }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/perf-api', async importOriginal => {
  const actual = await importOriginal<typeof PerfApi>()

  return {
    ...actual,
    getManagerEvaluationContext,
    saveManagerEvaluationDraft,
    submitManagerEvaluation,
    getParticipantOkr,
    triggerParticipantOkrSync
  }
})

const context = {
  participant: { id: 7, cycleId: 1, isPromotionEnabled: true },
  cycle: {
    id: 1,
    name: '2026 上半年绩效',
    status: 'ACTIVE',
    currentConfigVersion: {
      ratings: [
        { symbol: 'S', name: '卓越' },
        { symbol: 'A', name: '优秀' },
        { symbol: 'B', name: '良好' },
        { symbol: 'C', name: '待改进' }
      ]
    }
  },
  employee: {
    open_id: 'ou_employee',
    name: '员工甲',
    departmentPath: '集团 / 产品中心',
    jobTitle: '产品经理',
    jobLevel: 'M2',
    effectiveDate: '2021-03-15'
  },
  task: { id: 21, startAt: null, openedAt: '2026-07-15T00:00:00.000Z' },
  form: {
    formSnapshotId: 88,
    subforms: [
      {
        key: 'subform:MANAGER',
        type: 'MANAGER',
        title: '上级评估',
        sortOrder: 1,
        dimensions: [
          {
            key: 'dimension:performance',
            audience: 'LEADER',
            name: '核心业绩',
            weight: '100',
            isCore: true,
            sortOrder: 0,
            items: [
              {
                key: 'item:performance:score',
                type: 'SCORE',
                title: '业绩分数',
                required: true,
                sortOrder: 0
              }
            ]
          }
        ]
      },
      {
        key: 'subform:PROMOTION',
        type: 'PROMOTION',
        title: '晋升评估',
        sortOrder: 2,
        dimensions: [
          {
            key: 'dimension:promotion:leader',
            audience: 'LEADER',
            name: 'Leader 晋升结论',
            sortOrder: 0,
            items: [
              {
                key: 'item:promotion:conclusion',
                type: 'SINGLE_SELECT',
                title: '晋升建议',
                required: true,
                sortOrder: 0,
                config: {
                  options: [
                    { value: '建议晋升', label: '建议晋升' },
                    { value: '暂缓晋升', label: '暂缓晋升' }
                  ]
                }
              }
            ]
          }
        ]
      }
    ]
  },
  submitted: null,
  draft: null,
  state: 'DRAFT',
  selfEvaluation: {
    id: 90,
    items: [{ id: 1, itemKey: 'item:self:summary', itemType: 'MARKDOWN', value: '完成核心项目' }]
  },
  peerResult: {
    status: 'READY',
    reviewerCount: 2,
    compositeScore: '85.00',
    stageLevel: 'A',
    dimensions: [{ id: 'dimension:collaboration', name: '协作沟通', score: '85', level: 'A' }]
  },
  managerResult: null,
  history: []
} as const

describe('ManagerReviewFill 关键流程', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getManagerEvaluationContext.mockResolvedValue(context)
    submitManagerEvaluation.mockResolvedValue({
      ok: true,
      result: {
        status: 'READY',
        compositeScore: '88.00',
        initialLevel: 'A',
        stageLevel: 'A',
        constraintReasons: [],
        dimensions: []
      }
    })
    getParticipantOkr.mockResolvedValue({
      participantId: 7,
      employeeOpenId: 'ou_employee',
      lastSyncedAt: null,
      sync: { status: 'success' },
      cycles: []
    })
    triggerParticipantOkrSync.mockResolvedValue({ ok: true, status: 'success' })
  })

  it('展示自评和 360°参考，用 Leader 晋升子表单提交，并只展示系统计算等级', async () => {
    render(<ManagerReviewFill participantId={7} />)

    expect(await screen.findByText('集团 / 产品中心')).toBeInTheDocument()
    expect(screen.getByText('M2')).toBeInTheDocument()
    expect(screen.getByText('2021-03-15')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '360°评估' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '员工自评' }))
    expect(screen.getByText('完成核心项目')).toBeInTheDocument()
    expect(screen.getByText('晋升评估（Leader 填写）')).toBeInTheDocument()
    expect(screen.queryByText(/初步绩效评级/)).not.toBeInTheDocument()
    await waitFor(() => expect(triggerParticipantOkrSync).toHaveBeenCalledWith(7))

    fireEvent.change(screen.getByLabelText('业绩分数'), { target: { value: '88' } })
    fireEvent.click(screen.getByRole('combobox', { name: '晋升建议' }))
    fireEvent.click(screen.getByRole('option', { name: '建议晋升' }))
    fireEvent.click(screen.getByRole('button', { name: '提交上级评估' }))

    await waitFor(() =>
      expect(submitManagerEvaluation).toHaveBeenCalledWith({
        participantId: 7,
        items: [
          {
            subformKey: 'subform:MANAGER',
            dimensionKey: 'dimension:performance',
            itemKey: 'item:performance:score',
            rawScore: 88
          },
          {
            subformKey: 'subform:PROMOTION',
            dimensionKey: 'dimension:promotion:leader',
            itemKey: 'item:promotion:conclusion',
            value: '建议晋升'
          }
        ]
      })
    )
    expect(await screen.findByText('初始等级 A')).toBeInTheDocument()
    expect(routerPush).toHaveBeenCalledWith('/review-tasks')
  })
})
