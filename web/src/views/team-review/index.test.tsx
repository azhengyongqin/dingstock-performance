import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TeamReview from './index'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))

vi.mock('@/lib/api', () => ({ apiFetch }))
vi.mock('@/components/shared/lark', () => ({
  UserAvatar: ({ name }: { name?: string }) => <span aria-label={`${name ?? '成员'}头像`} />
}))

const row = (
  participantId: number,
  name: string,
  managerEvaluationState: 'NOT_STARTED' | 'DRAFT' | 'EFFECTIVE' | 'PENDING_RESUBMIT',
  managerSubmissionStatus: 'SUBMITTED' | null
) => ({
  participantId,
  employee: { open_id: `ou_${participantId}`, name, avatar: null, job_title: '工程师' },
  status: 'ACTIVE',
  selfSubmissionStatus: null,
  reviewProgress: { submitted: 0, total: 0 },
  managerEvaluationState,
  managerSubmissionStatus,
  managerInitialLevel: null,
  finalLevel: null
})

describe('团队看板上级评估快捷入口', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiFetch.mockResolvedValue({
      cycle: { id: 9, name: '2026 上半年绩效', status: 'ACTIVE' },
      items: [
        row(1, '成员一', 'NOT_STARTED', null),
        row(2, '成员二', 'DRAFT', null),
        row(3, '成员三', 'EFFECTIVE', 'SUBMITTED'),
        row(4, '成员四', 'PENDING_RESUBMIT', 'SUBMITTED')
      ],
      total: 4
    })
  })

  it('按评估状态显示入口文案，并允许从成员姓名和按钮进入现有上级评估页', async () => {
    render(<TeamReview />)

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/dashboard/team'))

    const expectedHref = (participantId: number) =>
      `/review-tasks/fill?participant_id=${participantId}&type=MANAGER_REVIEW&from=team-review`

    expect(await screen.findByRole('link', { name: '成员一' })).toHaveAttribute('href', expectedHref(1))
    expect(screen.getByRole('button', { name: '去评估' })).toHaveAttribute('href', expectedHref(1))
    expect(screen.getAllByRole('button', { name: '继续评估' })[0]).toHaveAttribute('href', expectedHref(2))
    expect(screen.getByRole('button', { name: '查看评估' })).toHaveAttribute('href', expectedHref(3))
    expect(screen.getAllByRole('button', { name: '继续评估' })[1]).toHaveAttribute('href', expectedHref(4))
    expect(screen.getByText('待重新提交')).toBeInTheDocument()
    expect(screen.getByText('2 / 4')).toBeInTheDocument()
  })
})
