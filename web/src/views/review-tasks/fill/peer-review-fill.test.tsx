import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as PerfApi from '@/lib/perf-api'

import PeerReviewFill from './peer-review-fill'

const {
  routerPush,
  getPeerEvaluationContext,
  savePeerEvaluationDraft,
  submitPeerEvaluation,
  getParticipantOkr,
  triggerParticipantOkrSync
} = vi.hoisted(() => ({
  routerPush: vi.fn(),
  getPeerEvaluationContext: vi.fn(),
  savePeerEvaluationDraft: vi.fn(),
  submitPeerEvaluation: vi.fn(),
  getParticipantOkr: vi.fn(),
  triggerParticipantOkrSync: vi.fn()
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
  usePathname: () => '/review-tasks/fill',
  useSearchParams: () => new URLSearchParams()
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/perf-api', async importOriginal => {
  const actual = await importOriginal<typeof PerfApi>()

  return {
    ...actual,
    getPeerEvaluationContext,
    savePeerEvaluationDraft,
    submitPeerEvaluation,
    getParticipantOkr,
    triggerParticipantOkrSync
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
        { symbol: 'S', name: '卓越', minScore: '90', maxScore: '100', mappingScore: '95' },
        { symbol: 'A', name: '优秀', minScore: '80', maxScore: '90', mappingScore: '85' },
        { symbol: 'B', name: '良好', minScore: '60', maxScore: '80', mappingScore: '70' },
        { symbol: 'C', name: '待改进', minScore: '0', maxScore: '60', mappingScore: '50' }
      ]
    }
  },
  employee: {
    open_id: 'ou_employee',
    name: '员工甲',
    departmentPath: '集团 / 产品中心',
    jobTitle: '产品经理'
  },
  task: { id: 21, startAt: null, openedAt: '2026-07-15T00:00:00.000Z' },
  form: {
    formSnapshotId: 88,
    selfSubforms: [
      {
        key: 'subform:SELF',
        type: 'SELF',
        title: '员工自评',
        sortOrder: 0,
        dimensions: [
          {
            key: 'dimension:SELF:EMPLOYEE:0',
            type: 'SCORING',
            audience: 'EMPLOYEE',
            name: '自评等级',
            scoringMethod: 'RATING',
            weight: '100',
            isCore: true,
            sortOrder: 0,
            fields: [
              {
                key: 'field:self:summary',
                type: 'MARKDOWN',
                title: '自评总结',
                requiredRule: 'OPTIONAL',
                sortOrder: 0
              }
            ]
          }
        ]
      }
    ],
    subforms: [
      {
        key: 'subform:PEER',
        type: 'PEER',
        title: '360°可观察行为评估',
        sortOrder: 1,
        dimensions: [
          {
            key: 'dimension:PEER:REVIEWER:0',
            type: 'SCORING',
            audience: 'REVIEWER',
            name: '协作沟通',
            scoringMethod: 'RATING',
            weight: '60',
            isCore: true,
            sortOrder: 0,
            fields: [
              {
                key: 'field:peer:comment',
                type: 'LONG_TEXT',
                title: '评价说明',
                requiredRule: 'CONDITIONAL',
                requiredLevels: ['S', 'C'],
                sortOrder: 0
              }
            ]
          },
          {
            key: 'dimension:PEER:REVIEWER:1',
            type: 'SCORING',
            audience: 'REVIEWER',
            name: '学习成长',
            scoringMethod: 'SCORE',
            weight: '40',
            isCore: false,
            sortOrder: 1,
            fields: []
          },
          {
            key: 'dimension:PEER:REVIEWER:2',
            type: 'NON_SCORING',
            audience: 'REVIEWER',
            name: '补充反馈',
            sortOrder: 2,
            fields: [
              {
                key: 'field:peer:suggestion',
                type: 'MARKDOWN',
                title: '改进建议',
                requiredRule: 'OPTIONAL',
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
    dimensionAnswers: [
      {
        id: 1,
        submissionId: 100,
        subformKey: 'subform:PEER',
        dimensionKey: 'dimension:PEER:REVIEWER:0',
        scoringMethod: 'RATING',
        rawLevel: 'A',
        calculationScore: '85',
        derivedLevel: 'A',
        fields: []
      },
      {
        id: 2,
        submissionId: 100,
        subformKey: 'subform:PEER',
        dimensionKey: 'dimension:PEER:REVIEWER:1',
        scoringMethod: 'SCORE',
        rawScore: '86.5',
        calculationScore: '86.5',
        derivedLevel: 'A',
        fields: []
      }
    ]
  },
  draft: null,
  state: 'EFFECTIVE',
  selfEvaluation: {
    id: 90,
    cycleId: 1,
    participantId: 7,
    stage: 'SELF',
    reviewerOpenId: 'ou_employee',
    status: 'SUBMITTED',
    dimensionAnswers: [
      {
        id: 901,
        submissionId: 90,
        subformKey: 'subform:SELF',
        dimensionKey: 'dimension:SELF:EMPLOYEE:0',
        scoringMethod: null,
        fields: [
          {
            id: 902,
            fieldKey: 'field:self:summary',
            fieldType: 'MARKDOWN',
            value: '## 完成核心项目\n\n- 协作落地'
          }
        ]
      }
    ]
  }
} as const

describe('PeerReviewFill 关键流程', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getPeerEvaluationContext.mockResolvedValue(context)
    submitPeerEvaluation.mockResolvedValue({ ok: true })
    getParticipantOkr.mockResolvedValue({
      participantId: 7,
      employeeOpenId: 'ou_employee',
      lastSyncedAt: null,
      sync: { status: 'success' },
      cycles: []
    })
    triggerParticipantOkrSync.mockResolvedValue({ ok: true, status: 'success' })
  })

  it('按计分/非计分维度呈现并用新版维度载荷重新提交，页面不出现评估项', async () => {
    render(<PeerReviewFill assignmentId={11} />)

    expect(await screen.findByText('360°可观察行为评估')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '基本信息', selected: true })).toBeInTheDocument()
    expect(screen.getByText('集团 / 产品中心')).toBeInTheDocument()
    expect(screen.queryByText('职级：')).not.toBeInTheDocument()
    expect(screen.queryByText('入职日期：')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '员工自评' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '员工自评' }))
    expect(screen.getByRole('heading', { name: '完成核心项目', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('协作落地').closest('ul')).toBeInTheDocument()
    expect(screen.queryByText(/晋升/)).not.toBeInTheDocument()
    expect(screen.queryByText(/无法评价|了解不足/)).not.toBeInTheDocument()
    expect(screen.queryByText(/评估项/)).not.toBeInTheDocument()
    expect(screen.getByText('学习成长')).toBeInTheDocument()
    expect(screen.getByText('补充反馈')).toBeInTheDocument()
    expect(screen.getByText('加权评分 85.60 分')).toBeInTheDocument()
    expect(screen.getByText('本次加权等级 A')).toBeInTheDocument()
    await waitFor(() => expect(triggerParticipantOkrSync).toHaveBeenCalledWith(7))

    fireEvent.click(screen.getByRole('button', { name: '编辑并重新提交' }))
    fireEvent.click(screen.getByRole('radio', { name: /B · 良好/ }))
    fireEvent.change(screen.getByRole('textbox', { name: '学习成长' }), { target: { value: '91.25' } })
    fireEvent.click(screen.getByRole('button', { name: '重新提交' }))

    await waitFor(() =>
      expect(submitPeerEvaluation).toHaveBeenCalledWith({
        assignmentId: 11,
        dimensions: [
          {
            subformKey: 'subform:PEER',
            dimensionKey: 'dimension:PEER:REVIEWER:0',
            rawLevel: 'B',
            fields: []
          },
          {
            subformKey: 'subform:PEER',
            dimensionKey: 'dimension:PEER:REVIEWER:1',
            rawScore: 91.25,
            fields: []
          }
        ]
      })
    )
    expect(routerPush).toHaveBeenCalledWith('/review-tasks')
  })
})
