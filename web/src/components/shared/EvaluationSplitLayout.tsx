'use client'

import type { ReactNode } from 'react'

import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

type EvaluationSplitLayoutProps = {
  collapsed: boolean
  left: ReactNode
  right: ReactNode
  className?: string
}

/**
 * 评估填写页通用分栏：单 Card 撑满可用高度且自身不滚动；
 * 左右内容区各自内部滚动（由子组件负责）。
 */
const EvaluationSplitLayout = ({ collapsed, left, right, className }: EvaluationSplitLayoutProps) => (
  // 用 inset border 替代外扩 ring，避免父级 overflow 裁掉左右边框
  <Card
    className={cn(
      'flex h-0 min-h-0 flex-1 flex-col gap-0 overflow-hidden border py-0 shadow-xs ring-0',
      className
    )}
  >
    <div className={cn('flex h-full min-h-0', collapsed ? 'flex-row' : 'flex-col lg:flex-row')}>
      <aside
        className={cn(
          'flex min-h-0 shrink-0 flex-col',
          collapsed ? 'w-12' : 'w-full min-w-0 lg:w-[38%] lg:min-w-[280px] lg:max-w-md'
        )}
      >
        {left}
      </aside>

      {!collapsed && <Separator className='lg:hidden' />}
      <Separator orientation='vertical' className='hidden lg:block' />

      <section className='flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>{right}</section>
    </div>
  </Card>
)

export default EvaluationSplitLayout
