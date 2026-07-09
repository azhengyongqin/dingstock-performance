'use client'

// React Imports
import { useEffect, useMemo, useRef } from 'react'

// Third-party Imports
import { CircleAlertIcon } from 'lucide-react'

// Component Imports
import { Skeleton } from '@/components/ui/skeleton'

// Util Imports
import { cn } from '@/lib/utils'

import { useLarkComponentMount } from './use-lark-component-mount'

/** 飞书搜索组件选中条目（OptionData）：不同实体字段略有差异，这里只声明常用字段 */
export type LarkSelectorOption = {
  id?: string
  name?: string
  label?: string
  avatarUrl?: string
  type?: number
} & Record<string, unknown>

export type LarkMemberSelectorProps = {

  /** 选中人员时回调 */
  onSelect: (option: LarkSelectorOption) => void
  placeholder?: string
  className?: string

  /** 搜索框宽度（px） */
  triggerWidth?: number

  /** 下拉面板宽度/高度（px） */
  panelWidth?: number
  panelHeight?: number
}

/**
 * 项目统一的人员搜索选择组件：基于飞书 Selector 网页组件，只搜索“人”。
 * 所有需要搜索/选择人员的场景优先使用本组件，不要自己拼 Combobox + 通讯录接口。
 */
const LarkMemberSelector = ({
  onSelect,
  placeholder = '搜索人员',
  className,
  triggerWidth = 240,
  panelWidth = 320,
  panelHeight = 400
}: LarkMemberSelectorProps) => {
  // 回调经 ref 透传：调用方每次渲染传入新函数也不会导致组件重建
  const onSelectRef = useRef(onSelect)

  useEffect(() => {
    onSelectRef.current = onSelect
  })

  const componentProps = useMemo(
    () => ({
      onSelect: (option: LarkSelectorOption) => onSelectRef.current(option),

      // searchEntityTypes: 1 表示“人”，本组件固定只搜人员
      searchEntityTypes: [1],
      placeholder,
      showSearchIcon: true,
      triggerWidth,
      panelWidth,
      panelHeight
    }),
    [placeholder, triggerWidth, panelWidth, panelHeight]
  )

  const { containerRef, status } = useLarkComponentMount('Selector', componentProps)

  return (
    <div className={cn('relative min-h-9', className)} style={{ width: triggerWidth }}>
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
