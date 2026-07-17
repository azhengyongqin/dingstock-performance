'use client'

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

type EvaluationSplitLayoutProps = {
  collapsed: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  left: ReactNode
  right: ReactNode
  className?: string
}

/** 与 Tailwind `lg` 对齐：仅大屏启用左右拖拽分栏 */
const LG_MIN_WIDTH = 1024

/** 对齐侧栏 Sidebar container：transition-[width/height] duration-200 ease-linear */
const SIDEBAR_MOTION = 'duration-200 ease-linear'

/** 收起尺寸：左右窄轨 / 上下顶栏，等同 w-12 / h-12 */
const COLLAPSED_SIZE_PX = 48
const MIN_LEFT_PX = 280
const DEFAULT_LEFT_RATIO = 0.38
const MAX_LEFT_RATIO = 0.7
const MIN_RIGHT_RATIO = 0.3

/** true = 左右分栏；false = 上下堆叠（参考区收起时应变成顶部条） */
export function useEvaluationSplitSideBySide() {
  const [sideBySide, setSideBySide] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${LG_MIN_WIDTH}px)`)
    const onChange = () => setSideBySide(mql.matches)

    mql.addEventListener('change', onChange)
    onChange()

    return () => mql.removeEventListener('change', onChange)
  }, [])

  // 水合前按桌面处理，避免评估页首屏闪成纵向堆叠
  return sideBySide ?? true
}

/** 保证子面板拿到有界高度，内部 ScrollArea / overflow-y-auto 才能滚动 */
const panelShellClassName = 'flex h-full min-h-0 min-w-0 flex-col overflow-hidden'

function clampLeftWidth(width: number, containerWidth: number) {
  const maxByRatio = Math.floor(containerWidth * MAX_LEFT_RATIO)
  const maxByRight = Math.floor(containerWidth * (1 - MIN_RIGHT_RATIO)) - 1
  const max = Math.max(MIN_LEFT_PX, Math.min(maxByRatio, maxByRight))

  return Math.min(Math.max(width, MIN_LEFT_PX), max)
}

/**
 * 评估填写页通用分栏：
 * 左右 / 上下收起均对齐侧栏抽屉动画（transition-[width|height] + 分界线）。
 */
const EvaluationSplitLayout = ({ collapsed, left, right, className }: EvaluationSplitLayoutProps) => {
  const sideBySide = useEvaluationSplitSideBySide()
  const containerRef = useRef<HTMLDivElement>(null)
  const [expandedWidth, setExpandedWidth] = useState<number | null>(null)
  const [expandedHeight, setExpandedHeight] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)

  // 左右：量容器宽度；上下：量容器高度（展开时参考区占一半）
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const syncSize = () => {
      if (sideBySide) {
        setExpandedWidth(prev => {
          if (prev != null) return clampLeftWidth(prev, el.clientWidth)
          return clampLeftWidth(Math.floor(el.clientWidth * DEFAULT_LEFT_RATIO), el.clientWidth)
        })
        return
      }

      // 减去分隔线约 1px，上下对半
      const half = Math.max(COLLAPSED_SIZE_PX, Math.floor((el.clientHeight - 1) / 2))
      setExpandedHeight(half)
    }

    syncSize()
    const ro = new ResizeObserver(syncSize)
    ro.observe(el)

    return () => ro.disconnect()
  }, [sideBySide])

  const leftWidthPx = collapsed
    ? COLLAPSED_SIZE_PX
    : (expandedWidth ?? Math.floor(480 * DEFAULT_LEFT_RATIO + MIN_LEFT_PX))

  const topHeightPx = collapsed ? COLLAPSED_SIZE_PX : (expandedHeight ?? 240)

  const onResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (collapsed) return
    event.preventDefault()

    const containerWidth = containerRef.current?.clientWidth ?? 0
    if (containerWidth <= 0) return

    const startX = event.clientX
    const startWidth = leftWidthPx
    setDragging(true)

    const onMove = (moveEvent: PointerEvent) => {
      const next = clampLeftWidth(startWidth + (moveEvent.clientX - startX), containerWidth)
      setExpandedWidth(next)
    }

    const onUp = () => {
      setDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return (
    // 用 inset border 替代外扩 ring，避免父级 overflow 裁掉左右边框
    <Card
      className={cn(
        'flex h-0 min-h-0 flex-1 flex-col gap-0 overflow-hidden border py-0 shadow-xs ring-0',
        className
      )}
    >
      {sideBySide ? (
        <div ref={containerRef} className='flex h-full min-h-0 w-full overflow-hidden'>
          {/* 左右：transition-[width]，收起后 border-r 保留分界线 */}
          <aside
            data-slot='evaluation-ref'
            data-state={collapsed ? 'collapsed' : 'expanded'}
            className={cn(
              panelShellClassName,
              'shrink-0',
              collapsed && 'border-r',
              !dragging && `transition-[width] ${SIDEBAR_MOTION}`
            )}
            style={{ width: leftWidthPx } satisfies CSSProperties}
          >
            {left}
          </aside>

          {!collapsed && (
            <div
              role='separator'
              aria-orientation='vertical'
              aria-label='调整参考区宽度'
              className='bg-border relative flex w-px shrink-0 cursor-col-resize items-center justify-center after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2'
              onPointerDown={onResizePointerDown}
            >
              <div className='bg-border z-10 flex h-6 w-1 shrink-0 rounded-lg' />
            </div>
          )}

          <section className={cn(panelShellClassName, 'min-w-0 flex-1')}>{right}</section>
        </div>
      ) : (
        <div ref={containerRef} className='flex h-full min-h-0 w-full flex-col overflow-hidden'>
          {/* 上下：与左右同款抽屉，改为 transition-[height] + border-b */}
          <aside
            data-slot='evaluation-ref'
            data-state={collapsed ? 'collapsed' : 'expanded'}
            className={cn(
              panelShellClassName,
              'w-full shrink-0',
              collapsed && 'border-b',
              `transition-[height] ${SIDEBAR_MOTION}`
            )}
            style={{ height: topHeightPx } satisfies CSSProperties}
          >
            {left}
          </aside>

          {!collapsed && <Separator className='shrink-0' />}

          <section className={cn(panelShellClassName, 'min-h-0 flex-1')}>{right}</section>
        </div>
      )}
    </Card>
  )
}

export default EvaluationSplitLayout
