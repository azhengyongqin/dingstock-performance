import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as PerfApi from '@/lib/perf-api'

import ManagerReviewFill from './manager-review-fill'

const {
  routerPush,
  useSearchParams,
  getManagerEvaluationContext,
  saveManagerEvaluationDraft,
  submitManagerEvaluation,
  getParticipantOkr,
  triggerParticipantOkrSync
} = vi.hoisted(() => ({
  routerPush: vi.fn(),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  getManagerEvaluationContext: vi.fn(),
  saveManagerEvaluationDraft: vi.fn(),
  submitManagerEvaluation: vi.fn(),
  getParticipantOkr: vi.fn(),
  triggerParticipantOkrSync: vi.fn()
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
  usePathname: () => '/review-tasks/fill',
  useSearchParams
}))
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
            type: 'SCORING',
            audience: 'LEADER',
            name: '核心业绩',
            scoringMethod: 'SCORE',
            weight: '60',
            isCore: true,
            sortOrder: 0,
            fields: [
              {
                key: 'field:performance:comment',
                type: 'LONG_TEXT',
                title: '业绩说明',
                requiredRule: 'CONDITIONAL',
                requiredLevels: ['S', 'C'],
                sortOrder: 0
              }
            ]
          },
          {
            key: 'dimension:values',
            type: 'SCORING',
            audience: 'LEADER',
            name: '价值观',
            scoringMethod: 'RATING',
            weight: '40',
            isCore: false,
            sortOrder: 1,
            fields: []
          },
          {
            key: 'dimension:summary',
            type: 'NON_SCORING',
            audience: 'LEADER',
            name: '综合建议',
            sortOrder: 2,
            fields: [
              {
                key: 'field:summary:text',
                type: 'LONG_TEXT',
                title: '综合建议',
                requiredRule: 'ALWAYS',
                sortOrder: 0
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
    dimensionAnswers: [
      {
        id: 1,
        submissionId: 90,
        subformKey: 'subform:SELF',
        dimensionKey: 'dimension:self:summary',
        scoringMethod: null,
        fields: [{ id: 2, fieldKey: 'field:self:summary', fieldType: 'MARKDOWN', value: '## 完成核心项目' }]
      }
    ]
  },
  peerResult: {
    status: 'READY',
    reviewerCount: 2,
    compositeScore: '85.00',
    initialLevel: 'A',
    stageLevel: 'A',
    constraintReasons: [],
    dimensions: [{ id: 'dimension:collaboration', name: '协作沟通', score: '85', level: 'A' }],
    analysis: {
      assignedReviewerCount: 3,
      submittedReviewerCount: 2,
      relationCounts: [
        { relation: 'PROJECT_OWNER', reviewerCount: 1 },
        { relation: 'PEER', reviewerCount: 1 }
      ],
      dimensions: [
        {
          id: 'dimension:collaboration',
          name: '协作沟通',
          score: '85',
          level: 'A',
          distribution: { S: 0, A: 1, B: 1, C: 0 }
        },
        {
          id: 'dimension:responsibility',
          name: '责任担当',
          score: '90',
          level: 'S',
          distribution: { S: 1, A: 1, B: 0, C: 0 }
        }
      ],
      reviewers: [
        {
          submissionId: 201,
          reviewerOpenId: 'ou_peer_1',
          relation: 'PEER',
          reviewer: {
            open_id: 'ou_peer_1',
            name: '评审员甲',
            avatar: null,
            departmentPath: null,
            jobTitle: null
          },
          dimensions: [
            {
              id: 'dimension:collaboration',
              name: '协作沟通',
              rawLevel: 'A',
              rawScore: null,
              mappedLevel: 'A',
              fields: [
                {
                  fieldKey: 'field:collaboration:comment',
                  title: '协作评语',
                  type: 'LONG_TEXT',
                  value: '沟通及时，能够主动补位。'
                }
              ]
            },
            {
              id: 'dimension:responsibility',
              name: '责任担当',
              rawLevel: 'S',
              rawScore: null,
              mappedLevel: 'S',
              fields: []
            }
          ]
        },
        {
          submissionId: 202,
          reviewerOpenId: 'ou_project_owner',
          relation: 'PROJECT_OWNER',
          reviewer: {
            open_id: 'ou_project_owner',
            name: '项目负责人乙',
            avatar: null,
            departmentPath: null,
            jobTitle: null
          },
          dimensions: [
            {
              id: 'dimension:collaboration',
              name: '协作沟通',
              rawLevel: 'B',
              rawScore: null,
              mappedLevel: 'B',
              fields: []
            },
            {
              id: 'dimension:responsibility',
              name: '责任担当',
              rawLevel: 'A',
              rawScore: null,
              mappedLevel: 'A',
              fields: []
            }
          ]
        }
      ]
    }
  },
  managerResult: null,
  history: []
} as const

describe('ManagerReviewFill 关键流程', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSearchParams.mockReturnValue(new URLSearchParams())
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

  it('展示新版混合计分维度和字段，并提交维度回答且不呈现评估项', async () => {
    render(<ManagerReviewFill participantId={7} />)

    expect(await screen.findByText('集团 / 产品中心')).toBeInTheDocument()
    expect(screen.getByText('M2')).toBeInTheDocument()
    expect(screen.getByText('2021-03-15')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '360°评估' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '员工自评' }))
    expect(screen.getByRole('heading', { name: '完成核心项目', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('占比 60%')).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: '价值观' })).toBeInTheDocument()
    expect(screen.queryByText('评估项')).not.toBeInTheDocument()
    expect(screen.queryByText(/初步绩效评级/)).not.toBeInTheDocument()
    await waitFor(() => expect(triggerParticipantOkrSync).toHaveBeenCalledWith(7))

    fireEvent.change(screen.getByRole('textbox', { name: '核心业绩' }), { target: { value: '95' } })
    expect(screen.getByText('选择 S 时必填')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '业绩说明' }), { target: { value: '超额达成' } })
    fireEvent.click(screen.getByRole('radio', { name: /A · 优秀/ }))
    fireEvent.change(screen.getByRole('textbox', { name: '综合建议' }), { target: { value: '建议承担更复杂项目' } })
    fireEvent.click(screen.getByRole('button', { name: '提交上级评估' }))

    await waitFor(() =>
      expect(submitManagerEvaluation).toHaveBeenCalledWith({
        participantId: 7,
        dimensions: [
          {
            subformKey: 'subform:MANAGER',
            dimensionKey: 'dimension:performance',
            rawScore: 95,
            fields: [{ fieldKey: 'field:performance:comment', value: '超额达成' }]
          },
          {
            subformKey: 'subform:MANAGER',
            dimensionKey: 'dimension:values',
            rawLevel: 'A',
            fields: []
          },
          {
            subformKey: 'subform:MANAGER',
            dimensionKey: 'dimension:summary',
            fields: [{ fieldKey: 'field:summary:text', value: '建议承担更复杂项目' }]
          }
        ]
      })
    )
    expect(await screen.findByText('初始等级 A')).toBeInTheDocument()
    expect(routerPush).toHaveBeenCalledWith('/review-tasks')
  })

  it('展示当前 360°概览，并在评审明细中展开查看生效答卷', async () => {
    const user = userEvent.setup()

    render(<ManagerReviewFill participantId={7} />)

    fireEvent.click(await screen.findByRole('tab', { name: '360°评估' }))
    expect(screen.getByRole('heading', { name: '360°评估结果' })).toBeInTheDocument()
    expect(screen.getByText(/已提交/)).toBeInTheDocument()
    expect(screen.getByText('2/3')).toBeInTheDocument()
    expect(screen.getByText(/项目负责人/)).toBeInTheDocument()
    expect(screen.getByText(/同部门同事/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '协作沟通评级人数柱状图' })).toHaveAccessibleDescription(
      'C 0 人，B 1 人，A 1 人，S 0 人'
    )

    fireEvent.click(screen.getByRole('tab', { name: '评审明细' }))
    expect(screen.getByText('评审员甲')).toBeInTheDocument()
    expect(screen.getByText('项目负责人乙')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /项目负责人乙/ }))
    expect(await screen.findByRole('heading', { name: '责任担当' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '协作沟通' })).toBeInTheDocument()
  })

  it('从团队看板进入时，返回入口和提交成功跳转都回到团队看板', async () => {
    useSearchParams.mockReturnValue(new URLSearchParams('from=team-review'))
    render(<ManagerReviewFill participantId={7} />)

    expect(await screen.findByRole('button', { name: /团队看板/ })).toHaveAttribute('href', '/team-review')

    fireEvent.change(screen.getByRole('textbox', { name: '核心业绩' }), { target: { value: '88' } })
    fireEvent.click(screen.getByRole('radio', { name: /A · 优秀/ }))
    fireEvent.change(screen.getByRole('textbox', { name: '综合建议' }), { target: { value: '继续保持' } })
    fireEvent.click(screen.getByRole('button', { name: '提交上级评估' }))

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/team-review'))
  })
})
