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
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [status, setStatus] = useState<LarkMountStatus>('loading')
  const [fluidWidth, setFluidWidth] = useState<number | null>(null)

  useLarkThemeSync()

  const setRootElement = useCallback(
    (node: HTMLDivElement | null) => {
      resizeObserverRef.current?.disconnect()

      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      if (!node || !fluid) return

      const width = Math.round(node.getBoundingClientRect().width)

      // SDK 的 panelWidth 只接受数字，因此挂载时将容器实际宽度同时传给触发器和结果面板。
      setFluidWidth(width > 0 ? width : triggerWidth)

      resizeObserverRef.current = new ResizeObserver(entries => {
        const nextWidth = Math.round(entries[0]?.contentRect.width ?? 0)

        if (nextWidth <= 0) return

        // 窗口拖拽过程中会高频触发，稍作合并可避免反复重建 SDK 实例。
        if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)

        resizeTimerRef.current = setTimeout(() => {
          setFluidWidth(current => (current === nextWidth ? current : nextWidth))
          resizeTimerRef.current = null
        }, 100)
      })
      resizeObserverRef.current.observe(node)
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
