import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DevQuickLogin from './dev-quick-login'

const apiMocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(public status: number) {
      super(`HTTP ${status}`)
    }
  }

  return {
    ApiError,
    devLogin: vi.fn(),
    fetchDevLoginUsers: vi.fn(),
    saveAuth: vi.fn()
  }
})

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }))
vi.mock('@/lib/api', () => apiMocks)

describe('开发快速登录后端开关', () => {
  beforeEach(() => vi.clearAllMocks())

  it('后端开启并返回员工时显示入口', async () => {
    apiMocks.fetchDevLoginUsers.mockResolvedValue({
      items: [
        {
          open_id: 'ou_test',
          name: '测试员工',
          roles: [],
          is_leader: false,
          is_tenant_manager: false
        }
      ],
      total: 1
    })

    render(<DevQuickLogin />)

    expect(await screen.findByText('快速选择员工登录')).toBeInTheDocument()
    expect(screen.getByText('测试员工')).toBeInTheDocument()
  })

  it('后端返回 404 时完全隐藏入口', async () => {
    apiMocks.fetchDevLoginUsers.mockRejectedValue(new apiMocks.ApiError(404))

    render(<DevQuickLogin />)

    await waitFor(() => expect(apiMocks.fetchDevLoginUsers).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByText('快速选择员工登录')).not.toBeInTheDocument())
  })
})
