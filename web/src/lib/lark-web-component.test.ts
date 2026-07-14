/**
 * Selector 实例池回归测试。
 *
 * 背景：飞书 h5-js-sdk 每次 webComponent.render 都会向其内部事件总线新增监听，
 * 且 unmount 不清理；组件反复挂载（条件渲染 / 步骤切换 / 页面软导航）会累计监听，
 * 触发 “possible EventEmitter memory leak detected” 控制台告警。
 * 因此约束：相同 render 属性的反复挂载/卸载必须复用同一实例（render 只调用一次）。
 */
import { describe, expect, it, vi } from 'vitest'

import type { LarkSelectorOption } from '@/components/shared/lark'

vi.mock('./api', () => ({
  apiFetch: vi.fn().mockResolvedValue({
    appId: 'cli_test',
    signature: 'sig',
    nonceStr: 'nonce',
    timestamp: 1,
    openId: 'ou_test'
  })
}))

/** 每个用例独立加载模块（模块级单例状态不串场），并注入 mock SDK */
const loadModule = async () => {
  vi.resetModules()

  const render = vi.fn<
    (name: string, props: Record<string, unknown>, container: Element) => { unmount: () => void }
  >(() => ({ unmount: vi.fn() }))

  const sdk = {
    config: vi.fn().mockResolvedValue(undefined),
    update: vi.fn(),
    render
  }

  window.webComponent = sdk as unknown as typeof window.webComponent

  const mod = await import('./lark-web-component')

  return { mod, render }
}

const RENDER_PROPS = { searchEntityTypes: [1], placeholder: '搜索人员', triggerWidth: 240 }

describe('acquireLarkSelector 实例池', () => {
  it('同一 render 属性反复挂载/卸载只调用一次 SDK render（监听不随 remount 累计）', async () => {
    const { mod, render } = await loadModule()
    const mountPoint = document.createElement('div')

    for (let i = 0; i < 12; i++) {
      const { ready, release } = mod.acquireLarkSelector(RENDER_PROPS, () => undefined, mountPoint)

      await ready
      expect(mountPoint.childElementCount).toBe(1)

      release()
      expect(mountPoint.childElementCount).toBe(0)
    }

    expect(render).toHaveBeenCalledTimes(1)
  })

  it('不同 render 属性各自创建实例（互不复用）', async () => {
    const { mod, render } = await loadModule()
    const mountPoint = document.createElement('div')

    const first = mod.acquireLarkSelector(RENDER_PROPS, () => undefined, mountPoint)

    await first.ready
    first.release()

    const second = mod.acquireLarkSelector({ ...RENDER_PROPS, placeholder: '搜索并选择员工' }, () => undefined, mountPoint)

    await second.ready
    second.release()

    expect(render).toHaveBeenCalledTimes(2)
  })

  it('同签名并发挂载不抢占使用中的实例', async () => {
    const { mod, render } = await loadModule()
    const mountA = document.createElement('div')
    const mountB = document.createElement('div')

    const a = mod.acquireLarkSelector(RENDER_PROPS, () => undefined, mountA)
    const b = mod.acquireLarkSelector(RENDER_PROPS, () => undefined, mountB)

    await Promise.all([a.ready, b.ready])

    expect(render).toHaveBeenCalledTimes(2)
    expect(mountA.childElementCount).toBe(1)
    expect(mountB.childElementCount).toBe(1)

    a.release()
    b.release()
  })

  it('onSelect 路由到当前持有者，release 后不再触发旧回调', async () => {
    const { mod, render } = await loadModule()
    const mountPoint = document.createElement('div')

    const firstOnSelect = vi.fn()
    const first = mod.acquireLarkSelector(RENDER_PROPS, firstOnSelect, mountPoint)

    await first.ready

    // SDK 实际收到的 onSelect（实例生命周期内不变，经池条目路由）
    const sdkProps = render.mock.calls[0][1] as { onSelect: (option: LarkSelectorOption) => void }

    sdkProps.onSelect({ id: 'ou_1' })
    expect(firstOnSelect).toHaveBeenCalledWith({ id: 'ou_1' })

    first.release()
    sdkProps.onSelect({ id: 'ou_stale' })
    expect(firstOnSelect).toHaveBeenCalledTimes(1)

    const secondOnSelect = vi.fn()
    const second = mod.acquireLarkSelector(RENDER_PROPS, secondOnSelect, mountPoint)

    await second.ready
    sdkProps.onSelect({ id: 'ou_2' })
    expect(secondOnSelect).toHaveBeenCalledWith({ id: 'ou_2' })
    expect(firstOnSelect).toHaveBeenCalledTimes(1)

    second.release()
  })

  it('render 失败的实例从池中剔除，下次挂载重新创建（保留重试）', async () => {
    const { mod, render } = await loadModule()
    const mountPoint = document.createElement('div')

    render.mockImplementationOnce(() => {
      throw new Error('render 失败')
    })

    const first = mod.acquireLarkSelector(RENDER_PROPS, () => undefined, mountPoint)

    await expect(first.ready).rejects.toThrow('render 失败')
    first.release()

    const second = mod.acquireLarkSelector(RENDER_PROPS, () => undefined, mountPoint)

    await second.ready
    expect(render).toHaveBeenCalledTimes(2)
    expect(mountPoint.childElementCount).toBe(1)

    second.release()
  })
})

describe('ensureLarkWebComponent 主题初始化', () => {
  it('首次鉴权时读取项目已应用的 dark 主题，而不是默认 light', async () => {
    document.documentElement.classList.add('dark')

    try {
      const { mod } = await loadModule()

      await mod.ensureLarkWebComponent()

      expect(window.webComponent?.config).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }))
    } finally {
      document.documentElement.classList.remove('dark')
    }
  })

  it('鉴权期间切换主题时，鉴权完成后会立即补同步', async () => {
    vi.resetModules()

    let finishConfig: (() => void) | undefined

    const sdk = {
      config: vi.fn(
        () =>
          new Promise<void>(resolve => {
            finishConfig = resolve
          })
      ),
      update: vi.fn(),
      render: vi.fn()
    }

    window.webComponent = sdk as unknown as typeof window.webComponent
    const mod = await import('./lark-web-component')
    const configuring = mod.ensureLarkWebComponent()

    await vi.waitFor(() => expect(sdk.config).toHaveBeenCalledTimes(1))
    mod.setLarkWebComponentTheme('dark')
    finishConfig?.()
    await configuring

    expect(sdk.update).toHaveBeenCalledWith({ theme: 'dark' })
  })

  it('SDK 脚本加载后未注入 webComponent 时，下次调用应重新加载', async () => {
    vi.resetModules()
    delete window.webComponent

    const appendedScripts: HTMLScriptElement[] = []

    const appendChild = vi.spyOn(document.body, 'appendChild').mockImplementation(node => {
      appendedScripts.push(node as HTMLScriptElement)

      return node
    })

    try {
      const mod = await import('./lark-web-component')
      const first = mod.ensureLarkWebComponent()

      appendedScripts[0].onload?.(new Event('load'))
      await expect(first).rejects.toThrow('未注入 webComponent')

      const second = mod.ensureLarkWebComponent()

      expect(appendedScripts).toHaveLength(2)

      window.webComponent = {
        config: vi.fn().mockResolvedValue(undefined),
        update: vi.fn(),
        render: vi.fn()
      } as unknown as typeof window.webComponent
      appendedScripts[1].onload?.(new Event('load'))
      await second
    } finally {
      appendChild.mockRestore()
    }
  })
})

describe('acquireLarkProfileCard 异步生命周期', () => {
  it('弹层在鉴权完成前关闭时，不应在已关闭容器中迟到挂载名片', async () => {
    const { mod, render } = await loadModule()
    const mountPoint = document.createElement('div')
    const acquiring = mod.acquireLarkProfileCard('ou_slow', mountPoint)

    // 模拟用户在排队的 SDK 初始化任务执行前立即关闭 Popover。
    mod.releaseLarkProfileCard(mountPoint)
    await acquiring

    expect(render).not.toHaveBeenCalled()
    expect(mountPoint.childElementCount).toBe(0)
  })
})
