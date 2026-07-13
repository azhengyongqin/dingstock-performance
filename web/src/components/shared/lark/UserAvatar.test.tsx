import type { ComponentProps, PropsWithChildren } from 'react'

import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiFetch } from '@/lib/api'

import UserAvatar from './UserAvatar'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))

// 头像加载行为由 Base UI 自身负责；这里保留 UserAvatar 的数据获取与渲染边界。
vi.mock('@/components/ui/avatar', () => ({
  Avatar: ({ children }: PropsWithChildren) => <div>{children}</div>,
  AvatarImage: ({ src, alt }: ComponentProps<'img'>) => <img src={src} alt={alt ?? ''} />,
  AvatarFallback: ({ children }: PropsWithChildren) => <span>{children}</span>
}))

const apiFetchMock = vi.mocked(apiFetch)

describe('UserAvatar', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  it('仅提供 openId 时从通讯录补齐稳定头像并渲染图片', async () => {
    apiFetchMock.mockResolvedValue({
      open_id: 'ou_peng',
      name: '彭巧丽',
      avatar: { avatar_240: 'https://example.com/peng.png' }
    })

    render(<UserAvatar openId='ou_peng' name='彭巧丽' withProfileCard={false} />)

    await waitFor(() => {
      expect(screen.getByRole('img', { name: '彭巧丽' })).toHaveAttribute('src', 'https://example.com/peng.png')
    })
    expect(apiFetchMock).toHaveBeenCalledWith('/contact/users/ou_peng')
  })

  it('同一组件切换 openId 时不会沿用上一人的头像', async () => {
    let resolveSecond: (value: unknown) => void = () => undefined

    apiFetchMock
      .mockResolvedValueOnce({
        open_id: 'ou_first',
        name: '第一人',
        avatar: { avatar_240: 'https://example.com/ou_first.png' }
      })
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveSecond = resolve
          })
      )

    const { rerender } = render(<UserAvatar openId='ou_first' name='第一人' withProfileCard={false} />)

    await screen.findByRole('img', { name: '第一人' })
    rerender(<UserAvatar openId='ou_second' name='第二人' withProfileCard={false} />)

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/contact/users/ou_second'))
    expect(screen.queryByRole('img', { name: '第二人' })).not.toBeInTheDocument()

    resolveSecond({
      open_id: 'ou_second',
      name: '第二人',
      avatar: { avatar_240: 'https://example.com/ou_second.png' }
    })

    await waitFor(() => {
      expect(screen.getByRole('img', { name: '第二人' })).toHaveAttribute(
        'src',
        'https://example.com/ou_second.png'
      )
    })
  })
})
