import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Login from './index'

vi.mock('./dev-quick-login', () => ({
  default: () => <div>开发快速登录探测器</div>
}))

describe('登录页开发快速登录入口', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('生产构建也挂载探测器，由后端开关决定是否显示入口', () => {
    vi.stubEnv('NODE_ENV', 'production')

    render(<Login />)

    expect(screen.getByText('开发快速登录探测器')).toBeInTheDocument()
  })
})
