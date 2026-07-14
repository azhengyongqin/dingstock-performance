import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { acquireLarkSelector } from '@/lib/lark-web-component'

import LarkMemberSelector from './LarkMemberSelector'

vi.mock('@/lib/lark-web-component', () => ({ acquireLarkSelector: vi.fn() }))
vi.mock('./use-lark-component-mount', () => ({ useLarkThemeSync: vi.fn() }))

const acquireLarkSelectorMock = vi.mocked(acquireLarkSelector)
let resizeCallbacks: ResizeObserverCallback[]

describe('LarkMemberSelector', () => {
  beforeEach(() => {
    const storage = new Map<string, string>()

    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      get length() {
        return storage.size
      }
    })
    acquireLarkSelectorMock.mockReset()
    acquireLarkSelectorMock.mockReturnValue({ ready: Promise.resolve(), release: vi.fn() })
    resizeCallbacks = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallbacks.push(callback)
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
    document.querySelectorAll('.larkw-selector-container__dropdown').forEach(node => node.remove())
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('流式模式下搜索框与结果面板都使用容器宽度', async () => {
    render(<LarkMemberSelector fluid onSelect={vi.fn()} />)

    await waitFor(() => {
      expect(acquireLarkSelectorMock).toHaveBeenCalledWith(
        expect.objectContaining({ triggerWidth: 624, panelWidth: 624 }),
        expect.any(Function),
        expect.any(HTMLElement),
        expect.any(String)
      )
    })
  })

  it('容器尺寸变化后原地更新已展开的结果面板宽度', async () => {
    const dropdown = document.createElement('div')

    dropdown.className = 'larkw-selector-container__dropdown'
    document.body.appendChild(dropdown)
    render(<LarkMemberSelector fluid onSelect={vi.fn()} />)

    await waitFor(() => expect(acquireLarkSelectorMock).toHaveBeenCalledTimes(1))

    act(() => {
      resizeCallbacks[0]([{ contentRect: { width: 480 } } as ResizeObserverEntry], {} as ResizeObserver)
    })

    await waitFor(() => {
      expect(dropdown).toHaveStyle({ width: '480px', minWidth: '480px' })
    })
    expect(acquireLarkSelectorMock).toHaveBeenCalledTimes(1)
  })

  it('缩放时面板未展开，之后打开仍使用最新宽度', async () => {
    const dropdown = document.createElement('div')

    dropdown.className = 'larkw-selector-container__dropdown'
    dropdown.style.display = 'none'
    document.body.appendChild(dropdown)
    render(<LarkMemberSelector fluid onSelect={vi.fn()} />)

    await waitFor(() => expect(acquireLarkSelectorMock).toHaveBeenCalledTimes(1))

    act(() => {
      resizeCallbacks[0]([{ contentRect: { width: 480 } } as ResizeObserverEntry], {} as ResizeObserver)
    })

    await new Promise(resolve => setTimeout(resolve, 120))
    expect(dropdown).not.toHaveStyle({ width: '480px' })

    dropdown.style.display = 'block'

    await waitFor(() => {
      expect(dropdown).toHaveStyle({ width: '480px', minWidth: '480px' })
    })
  })

  it('多个搜索框同时存在时，只更新与当前触发器相邻的面板', async () => {
    const firstDropdown = document.createElement('div')
    const secondDropdown = document.createElement('div')

    firstDropdown.className = 'larkw-selector-container__dropdown first-dropdown'
    secondDropdown.className = 'larkw-selector-container__dropdown second-dropdown'
    document.body.append(firstDropdown, secondDropdown)

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('first-selector')) {
        return { width: 400, height: 36, top: 0, right: 400, bottom: 36, left: 0, x: 0, y: 0, toJSON: () => undefined }
      }

      if (this.classList.contains('second-selector')) {
        return { width: 400, height: 36, top: 200, right: 400, bottom: 236, left: 0, x: 0, y: 200, toJSON: () => undefined }
      }

      if (this.classList.contains('first-dropdown')) {
        return { width: 400, height: 100, top: 36, right: 400, bottom: 136, left: 0, x: 0, y: 36, toJSON: () => undefined }
      }

      return { width: 400, height: 100, top: 236, right: 400, bottom: 336, left: 0, x: 0, y: 236, toJSON: () => undefined }
    })

    render(
      <>
        <LarkMemberSelector fluid className='first-selector' onSelect={vi.fn()} />
        <LarkMemberSelector fluid className='second-selector' onSelect={vi.fn()} />
      </>
    )

    await waitFor(() => expect(acquireLarkSelectorMock).toHaveBeenCalledTimes(2))

    act(() => {
      resizeCallbacks[1]([{ contentRect: { width: 300 } } as ResizeObserverEntry], {} as ResizeObserver)
    })

    await waitFor(() => expect(secondDropdown).toHaveStyle({ width: '300px', minWidth: '300px' }))
    expect(firstDropdown).not.toHaveStyle({ width: '300px' })
  })

  it('先排除单轴距离越界的面板，再从合法候选中选择最近项', async () => {
    const invalidDropdown = document.createElement('div')
    const validDropdown = document.createElement('div')

    invalidDropdown.className = 'larkw-selector-container__dropdown invalid-dropdown'
    validDropdown.className = 'larkw-selector-container__dropdown valid-dropdown'
    document.body.append(invalidDropdown, validDropdown)

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('edge-selector')) {
        return { width: 400, height: 36, top: 0, right: 400, bottom: 36, left: 0, x: 0, y: 0, toJSON: () => undefined }
      }

      if (this.classList.contains('invalid-dropdown')) {
        return { width: 400, height: 100, top: 76, right: 400, bottom: 176, left: 0, x: 0, y: 76, toJSON: () => undefined }
      }

      return { width: 400, height: 100, top: 36, right: 450, bottom: 136, left: 50, x: 50, y: 36, toJSON: () => undefined }
    })

    render(<LarkMemberSelector fluid className='edge-selector' onSelect={vi.fn()} />)
    await waitFor(() => expect(acquireLarkSelectorMock).toHaveBeenCalledTimes(1))

    act(() => {
      resizeCallbacks[0]([{ contentRect: { width: 300 } } as ResizeObserverEntry], {} as ResizeObserver)
    })

    await waitFor(() => expect(validDropdown).toHaveStyle({ width: '300px', minWidth: '300px' }))
    expect(invalidDropdown).not.toHaveStyle({ width: '300px' })
  })

  it('使用 optionConfig 展示邮箱和部门，并把最近选择传给 recommendList', async () => {
    const recentOptions = [
      {
        id: 'ou_recent',
        title: '最近成员',
        type: 'user',
        entity: { id: 'ou_recent', name: '最近成员', mail: 'recent@example.com', department: '研发部' }
      }
    ]

    window.localStorage.setItem('dingstock_lark_member_selector_recent_v1', JSON.stringify(recentOptions))
    render(<LarkMemberSelector onSelect={vi.fn()} />)

    await waitFor(() => {
      expect(acquireLarkSelectorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          optionConfig: {
            chatter: { subtitleType: 1, descriptionType: 1, hasTag: true }
          },
          recommendList: recentOptions
        }),
        expect.any(Function),
        expect.any(HTMLElement),
        expect.any(String)
      )
    })
  })

  it('选中人员后最新置顶、按 id 去重并只保留 10 条', async () => {
    render(<LarkMemberSelector onSelect={vi.fn()} />)
    await waitFor(() => expect(acquireLarkSelectorMock).toHaveBeenCalledTimes(1))

    const handleSelect = acquireLarkSelectorMock.mock.calls[0][1]

    act(() => {
      Array.from({ length: 12 }, (_, index) => ({
        id: `ou_${index}`,
        title: `成员 ${index}`,
        type: 'user',
        entity: { id: `ou_${index}`, name: `成员 ${index}` }
      })).forEach(handleSelect)
      handleSelect({ id: 'ou_5', title: '成员 5', type: 'user', entity: { id: 'ou_5', name: '成员 5' } })
    })

    const stored = JSON.parse(window.localStorage.getItem('dingstock_lark_member_selector_recent_v1') ?? '[]')

    expect(stored).toHaveLength(10)
    expect(stored.map((option: { id: string }) => option.id)).toEqual([
      'ou_5',
      'ou_11',
      'ou_10',
      'ou_9',
      'ou_8',
      'ou_7',
      'ou_6',
      'ou_4',
      'ou_3',
      'ou_2'
    ])
  })

  it('重新挂载及选中人员后保留上次输入的搜索词', async () => {
    let input: HTMLInputElement | null = null

    window.localStorage.setItem('dingstock_lark_member_selector_query_v1', 'GT')
    acquireLarkSelectorMock.mockImplementation((_props, _onSelect, mountPoint) => {
      input = document.createElement('input')
      mountPoint.appendChild(input)

      return { ready: Promise.resolve(), release: vi.fn() }
    })

    render(<LarkMemberSelector onSelect={vi.fn()} />)

    await waitFor(() => expect(input).toHaveValue('GT'))
    fireEvent.input(input as HTMLInputElement, { target: { value: '赵俊' } })
    expect(window.localStorage.getItem('dingstock_lark_member_selector_query_v1')).toBe('赵俊')

    const handleSelect = acquireLarkSelectorMock.mock.calls[0][1]

    act(() => {
      handleSelect({ id: 'ou_zhao', title: '赵俊', type: 'user', entity: { id: 'ou_zhao', name: '赵俊' } })
      ;(input as HTMLInputElement).value = ''
    })

    await waitFor(() => expect(input).toHaveValue('赵俊'))
  })
})
