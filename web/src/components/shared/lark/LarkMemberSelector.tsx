'use client'

// React Imports
import { useCallback, useEffect, useRef, useState } from 'react'

// Third-party Imports
import { CircleAlertIcon } from 'lucide-react'

// Component Imports
import { Skeleton } from '@/components/ui/skeleton'

// Util Imports
import { acquireLarkSelector } from '@/lib/lark-web-component'
import { cn } from '@/lib/utils'

import { useLarkThemeSync, type LarkMountStatus } from './use-lark-component-mount'

const LARK_SELECTOR_DROPDOWN_SELECTOR = '.larkw-selector-container__dropdown'
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
  name?: string
  label?: string
  avatarUrl?: string

  /** 飞书 Selector 的实际人员资料载体。 */
  entity?: {
    name?: string
    avatarUrl?: string
  }
  type?: number
} & Record<string, unknown>

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
  const fluidWidthRef = useRef<number | null>(null)
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

    const { ready, release } = acquireLarkSelector(
      {
        // searchEntityTypes: 1 表示“人”，本组件固定只搜人员
        searchEntityTypes: [1],
        placeholder,
        showSearchIcon: true,
        triggerWidth: resolvedTriggerWidth,
        panelWidth: resolvedPanelWidth,
        panelHeight
      },
      option => onSelectRef.current(option as LarkSelectorOption),
      mountPoint
    )

    ready
      .then(() => {
        if (!cancelled) setStatus('ready')
      })
      .catch(error => {
        if (!cancelled) {
          console.error('[lark-web-component] Selector 渲染失败：', error)
          setStatus('error')
        }
      })

    return () => {
      cancelled = true
      release()
    }
  }, [placeholder, triggerWidth, fluid, fluidWidth, panelWidth, panelHeight])

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
