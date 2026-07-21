import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiFetch } from '@/lib/api'

import Results from './index'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const apiFetchMock = vi.mocked(apiFetch)

const currentResult = (status: 'RESULT_PUBLISHED' | 'APPEALING' | 'RE_CONFIRMING' | 'CONFIRMED') => ({
  participant: {
    id: 7,
    status,
    cycle: { id: 3, name: '2026 年中绩效评定' }
  },
  result: {
    id: 41,
    version: 1,
    finalLevel: 'A',
    previousFinalLevel: null,
    employeeExplanation: '表现优秀',
    resultSnapshot: {
      manager: { compositeScore: '90', level: 'A', dimensions: [], fields: [] },
      self: { level: 'A', fields: [] },
      promotion: null
    },
    publishedAt: '2026-07-21T08:00:00.000Z',
    confirmedAt: null
  },
  appeals: []
})

describe('Results 结果确认与申诉', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockCurrent = (
    status: 'RESULT_PUBLISHED' | 'APPEALING' | 'RE_CONFIRMING' | 'CONFIRMED',
    interviews: unknown[] = []
  ) => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/results/current') return Promise.resolve(currentResult(status))
      if (path === '/interviews/mine') return Promise.resolve({ items: interviews, total: interviews.length })
      if (path === '/appeals') return Promise.resolve({})

      throw new Error(`未预期的接口：${path}`)
    })
  }

  it('发起申诉时精确绑定当前参与者和结果版本', async () => {
    const user = userEvent.setup()

    mockCurrent('RESULT_PUBLISHED')

    render(<Results />)

    await user.click(await screen.findByRole('button', { name: '发起申诉' }))
    await user.type(screen.getByPlaceholderText('请填写申诉理由（必填）…'), '结果与实际贡献不符')
    await user.click(screen.getByRole('button', { name: '提交申诉' }))

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/appeals', {
        method: 'POST',
        body: JSON.stringify({
          participantId: 7,
          resultVersionId: 41,
          reason: '结果与实际贡献不符'
        })
      })
    )
  })

  it('申诉处理后的再次确认阶段不再提供二次申诉入口', async () => {
    mockCurrent('RE_CONFIRMING')

    render(<Results />)

    expect(await screen.findByRole('button', { name: '确认结果' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '发起申诉' })).not.toBeInTheDocument()
    expect(screen.queryByText(/若对结果有异议/)).not.toBeInTheDocument()
    expect(screen.getByText(/申诉处理后请确认复核结果/)).toBeInTheDocument()
  })

  it('申诉处理中展示等待提示而不是已确认状态', async () => {
    mockCurrent('APPEALING')

    render(<Results />)

    expect(await screen.findByText('申诉处理中')).toBeInTheDocument()
    expect(screen.getByText(/申诉正在处理中/)).toBeInTheDocument()
    expect(screen.queryByText('结果已确认')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认结果' })).not.toBeInTheDocument()
  })

  it('结果已确认后不再提示确认复核结果', async () => {
    mockCurrent('CONFIRMED')

    render(<Results />)

    expect(await screen.findByText('结果已确认')).toBeInTheDocument()
    expect(screen.getByText(/本周期结果已确认，已进入面谈闭环/)).toBeInTheDocument()
    expect(screen.queryByText(/请确认复核结果/)).not.toBeInTheDocument()
  })

  it('只读展示本人面谈预约与飞书日程入口，不展示纪要', async () => {
    mockCurrent('CONFIRMED', [
      {
        id: 11,
        status: 'SCHEDULED',
        scheduledStartAt: '2026-07-22T10:00:00.000Z',
        scheduledEndAt: '2026-07-22T11:00:00.000Z',
        calendarId: 'primary',
        calendarEventId: 'evt_1',
        participant: { cycle: { id: 3, name: '2026 年中绩效评定' } },
        resultNotes: '不应出现在页面上'
      }
    ])

    render(<Results />)

    expect(await screen.findByText('我的面谈预约')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '打开飞书日程' })).toBeInTheDocument()
    expect(screen.queryByText('不应出现在页面上')).not.toBeInTheDocument()
  })
})
