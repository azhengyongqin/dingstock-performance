/**
 * 飞书网页组件（Web Components）接入基建。
 *
 * 覆盖三件事：
 * 1. 按需注入官方 h5-js-sdk（只在真正用到飞书组件的页面加载，登录页等不受影响）；
 * 2. JSAPI 鉴权：签名从后端 GET /auth/lark/jsapi-signature 获取（jsapi_ticket 由后端缓存），
 *    整个应用只 config 一次，成员名片（UserProfile）与搜索组件（Selector）共用；
 * 3. 主题同步：跟随 next-themes 的浅色/深色切换调用 webComponent.update({ theme })。
 *
 * 官方文档：
 * - 成员名片 https://open.feishu.cn/document/common-capabilities/web-components/profile-component
 * - 搜索组件 https://open.feishu.cn/document/common-capabilities/web-components/selector
 */

import { apiFetch } from './api'

// 官方 CDN 的 h5-js-sdk（网页组件依赖），版本与文档示例保持一致
const SDK_URL = 'https://lf3-cdn-tos.bytegoofy.com/obj/goofy/locl/lark/external_js_sdk/h5-js-sdk-1.2.21.js'

// 一次 config 声明全部会用到的组件能力，避免各组件重复鉴权
const JS_API_LIST = ['user_profile', 'selector']

export type LarkComponentTheme = 'light' | 'dark'

/** webComponent.render 返回的组件实例句柄 */
export type LarkComponentInstance = {
  unmount: () => void
  update?: (props: Record<string, unknown>) => void
}

/** window.webComponent（h5-js-sdk 注入的网页组件运行时） */
type LarkWebComponentSdk = {
  config: (options: Record<string, unknown>) => Promise<unknown>
  update: (options: { theme?: LarkComponentTheme; locale?: string }) => void
  render: (name: string, props: Record<string, unknown>, container: Element) => LarkComponentInstance
  onError?: (callback: (error: unknown) => void) => void
  onAuthError?: (callback: (error: unknown) => void) => void
}

declare global {
  interface Window {
    webComponent?: LarkWebComponentSdk
  }
}

/** 后端签名接口返回结构（backend GET /auth/lark/jsapi-signature） */
type JsapiSignature = {
  appId: string
  signature: string
  nonceStr: string
  timestamp: number
  openId: string
}

// 模块级单例状态：SDK 注入与 config 鉴权都只做一次
let sdkPromise: Promise<LarkWebComponentSdk> | null = null
let configPromise: Promise<LarkWebComponentSdk> | null = null
let configured = false
let currentTheme: LarkComponentTheme = 'light'
let configuredOpenId: string | null = null
let larkStylePatchObserverStarted = false

/**
 * next-themes 会把解析后的主题写到 html 的 class。
 * 首次鉴权直接读取这个已落地的状态，避免等待 React effect 导致 SDK 先以 light 初始化。
 */
const getAppliedProjectTheme = (): LarkComponentTheme => {
  if (typeof document === 'undefined') return currentTheme

  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

const LARK_GLOBAL_FORM_RESET_RE =
  /input\s*,\s*button\s*,\s*select\s*,\s*optgroup\s*,\s*textarea\s*\{\s*color\s*:\s*inherit\s*;\s*font-family\s*:\s*inherit\s*;?\s*\}/g

const patchLarkStyleElement = (style: HTMLStyleElement) => {
  const cssText = style.textContent

  if (!cssText || !LARK_GLOBAL_FORM_RESET_RE.test(cssText)) {
    LARK_GLOBAL_FORM_RESET_RE.lastIndex = 0

    return
  }

  LARK_GLOBAL_FORM_RESET_RE.lastIndex = 0
  style.textContent = cssText.replace(LARK_GLOBAL_FORM_RESET_RE, '')
}

/**
 * 飞书 SDK 的样式包会向 document.head 注入裸元素 reset：
 * input/button/select... { color: inherit; font-family: inherit }
 * 这条规则是全局选择器，且插入时机晚于项目 CSS，容易污染 shadcn 原生按钮/表单的继承色。
 */
const patchLarkInjectedGlobalFormReset = () => {
  if (typeof document === 'undefined') return

  document.head.querySelectorAll('style').forEach(style => {
    patchLarkStyleElement(style)
  })

  if (larkStylePatchObserverStarted) return

  larkStylePatchObserverStarted = true

  new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      if (mutation.target instanceof HTMLStyleElement) {
        patchLarkStyleElement(mutation.target)
      }

      mutation.addedNodes.forEach(node => {
        if (node instanceof HTMLStyleElement) {
          patchLarkStyleElement(node)
        }
      })
    })
  }).observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true
  })
}

// 注入官方 SDK script（幂等）
const loadSdk = (): Promise<LarkWebComponentSdk> => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('飞书网页组件仅支持在浏览器环境使用'))
  }

  if (window.webComponent) return Promise.resolve(window.webComponent)

  if (!sdkPromise) {
    sdkPromise = new Promise<LarkWebComponentSdk>((resolve, reject) => {
      const script = document.createElement('script')

      script.src = SDK_URL
      script.async = true

      script.onload = () => {
        patchLarkInjectedGlobalFormReset()

        if (window.webComponent) {
          resolve(window.webComponent)
        } else {
          // CDN 返回异常内容或 SDK 执行失败时，onload 仍可能触发。
          // 不能缓存这个拒绝态 Promise，否则后续所有初始化都无法自愈。
          sdkPromise = null
          script.remove()
          reject(new Error('飞书 h5-js-sdk 加载完成但未注入 webComponent'))
        }
      }

      script.onerror = () => {
        // 失败后清空缓存，允许下次重试
        sdkPromise = null
        reject(new Error('飞书 h5-js-sdk 加载失败，请检查网络'))
      }

      document.body.appendChild(script)
    })
  }

  return sdkPromise
}

/**
 * 确保 SDK 已加载并完成 JSAPI 鉴权（幂等，可安全并发调用）。
 * 鉴权失败会清空缓存，下一次调用自动重试。
 */
export const ensureLarkWebComponent = (): Promise<LarkWebComponentSdk> => {
  if (!configPromise) {
    configPromise = (async () => {
      // 首次 config 前同步当前页面主题，保证 SDK 初始渲染与项目视觉状态一致。
      currentTheme = getAppliedProjectTheme()

      const sdk = await loadSdk()

      // 组件鉴权要求：参与签名的 url 需剔除 ? 与 # 之后的参数，且与 config 传入值完全一致
      const url = window.location.href.split(/[?#]/)[0]
      const signature = await apiFetch<JsapiSignature>(`/auth/lark/jsapi-signature?url=${encodeURIComponent(url)}`)

      const themeAtConfig = currentTheme

      await sdk.config({
        appId: signature.appId,
        signature: signature.signature,
        nonceStr: signature.nonceStr,
        timestamp: signature.timestamp,
        openId: signature.openId,
        url,
        jsApiList: [...JS_API_LIST],
        locale: 'zh-CN',
        theme: themeAtConfig
      })

      configured = true
      configuredOpenId = signature.openId

      // config 期间主题可能已被切换（如水合后 next-themes 解析出 dark），补一次同步
      if (currentTheme !== themeAtConfig) {
        sdk.update({ theme: currentTheme })
      }

      return sdk
    })().catch(error => {
      // 失败不缓存，保留重试机会（例如后端未启动、票据过期）
      configPromise = null
      throw error
    })
  }

  return configPromise
}

/**
 * 同步浅色/深色主题到飞书组件。
 * 未完成鉴权时只记录目标主题，config 时一并带上；已鉴权则实时 update。
 */
export const setLarkWebComponentTheme = (theme: LarkComponentTheme) => {
  if (theme === currentTheme) return

  currentTheme = theme

  if (configured && typeof window !== 'undefined' && window.webComponent) {
    window.webComponent.update({ theme })
  }
}

/** 当前登录用户的 open_id（鉴权完成后可用，作为 localStorage 缺失时的兜底） */
export const getLarkConfiguredOpenId = () => configuredOpenId

/**
 * 渲染一个飞书网页组件到指定容器，内部自动完成 SDK 加载与鉴权。
 * 返回组件实例句柄，调用方负责在卸载时 instance.unmount()。
 */
export const renderLarkComponent = async (
  name: 'UserProfile' | 'Selector',
  props: Record<string, unknown>,
  container: Element
): Promise<LarkComponentInstance> => {
  const sdk = await ensureLarkWebComponent()

  patchLarkInjectedGlobalFormReset()

  return sdk.render(name, props, container)
}

// ===== 人员搜索（Selector）实例池复用 =====
// SDK 每次 render 都会向其内部事件总线新增监听，且 unmount 不清理（实测：
// 页面累计第 8 次 render 即触发 “possible EventEmitter memory leak detected”）。
// 组件反复挂载（条件渲染、步骤切换、页面软导航）都会走到 render，因此实例
// 按 render 属性签名池化：只创建不销毁，卸载时把宿主节点摘下停放，同签名
// 再次挂载时直接搬回；onSelect 经池条目上的可变引用路由到当前持有者。

type SelectorPoolEntry = {
  signature: string
  host: HTMLDivElement
  ready: Promise<void>
  inUse: boolean
  onSelect: (option: Record<string, unknown>) => void
}

const selectorPool: SelectorPoolEntry[] = []

export type LarkSelectorHandle = {

  /** render 完成（含 SDK 加载与鉴权）；失败会 reject */
  ready: Promise<void>

  /** 卸载时调用：归还实例到池中（不 unmount，供下次同签名挂载复用） */
  release: () => void
}

/**
 * 把（池化的）人员搜索组件挂到 mountPoint 下。
 * renderProps 默认必须可 JSON 序列化且键序稳定（不含函数）；相同签名的空闲实例直接复用，
 * 不会重新 render。同签名并发挂载时各占一个池条目，互不抢占。
 * 若属性中包含会原地更新的引用数据（例如 recommendList），可传稳定 poolKey 避免重复创建实例。
 */
export const acquireLarkSelector = (
  renderProps: Record<string, unknown>,
  onSelect: (option: Record<string, unknown>) => void,
  mountPoint: HTMLElement,
  poolKey?: string
): LarkSelectorHandle => {
  const signature = poolKey ?? JSON.stringify(renderProps)

  let entry = selectorPool.find(item => item.signature === signature && !item.inUse)

  if (!entry) {
    const created: SelectorPoolEntry = {
      signature,
      host: document.createElement('div'),
      ready: Promise.resolve(),
      inUse: false,
      onSelect: () => undefined
    }

    created.ready = renderLarkComponent(
      'Selector',
      { ...renderProps, onSelect: (option: Record<string, unknown>) => created.onSelect(option) },
      created.host
    ).then(
      () => undefined,
      error => {
        // 渲染失败的实例剔除出池，下次挂载重新创建（保留重试机会）
        const index = selectorPool.indexOf(created)

        if (index >= 0) selectorPool.splice(index, 1)
        throw error
      }
    )

    selectorPool.push(created)
    entry = created
  }

  const acquired = entry

  acquired.inUse = true
  acquired.onSelect = onSelect
  mountPoint.appendChild(acquired.host)

  return {
    ready: acquired.ready,
    release: () => {
      acquired.inUse = false
      acquired.onSelect = () => undefined
      acquired.host.remove()
    }
  }
}

// ===== 成员名片（UserProfile）单例复用 =====
// 与 Selector 同因（SDK unmount 不清理内部监听）。名片按 openId 展示、
// 全局同一时刻只弹一张，因此用更简单的单例策略：弹层打开时把常驻宿主节点
// 挂进弹层、关闭时摘出来；仅当要展示的 openId 变化时才销毁重建。

let profileCardHost: HTMLDivElement | null = null
let profileCardInstance: LarkComponentInstance | null = null
let profileCardOpenId: string | null = null

// 串行化 acquire 调用，避免快速连续打开两个名片时并发 render
let profileCardQueue: Promise<unknown> = Promise.resolve()

// 每次 acquire 都分配唯一令牌；release 会同步撤销当前令牌。
// 这能阻止排队中的异步任务在 Popover 已关闭后“迟到挂载”。
const profileCardMountTokens = new WeakMap<HTMLElement, symbol>()

/** 把（单例的）成员名片挂到 mountPoint 下；openId 未变化时直接复用现有实例。 */
export const acquireLarkProfileCard = (openId: string, mountPoint: HTMLElement): Promise<void> => {
  const mountToken = Symbol(openId)

  profileCardMountTokens.set(mountPoint, mountToken)

  const task = profileCardQueue.then(async () => {
    if (profileCardMountTokens.get(mountPoint) !== mountToken) return

    if (!profileCardHost) {
      profileCardHost = document.createElement('div')
    }

    mountPoint.appendChild(profileCardHost)

    if (profileCardOpenId !== openId || !profileCardInstance) {
      profileCardInstance?.unmount()
      profileCardInstance = null
      profileCardOpenId = null

      profileCardInstance = await renderLarkComponent('UserProfile', { openId }, profileCardHost)
      profileCardOpenId = openId
    }
  })

  // 队列本身吞掉错误保证后续调用可继续；错误仍抛给本次调用方处理
  profileCardQueue = task.catch(() => undefined)

  return task
}

/** 弹层关闭时把名片宿主节点摘走（保留实例复用，不 unmount）。 */
export const releaseLarkProfileCard = (mountPoint: HTMLElement) => {
  profileCardMountTokens.delete(mountPoint)

  if (profileCardHost && profileCardHost.parentElement === mountPoint) {
    profileCardHost.remove()
  }
}
