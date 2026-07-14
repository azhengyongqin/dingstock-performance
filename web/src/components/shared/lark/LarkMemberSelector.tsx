'use client'

// React Imports
import { useCallback, useEffect, useRef, useState } from 'react'

// Third-party Imports
import { CircleAlertIcon } from 'lucide-react'

// Component Imports
import { Skeleton } from '@/components/ui/skeleton'

// Util Imports
import { getStoredUser } from '@/lib/api'
import { acquireLarkSelector } from '@/lib/lark-web-component'
import { cn } from '@/lib/utils'

import { useLarkThemeSync, type LarkMountStatus } from './use-lark-component-mount'

const LARK_SELECTOR_DROPDOWN_SELECTOR = '.larkw-selector-container__dropdown'
const RECENT_STORAGE_KEY = 'dingstock_lark_member_selector_recent_v1'
const QUERY_STORAGE_KEY = 'dingstock_lark_member_selector_query_v1'
const RECENT_LIMIT = 10
const USER_SUBTITLE_TYPE_EMAIL = 1
const USER_DESCRIPTION_TYPE_DEPARTMENT = 1

const MEMBER_OPTION_CONFIG = {
  chatter: {
    subtitleType: USER_SUBTITLE_TYPE_EMAIL,
    descriptionType: USER_DESCRIPTION_TYPE_DEPARTMENT,
    hasTag: true
  }
}

const dropdownMutationListeners = new Set<() => void>()
let sharedDropdownObserver: MutationObserver | null = null

/** 所有 Selector 共用一个 Portal 观察器，避免多实例重复监听整个 document.body。 */
const subscribeToDropdownMutations = (listener: () => void) => {
  dropdownMutationListeners.add(listener)

  if (!sharedDropdownObserver) {
    sharedDropdownObserver = new MutationObserver(() => {
      dropdownMutationListeners.forEach(notify => notify())
    })
    sharedDropdownObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    })
  }

  return () => {
    dropdownMutationListeners.delete(listener)

    if (dropdownMutationListeners.size > 0) return

    sharedDropdownObserver?.disconnect()
    sharedDropdownObserver = null
  }
}

/** 飞书结果面板挂在页面级 Portal，需按水平位置找到当前搜索框对应的可见面板。 */
const syncVisibleDropdownWidth = (trigger: HTMLElement, width: number) => {
  const triggerRect = trigger.getBoundingClientRect()
  const horizontalThreshold = Math.max(48, triggerRect.width * 0.15)
  const verticalThreshold = Math.max(24, triggerRect.height)

  const nearest = Array.from(
    document.querySelectorAll<HTMLElement>(LARK_SELECTOR_DROPDOWN_SELECTOR)
  ).reduce<{
    panel: HTMLElement | null
    horizontalDistance: number
    verticalDistance: number
    totalDistance: number
  }>(
    (nearest, panel) => {
      const rect = panel.getBoundingClientRect()
      const style = window.getComputedStyle(panel)

      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0'
      ) {
        return nearest
      }

      // 兼容面板向上/向下展开，避免两个左边缘相同的 Selector 串台。
      const horizontalDistance = Math.abs(rect.left - triggerRect.left)

      const verticalDistance = Math.min(
        Math.abs(rect.top - triggerRect.bottom),
        Math.abs(rect.bottom - triggerRect.top)
      )

      const totalDistance = horizontalDistance + verticalDistance

      if (horizontalDistance > horizontalThreshold || verticalDistance > verticalThreshold) return nearest

      return totalDistance < nearest.totalDistance
        ? { panel, horizontalDistance, verticalDistance, totalDistance }
        : nearest
    },
    {
      panel: null,
      horizontalDistance: Number.POSITIVE_INFINITY,
      verticalDistance: Number.POSITIVE_INFINITY,
      totalDistance: Number.POSITIVE_INFINITY
    }
  )

  if (!nearest.panel) return

  const cssWidth = `${width}px`
  const nearestPanel = nearest.panel

  if (
    nearestPanel.style.getPropertyValue('width') === cssWidth &&
    nearestPanel.style.getPropertyPriority('width') === 'important' &&
    nearestPanel.style.getPropertyValue('min-width') === cssWidth &&
    nearestPanel.style.getPropertyPriority('min-width') === 'important'
  ) {
    return
  }

  nearestPanel.style.setProperty('width', cssWidth, 'important')
  nearestPanel.style.setProperty('min-width', cssWidth, 'important')
}

/** 飞书搜索组件选中条目（OptionData）：不同实体字段略有差异，这里只声明常用字段 */
export type LarkSelectorOption = {
  id?: string
  title?: string
  name?: string
  label?: string
  avatarUrl?: string

  /** 飞书 Selector 的实际人员资料载体。 */
  entity?: {
    id?: string
    name?: string
    avatarUrl?: string
    mail?: string
    department?: string
  } & Record<string, unknown>
  type?: 'unknown' | 'user' | 'chat' | 'doc' | 'wiki'
} & Record<string, unknown>

const recentOptionsCache = new Map<string, LarkSelectorOption[]>()

/** 同一浏览器切换账号时按 openId 隔离人员搜索历史。 */
const getStorageScope = () => getStoredUser()?.openId ?? 'anonymous'

const getScopedStorageKey = (baseKey: string, scope: string) =>
  scope === 'anonymous' ? baseKey : `${baseKey}:${encodeURIComponent(scope)}`

const loadRecentOptions = (scope: string) => {
  // 每次挂载都从存储校准内容，但保留数组引用供已池化的 SDK 实例继续使用。
  const options = recentOptionsCache.get(scope) ?? []
  const storedOptions: LarkSelectorOption[] = []

  try {
    const raw = window.localStorage.getItem(getScopedStorageKey(RECENT_STORAGE_KEY, scope))
    const parsed: unknown = raw ? JSON.parse(raw) : []

    if (Array.isArray(parsed)) {
      storedOptions.push(
        ...parsed
          .filter(
            (option): option is LarkSelectorOption =>
              typeof option === 'object' && option !== null && typeof option.id === 'string' && option.id.length > 0
          )
          .slice(0, RECENT_LIMIT)
      )
    }
  } catch {
    // 本地数据损坏或浏览器禁用存储时，退化为空推荐列表，不影响正常搜索。
  }

  options.splice(0, options.length, ...storedOptions)
  recentOptionsCache.set(scope, options)

  return options
}

/** 原地更新数组，确保已池化的飞书 Selector 能读取到最新推荐记录。 */
const rememberRecentOption = (scope: string, options: LarkSelectorOption[], option: LarkSelectorOption) => {
  if (!option.id) return

  const nextOptions = [option, ...options.filter(item => item.id !== option.id)].slice(0, RECENT_LIMIT)

  options.splice(0, options.length, ...nextOptions)

  try {
    window.localStorage.setItem(getScopedStorageKey(RECENT_STORAGE_KEY, scope), JSON.stringify(options))
  } catch {
    // 存储空间不足时仍保留当前页面内的最近记录。
  }
}

const readLastQuery = (scope: string) => {
  try {
    return window.localStorage.getItem(getScopedStorageKey(QUERY_STORAGE_KEY, scope)) ?? ''
  } catch {
    return ''
  }
}

const writeLastQuery = (scope: string, query: string) => {
  try {
    const key = getScopedStorageKey(QUERY_STORAGE_KEY, scope)

    if (query) {
      window.localStorage.setItem(key, query)
    } else {
      window.localStorage.removeItem(key)
    }
  } catch {
    // 浏览器禁用存储时只保留组件本次生命周期内的输入。
  }
}

const restoreSelectorQuery = (mountPoint: HTMLElement, query: string) => {
  if (!query) return

  const input = mountPoint.querySelector<HTMLInputElement>('input')

  if (!input || input.value === query) return

  // 使用原生 setter 并派发 input，让 SDK 内部搜索状态与视觉值保持一致。
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set

  valueSetter?.call(input, query)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

export type LarkMemberSelectorProps = {

  /** 选中人员时回调 */
  onSelect: (option: LarkSelectorOption) => void
  placeholder?: string
  className?: string

  /** 搜索框宽度（px），fluid 为 true 时仅作为测量失败时的兜底值 */
  triggerWidth?: number

  /** 是否让搜索框和结果面板一起横向铺满父容器 */
  fluid?: boolean

  /** 下拉面板宽度/高度（px） */
  panelWidth?: number
  panelHeight?: number
}

/**
 * 项目统一的人员搜索选择组件：基于飞书 Selector 网页组件，只搜索“人”。
 * 所有需要搜索/选择人员的场景优先使用本组件，不要自己拼 Combobox + 通讯录接口。
 *
 * 实例经 acquireLarkSelector 池化复用：SDK 的 unmount 不清理内部事件监听，
 * 组件反复挂载（条件渲染 / 步骤切换 / 页面软导航）若每次都 render 会累计监听
 * 并触发 “possible EventEmitter memory leak detected” 告警。
 */
const LarkMemberSelector = ({
  onSelect,
  placeholder = '搜索人员',
  className,
  triggerWidth = 240,
  fluid = false,
  panelWidth = 320,
  panelHeight = 400
}: LarkMemberSelectorProps) => {
  // 回调经 ref 透传：调用方每次渲染传入新函数也不会导致实例重建
  const onSelectRef = useRef(onSelect)

  useEffect(() => {
    onSelectRef.current = onSelect
  })

  const containerRef = useRef<HTMLDivElement | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const dropdownMutationCleanupRef = useRef<(() => void) | null>(null)
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queryRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fluidWidthRef = useRef<number | null>(null)
  const [storageScope] = useState(getStorageScope)
  const [recommendList] = useState(() => loadRecentOptions(storageScope))
  const [initialQuery] = useState(() => readLastQuery(storageScope))
  const lastQueryRef = useRef(initialQuery)
  const [status, setStatus] = useState<LarkMountStatus>('loading')
  const [fluidWidth, setFluidWidth] = useState<number | null>(null)

  useLarkThemeSync()

  const setRootElement = useCallback(
    (node: HTMLDivElement | null) => {
      resizeObserverRef.current?.disconnect()
      dropdownMutationCleanupRef.current?.()

      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      if (!node || !fluid) return

      const width = Math.round(node.getBoundingClientRect().width)
      const initialWidth = width > 0 ? width : triggerWidth

      // SDK 的 panelWidth 只接受数字，因此挂载时将容器实际宽度同时传给触发器和结果面板。
      fluidWidthRef.current = initialWidth
      setFluidWidth(initialWidth)

      resizeObserverRef.current = new ResizeObserver(entries => {
        const nextWidth = Math.round(entries[0]?.contentRect.width ?? 0)

        if (nextWidth <= 0) return

        // 窗口拖拽过程中会高频触发，稍作合并后只调整当前可见浮层，不重建 SDK 实例。
        if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)

        resizeTimerRef.current = setTimeout(() => {
          fluidWidthRef.current = nextWidth
          syncVisibleDropdownWidth(node, nextWidth)
          resizeTimerRef.current = null
        }, 100)
      })
      resizeObserverRef.current.observe(node)

      // 浮层可能在缩放之后才创建/显示，使用最新宽度在 Portal 变化时补同步。
      dropdownMutationCleanupRef.current = subscribeToDropdownMutations(() => {
        const currentWidth = fluidWidthRef.current

        if (currentWidth) syncVisibleDropdownWidth(node, currentWidth)
      })
    },
    [fluid, triggerWidth]
  )

  useEffect(() => {
    const mountPoint = containerRef.current

    if (!mountPoint || (fluid && fluidWidth === null)) return

    const resolvedTriggerWidth = fluid ? (fluidWidth ?? triggerWidth) : triggerWidth
    const resolvedPanelWidth = fluid ? (fluidWidth ?? panelWidth) : panelWidth

    let cancelled = false

    setStatus('loading')

    const scheduleQueryRestore = () => {
      if (queryRestoreTimerRef.current) clearTimeout(queryRestoreTimerRef.current)
      if (!lastQueryRef.current) return

      // SDK 会在初始化和选中后重置输入框，延后一拍恢复最后一次搜索词。
      queryRestoreTimerRef.current = setTimeout(() => {
        restoreSelectorQuery(mountPoint, lastQueryRef.current)
        queryRestoreTimerRef.current = null
      }, 0)
    }

    const handleInput = (event: Event) => {
      if (!(event.target instanceof HTMLInputElement)) return

      lastQueryRef.current = event.target.value
      writeLastQuery(storageScope, event.target.value)
    }

    mountPoint.addEventListener('input', handleInput)

    const renderProps = {
      // searchEntityTypes: 1 表示“人”，本组件固定只搜人员
      searchEntityTypes: [1],
      placeholder,
      showSearchIcon: true,
      triggerWidth: resolvedTriggerWidth,
      panelWidth: resolvedPanelWidth,
      panelHeight,
      optionConfig: MEMBER_OPTION_CONFIG,
      recommendList
    }

    // recommendList 会原地更新；稳定 key 避免每次选择后产生新的 SDK 监听。
    const poolKey = JSON.stringify({
      ...renderProps,
      recommendList: `member-history:${storageScope}`
    })

    const { ready, release } = acquireLarkSelector(
      renderProps,
      option => {
        const selectedOption = option as LarkSelectorOption

        rememberRecentOption(storageScope, recommendList, selectedOption)
        onSelectRef.current(selectedOption)
        scheduleQueryRestore()
      },
      mountPoint,
      poolKey
    )

    ready
      .then(() => {
        if (!cancelled) {
          setStatus('ready')
          scheduleQueryRestore()
        }
      })
      .catch(error => {
        if (!cancelled) {
          console.error('[lark-web-component] Selector 渲染失败：', error)
          setStatus('error')
        }
      })

    return () => {
      cancelled = true
      mountPoint.removeEventListener('input', handleInput)
      if (queryRestoreTimerRef.current) clearTimeout(queryRestoreTimerRef.current)
      release()
    }
  }, [placeholder, triggerWidth, fluid, fluidWidth, panelWidth, panelHeight, recommendList, storageScope])

  return (
    <div
      ref={setRootElement}
      className={cn(
        'relative min-h-9',

        // 飞书 SDK 会给搜索触发器写入固定宽度，流式布局下需要显式覆盖。
        fluid && 'w-full [&_.larkw-selector-container]:!w-full',
        className
      )}
      style={fluid ? undefined : { width: triggerWidth }}
    >
      <div ref={containerRef} className={cn(status !== 'ready' && 'invisible')} />

      {status === 'loading' && <Skeleton className='absolute inset-0 h-9 rounded-md' />}

      {status === 'error' && (
        <div className='text-muted-foreground absolute inset-0 flex h-9 items-center gap-1.5 rounded-md border border-dashed px-3 text-xs'>
          <CircleAlertIcon className='text-destructive size-3.5 shrink-0' />
          飞书搜索组件加载失败
        </div>
      )}
    </div>
  )
}

export default LarkMemberSelector
