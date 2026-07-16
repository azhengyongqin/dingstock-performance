import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as PerfApi from '@/lib/perf-api'
import type { PerfEvaluationItemResult, PerfSelfEvaluationContext } from '@/lib/perf-api'

import SelfReview from './index'

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn().mockResolvedValue({ open_id: 'ou_me', name: '测试员工', job_title: '工程师' }),
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
  clearAuth: vi.fn(),
  getToken: vi.fn()
}))

vi.mock('@/lib/perf-api', async importOriginal => {
  const actual = await importOriginal<typeof PerfApi>()

  return {
    ...actual,
    getSelfEvaluationContext: vi.fn(),
    saveSelfEvaluationDraft: vi.fn(),
    submitSelfEvaluation: vi.fn(),
    getParticipantOkr: vi.fn(),
    triggerParticipantOkrSync: vi.fn()
  }
})

const {
  getSelfEvaluationContext,
  saveSelfEvaluationDraft,
  submitSelfEvaluation,
  getParticipantOkr,
  triggerParticipantOkrSync
} = await import('@/lib/perf-api')

const mockedGetContext = vi.mocked(getSelfEvaluationContext)
const mockedSaveDraft = vi.mocked(saveSelfEvaluationDraft)
const mockedSubmit = vi.mocked(submitSelfEvaluation)
const mockedGetOkr = vi.mocked(getParticipantOkr)
const mockedTriggerOkrSync = vi.mocked(triggerParticipantOkrSync)

const ratingItemResult = (itemKey: string, rawLevel: string | null): PerfEvaluationItemResult => ({
  id: 1,
  submissionId: 10,
  subformKey: 'subform:SELF',
  dimensionKey: 'dimension:SELF:EMPLOYEE:0',
  itemKey,
  itemType: 'RATING',
  rawLevel: rawLevel as never,
  rawScore: null,
  calculationScore: null,
  value: null
})

const baseContext = (overrides: Partial<PerfSelfEvaluationContext> = {}): PerfSelfEvaluationContext => ({
  participant: {
    id: 7,
    cycleId: 1,
    employeeOpenId: 'ou_me',
    status: 'ACTIVE',
    isPromotionEnabled: false,
    formSnapshotId: 88,
    cycle: { id: 1, name: '2026 上半年绩效评定', status: 'ACTIVE' }
  },
  task: { id: 21, startAt: '2026-08-01T01:00:00.000Z', openedAt: '2026-08-01T01:00:00.000Z' },
  form: {
    formSnapshotId: 88,
    subforms: [
      {
        key: 'subform:SELF',
        type: 'SELF',
        title: '员工自评',
        sortOrder: 0,
        dimensions: [
          {
            key: 'dimension:SELF:EMPLOYEE:0',
            audience: 'EMPLOYEE',
            name: '自评等级',
            sortOrder: 0,
            items: [{ key: 'item:SELF:EMPLOYEE:0:0', type: 'RATING', title: '自评等级', required: true, sortOrder: 0 }]
          }
        ]
      }
    ]
  },
  submitted: null,
  draft: null,
  state: 'DRAFT',
  ...overrides
})

beforeEach(() => {
  vi.clearAllMocks()
  mockedGetOkr.mockResolvedValue({
    participantId: 7,
    employeeOpenId: 'ou_me',
    lastSyncedAt: null,
    sync: { status: 'success' },
    cycles: []
  })
  mockedTriggerOkrSync.mockResolvedValue({ ok: true, status: 'success' })
})

describe('SelfReview 加载自评上下文并渲染动态表单', () => {
  it('加载完成后展示周期名称与 SELF 子表单的 RATING 评估项', async () => {
    mockedGetContext.mockResolvedValue(baseContext())

    render(<SelfReview />)

    expect(await screen.findByText('2026 上半年绩效评定')).toBeInTheDocument()

    // 页头标题与 SELF 子表单卡片标题都渲染「员工自评」，用数量断言而非唯一匹配
    expect(screen.getAllByText('员工自评')).toHaveLength(2)
    expect(screen.getAllByRole('radio')).toHaveLength(4)
    expect(screen.getByText('草稿')).toBeInTheDocument()
    await waitFor(() => expect(mockedTriggerOkrSync).toHaveBeenCalledWith(7))
  })
})

describe('SelfReview 保存草稿', () => {
  it('填写评级后点击保存草稿会调用 PUT /evaluations/self/draft', async () => {
    const user = userEvent.setup()

    mockedGetContext.mockResolvedValue(baseContext())
    mockedSaveDraft.mockResolvedValue({} as never)

    render(<SelfReview />)
    await screen.findByText('2026 上半年绩效评定')

    await user.click(screen.getByRole('radio', { name: 'A · 优秀' }))
    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    expect(mockedSaveDraft).toHaveBeenCalledWith({
      cycleId: 1,
      items: [
        {
          subformKey: 'subform:SELF',
          dimensionKey: 'dimension:SELF:EMPLOYEE:0',
          itemKey: 'item:SELF:EMPLOYEE:0:0',
          rawLevel: 'A'
        }
      ]
    })
  })

  it('已生效状态下保存草稿后徽标变为待重新提交', async () => {
    const user = userEvent.setup()

    mockedGetContext.mockResolvedValue(
      baseContext({
        state: 'EFFECTIVE',
        submitted: {
          id: 100,
          cycleId: 1,
          participantId: 7,
          stage: 'SELF',
          reviewerOpenId: 'ou_me',
          status: 'SUBMITTED',
          submittedAt: '2026-08-02T01:00:00.000Z',
          items: [ratingItemResult('item:SELF:EMPLOYEE:0:0', 'A')]
        }
      })
    )
    mockedSaveDraft.mockResolvedValue({} as never)

    render(<SelfReview />)
    await screen.findByText('2026 上半年绩效评定')

    // 徽标文案与提交时间拼在同一节点内，用正则匹配前缀即可
    expect(screen.getByText(/^已生效/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    // 「待重新提交」同时出现在状态徽标（span）与提示卡片标题（div）中，用 selector 限定只取徽标
    expect(await screen.findByText('待重新提交', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('已生效版本仍参与计算，完整重新提交后才会替换')).toBeInTheDocument()
  })
})

describe('SelfReview 提交', () => {
  it('缺必填项时前端拦截提交，不发起请求，且展示错误提示', async () => {
    const user = userEvent.setup()

    mockedGetContext.mockResolvedValue(baseContext())

    render(<SelfReview />)
    await screen.findByText('2026 上半年绩效评定')

    await user.click(screen.getByRole('button', { name: '提交自评' }))

    expect(mockedSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('「自评等级」为必填项，请选择评级')).toBeInTheDocument()
  })

  it('必填项齐全时提交成功，并刷新为已生效状态', async () => {
    const user = userEvent.setup()

    mockedGetContext.mockResolvedValueOnce(baseContext())
    mockedSubmit.mockResolvedValue({ ok: true })
    mockedGetContext.mockResolvedValueOnce(
      baseContext({
        state: 'EFFECTIVE',
        submitted: {
          id: 100,
          cycleId: 1,
          participantId: 7,
          stage: 'SELF',
          reviewerOpenId: 'ou_me',
          status: 'SUBMITTED',
          submittedAt: '2026-08-03T01:00:00.000Z',
          items: [ratingItemResult('item:SELF:EMPLOYEE:0:0', 'B')]
        }
      })
    )

    render(<SelfReview />)
    await screen.findByText('2026 上半年绩效评定')

    await user.click(screen.getByRole('radio', { name: 'B · 良好' }))
    await user.click(screen.getByRole('button', { name: '提交自评' }))

    expect(mockedSubmit).toHaveBeenCalledWith({
      cycleId: 1,
      items: [
        {
          subformKey: 'subform:SELF',
          dimensionKey: 'dimension:SELF:EMPLOYEE:0',
          itemKey: 'item:SELF:EMPLOYEE:0:0',
          rawLevel: 'B'
        }
      ]
    })
    expect(await screen.findByText(/^已生效/)).toBeInTheDocument()
    expect(mockedGetContext).toHaveBeenCalledTimes(2)
  })
})

describe('SelfReview 任务未开放', () => {
  it('未到开始时间时不下发表单，展示开放时间提示且无保存/提交按钮', async () => {
    mockedGetContext.mockResolvedValue(
      baseContext({ form: null, task: { id: 21, startAt: '2026-09-01T01:00:00.000Z', openedAt: null } })
    )

    render(<SelfReview />)

    expect(await screen.findByText(/自评将于.*开放，请届时填写/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存草稿' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '提交自评' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })
})

describe('SelfReview 无进行中周期', () => {
  it('participant 为空时提示当前没有进行中的考核周期', async () => {
    mockedGetContext.mockResolvedValue(baseContext({ participant: null, task: null, form: null, state: null }))

    render(<SelfReview />)

    expect(await screen.findByText('当前没有进行中的考核周期')).toBeInTheDocument()
  })
})

describe('SelfReview 加载失败', () => {
  it('展示错误信息与重试入口，点击重试重新拉取', async () => {
    const user = userEvent.setup()

    mockedGetContext.mockRejectedValueOnce(new Error('网络错误，请稍后重试'))
    mockedGetContext.mockResolvedValueOnce(baseContext())

    render(<SelfReview />)

    expect(await screen.findByText('网络错误，请稍后重试')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByText('2026 上半年绩效评定')).toBeInTheDocument()
  })
})
