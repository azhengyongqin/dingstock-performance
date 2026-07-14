'use client'

// React Imports
import { useEffect, useRef, useState } from 'react'

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

  /** 搜索框宽度（px），fluid 为 true 时仅作为 SDK 初始宽度 */
  triggerWidth?: number

  /** 是否忽略飞书 SDK 的固定触发器宽度，横向铺满父容器 */
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
  const [status, setStatus] = useState<LarkMountStatus>('loading')

  useLarkThemeSync()

  useEffect(() => {
    const mountPoint = containerRef.current

    if (!mountPoint) return

    let cancelled = false

    setStatus('loading')

    const { ready, release } = acquireLarkSelector(
      {
        // searchEntityTypes: 1 表示“人”，本组件固定只搜人员
        searchEntityTypes: [1],
        placeholder,
        showSearchIcon: true,
        triggerWidth,
        panelWidth,
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
  }, [placeholder, triggerWidth, panelWidth, panelHeight])

  return (
    <div
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
