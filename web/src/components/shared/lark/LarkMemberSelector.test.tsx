import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { acquireLarkSelector } from '@/lib/lark-web-component'

import LarkMemberSelector from './LarkMemberSelector'

vi.mock('@/lib/lark-web-component', () => ({ acquireLarkSelector: vi.fn() }))
vi.mock('./use-lark-component-mount', () => ({ useLarkThemeSync: vi.fn() }))

const acquireLarkSelectorMock = vi.mocked(acquireLarkSelector)
let resizeCallback: ResizeObserverCallback

describe('LarkMemberSelector', () => {
  beforeEach(() => {
    acquireLarkSelectorMock.mockReset()
    acquireLarkSelectorMock.mockReturnValue({ ready: Promise.resolve(), release: vi.fn() })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback
        }

        observe = vi.fn()
        unobserve = vi.fn()
        disconnect = vi.fn()
      }
    )

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 624,
      height: 36,
      top: 0,
      right: 624,
      bottom: 36,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => undefined
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('流式模式下搜索框与结果面板都使用容器宽度', async () => {
    render(<LarkMemberSelector fluid onSelect={vi.fn()} />)

    await waitFor(() => {
      expect(acquireLarkSelectorMock).toHaveBeenCalledWith(
        expect.objectContaining({ triggerWidth: 624, panelWidth: 624 }),
        expect.any(Function),
        expect.any(HTMLElement)
      )
    })
  })

  it('容器尺寸变化后同步更新搜索框与结果面板宽度', async () => {
    render(<LarkMemberSelector fluid onSelect={vi.fn()} />)

    await waitFor(() => expect(acquireLarkSelectorMock).toHaveBeenCalledTimes(1))

    act(() => {
      resizeCallback([{ contentRect: { width: 480 } } as ResizeObserverEntry], {} as ResizeObserver)
    })

    await waitFor(() => {
      expect(acquireLarkSelectorMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ triggerWidth: 480, panelWidth: 480 }),
        expect.any(Function),
        expect.any(HTMLElement)
      )
    })
  })
})
