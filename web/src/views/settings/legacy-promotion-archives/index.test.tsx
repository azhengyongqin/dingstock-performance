import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LegacyPromotionArchives from './index'

const apiFetchMock = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  apiFetch: (...args: unknown[]) => apiFetchMock(...args)
}))

vi.mock('@/components/shared/lark', () => ({
  UserAvatar: ({ name }: { name?: string }) => <span aria-label={`${name ?? '成员'}头像`} />
}))

describe('旧晋升答案归档', () => {
  beforeEach(() => apiFetchMock.mockReset())

  it('用 DataTable 展示安全投影，并在详情中结构化呈现旧答案', async () => {
    apiFetchMock.mockResolvedValue({
      items: [
        {
          id: 8,
          cycle: { id: 2, name: '2025 下半年绩效' },
          participant: {
            id: 3,
            employee: { openId: 'ou_employee', name: '张三', avatarUrl: null }
          },
          source: {
            type: 'EVALUATION_ITEM_RESULT',
            recordId: 99,
            createdAt: '2025-12-01T00:00:00.000Z'
          },
          payload: {
            kind: 'EVALUATION_ANSWER',
            stage: 'SELF',
            status: 'SUBMITTED',
            submittedAt: '2025-12-02T00:00:00.000Z',
            dimensionKey: 'promotion-reason',
            fieldKey: 'promotion-statement',
            fieldType: 'LONG_TEXT',
            rating: null,
            score: null,
            calculationScore: null,
            entries: [{ kind: 'TEXT', label: '作答内容', content: '我希望承担更大的职责' }]
          },
          archivedAt: '2026-07-20T00:00:00.000Z'
        }
      ],
      total: 1,
      page: 1,
      pageSize: 20
    })

    render(<LegacyPromotionArchives />)

    expect(await screen.findByText('2025 下半年绩效')).toBeInTheDocument()
    expect(screen.getByText('张三')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看归档内容' }))
    expect(within(screen.getByRole('dialog')).getByText('我希望承担更大的职责')).toBeInTheDocument()
    expect(screen.queryByText(/\{"/)).not.toBeInTheDocument()
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/legacy-promotion-archives?page=1&page_size=20'))
  })
})
