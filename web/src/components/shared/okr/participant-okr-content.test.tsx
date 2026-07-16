import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as PerfApi from '@/lib/perf-api'
import type { ParticipantOkrSnapshot } from '@/lib/perf-api'

import { OkrReferenceContent, ParticipantOkrContent } from './participant-okr-content'

const { getParticipantOkr, triggerParticipantOkrSync } = vi.hoisted(() => ({
  getParticipantOkr: vi.fn(),
  triggerParticipantOkrSync: vi.fn()
}))

vi.mock('@/lib/perf-api', async importOriginal => {
  const actual = await importOriginal<typeof PerfApi>()

  return { ...actual, getParticipantOkr, triggerParticipantOkrSync }
})

const snapshot = (overrides: Partial<ParticipantOkrSnapshot> = {}): ParticipantOkrSnapshot => ({
  participantId: 7,
  employeeOpenId: 'ou_employee',
  lastSyncedAt: '2026-07-16T10:00:00.000Z',
  sync: { status: 'success' },
  cycles: [
    {
      id: 'cycle-1',
      tenantCycleId: 'tenant-cycle-1',
      startTime: '1767225600000',
      endTime: '1782777600000',
      status: 1,
      score: null,
      objectives: [
        {
          id: 'objective-1',
          position: 1,
          content: {
            blocks: [
              {
                block_element_type: 'paragraph',
                paragraph: { elements: [{ paragraph_element_type: 'textRun', text_run: { text: '提升客户成功率' } }] }
              }
            ]
          },
          notes: null,
          score: null,
          weight: 60,
          deadline: null,
          category: { id: 'category-1', name: { zh: '业务目标' }, color: 'blue' },
          indicator: null,
          latestProgress: {
            id: 'progress-1',
            content: null,
            progressPercent: 72,
            status: 1,
            createTime: '1000',
            updateTime: '1001'
          },
          keyResults: [
            {
              id: 'kr-1',
              position: 1,
              content: {
                blocks: [
                  {
                    block_element_type: 'paragraph',
                    paragraph: {
                      elements: [
                        { paragraph_element_type: 'textRun', text_run: { text: '完成重点客户健康度看板' } },
                        { paragraph_element_type: 'mention', mention: { user_id: 'ou_partner' } }
                      ]
                    }
                  }
                ]
              },
              score: null,
              weight: 100,
              deadline: null,
              indicator: null,
              latestProgress: null
            }
          ]
        }
      ]
    }
  ],
  ...overrides
})

describe('OkrReferenceContent 状态展示', () => {
  it('有缓存且正在刷新时立即展示旧数据与更新状态', () => {
    render(<OkrReferenceContent data={snapshot({ sync: { status: 'running' } })} />)

    expect(screen.getByText('提升客户成功率')).toBeInTheDocument()
    expect(screen.getByText(/完成重点客户健康度看板/)).toBeInTheDocument()
    expect(screen.getByText('正在更新')).toBeInTheDocument()
    expect(screen.getByText('72%')).toBeInTheDocument()
  })

  it('同步成功但没有任何目标时展示空状态', () => {
    render(<OkrReferenceContent data={snapshot({ cycles: [], sync: { status: 'success' } })} />)

    expect(screen.getByText('暂无 OKR')).toBeInTheDocument()
    expect(screen.getByText('已完成飞书同步，该员工当前没有可展示的 OKR')).toBeInTheDocument()
  })

  it('数据库无 OKR 且后台仍在同步时持续展示骨架，不提前显示空状态', () => {
    render(<OkrReferenceContent data={snapshot({ cycles: [], sync: { status: 'running' } })} />)

    expect(screen.getByLabelText('正在加载 OKR')).toBeInTheDocument()
    expect(screen.queryByText('暂无 OKR')).not.toBeInTheDocument()
  })

  it('无缓存轮询失败时错误状态优先于旧的 running 状态', () => {
    render(
      <OkrReferenceContent
        data={snapshot({ cycles: [], sync: { status: 'running' } })}
        error='同步状态查询失败'
        onRetry={vi.fn()}
      />
    )

    expect(screen.getByText('OKR 加载失败')).toBeInTheDocument()
    expect(screen.getByText('同步状态查询失败')).toBeInTheDocument()
    expect(screen.queryByLabelText('正在加载 OKR')).not.toBeInTheDocument()
  })

  it('无缓存且同步失败时展示错误状态并允许重试', () => {
    const onRetry = vi.fn()

    render(
      <OkrReferenceContent
        data={snapshot({ cycles: [], sync: { status: 'failed', error: '飞书权限不足' } })}
        onRetry={onRetry}
      />
    )
    expect(screen.getByText('OKR 加载失败')).toBeInTheDocument()
    expect(screen.getByText('飞书权限不足')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新同步' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('已有缓存但最新同步失败时保留 OKR，并展示非阻断错误提示', () => {
    render(
      <OkrReferenceContent
        data={snapshot({ sync: { status: 'failed', error: '飞书接口暂时不可用' } })}
        onRetry={vi.fn()}
      />
    )

    expect(screen.getByText('提升客户成功率')).toBeInTheDocument()
    expect(screen.getByText('最新同步失败，当前展示上一次缓存')).toBeInTheDocument()
    expect(screen.getByText('飞书接口暂时不可用')).toBeInTheDocument()
  })
})

describe('ParticipantOkrContent 缓存直出与异步刷新', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('先展示数据库缓存，触发单人同步，并在任务完成后替换为最新数据', async () => {
    vi.useFakeTimers()
    getParticipantOkr
      .mockResolvedValueOnce(snapshot({ sync: { status: 'idle' } }))
      .mockResolvedValueOnce(
        snapshot({
          sync: { status: 'success' },
          cycles: [
            {
              ...snapshot().cycles[0],
              objectives: [
                {
                  ...snapshot().cycles[0].objectives[0],
                  content: {
                    blocks: [
                      {
                        block_element_type: 'paragraph',
                        paragraph: {
                          elements: [{ paragraph_element_type: 'textRun', text_run: { text: '同步后的最新目标' } }]
                        }
                      }
                    ]
                  }
                }
              ]
            }
          ]
        })
      )
    triggerParticipantOkrSync.mockResolvedValue({ ok: true, status: 'running' })

    render(<ParticipantOkrContent participantId={7} />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText('提升客户成功率')).toBeInTheDocument()
    expect(triggerParticipantOkrSync).toHaveBeenCalledWith(7)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(screen.getByText('同步后的最新目标')).toBeInTheDocument()
    expect(getParticipantOkr).toHaveBeenCalledTimes(2)
  })
})
