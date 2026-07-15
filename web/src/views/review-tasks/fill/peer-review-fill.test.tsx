import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as PerfApi from '@/lib/perf-api'

import PeerReviewFill from './peer-review-fill'

const { routerPush, getPeerEvaluationContext, savePeerEvaluationDraft, submitPeerEvaluation } = vi.hoisted(() => ({
  routerPush: vi.fn(),
  getPeerEvaluationContext: vi.fn(),
  savePeerEvaluationDraft: vi.fn(),
  submitPeerEvaluation: vi.fn()
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: routerPush }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/perf-api', async importOriginal => {
  const actual = await importOriginal<typeof PerfApi>()

  return {
    ...actual,
    getPeerEvaluationContext,
    savePeerEvaluationDraft,
    submitPeerEvaluation
  }
})

const context = {
  assignment: { id: 11, relation: 'PEER', status: 'SUBMITTED' },
  participant: { id: 7, cycleId: 1 },
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
  employee: { open_id: 'ou_employee', name: '员工甲', job_title: '产品经理' },
  task: { id: 21, startAt: null, openedAt: '2026-07-15T00:00:00.000Z' },
  form: {
    formSnapshotId: 88,
    subforms: [
      {
        key: 'subform:PEER',
        type: 'PEER',
        title: '360°可观察行为评估',
        sortOrder: 1,
        dimensions: [
          {
            key: 'dimension:PEER:REVIEWER:0',
            audience: 'REVIEWER',
            name: '协作沟通',
            sortOrder: 0,
            items: [
              {
                key: 'item:peer:rating',
                type: 'RATING',
                title: '协作评级',
                required: true,
                sortOrder: 0
              }
            ]
          }
        ]
      }
    ]
  },
  submitted: {
    id: 100,
    cycleId: 1,
    participantId: 7,
    stage: 'PEER',
    reviewerOpenId: 'ou_reviewer',
    status: 'SUBMITTED',
    items: [
      {
        id: 1,
        submissionId: 100,
        subformKey: 'subform:PEER',
        dimensionKey: 'dimension:PEER:REVIEWER:0',
        itemKey: 'item:peer:rating',
        itemType: 'RATING',
        rawLevel: 'A'
      }
    ]
  },
  draft: null,
  state: 'EFFECTIVE'
} as const

describe('PeerReviewFill 关键流程', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getPeerEvaluationContext.mockResolvedValue(context)
    submitPeerEvaluation.mockResolvedValue({ ok: true })
  })

  it('已提交答卷先只读，进入编辑后可按 PEER 动态表单原子重新提交，页面没有晋升或无法评价入口', async () => {
    render(<PeerReviewFill assignmentId={11} />)

    expect(await screen.findByText('360°可观察行为评估')).toBeInTheDocument()
    expect(screen.queryByText(/晋升/)).not.toBeInTheDocument()
    expect(screen.queryByText(/无法评价|了解不足/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '编辑并重新提交' }))
    fireEvent.click(screen.getByRole('radio', { name: /B · 良好/ }))
    fireEvent.click(screen.getByRole('button', { name: '重新提交' }))

    await waitFor(() =>
      expect(submitPeerEvaluation).toHaveBeenCalledWith({
        assignmentId: 11,
        items: [
          {
            subformKey: 'subform:PEER',
            dimensionKey: 'dimension:PEER:REVIEWER:0',
            itemKey: 'item:peer:rating',
            rawLevel: 'B'
          }
        ]
      })
    )
    expect(routerPush).toHaveBeenCalledWith('/review-tasks')
  })
})
