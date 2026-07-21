'use client'

/**
 * S/A/B/C 等级选择器：飞书式时间轴胶囊。
 * 选中用等级浅色；hover 白底介绍面板展示规则配置中的区间/映射/说明。
 * 等级间距：min 2px，随父级可用宽度拉伸，整体上限限制最大间距。
 */
import {
  RATING_SOFT,
  RatingHoverPanel,
  resolveRating
} from '@/components/shared/PerformanceLevelBadge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { PerfConfigTemplateRating, PerfPerformanceLevel } from '@/lib/perf-api'
import { cn } from '@/lib/utils'

/** 低→高时间轴，对齐飞书参考交互 */
const ASCENDING_SYMBOLS: PerfPerformanceLevel[] = ['C', 'B', 'A', 'S']

export type RatingSelectorProps = {
  value: PerfPerformanceLevel | null | undefined
  onChange: (value: PerfPerformanceLevel) => void
  disabled?: boolean
  ratings?: PerfConfigTemplateRating[]
  'aria-label'?: string
  className?: string
}

/** 时间轴胶囊等级选择器（C→B→A→S） */
export function RatingSelector({
  value,
  onChange,
  disabled,
  ratings,
  'aria-label': ariaLabel = '绩效等级',
  className
}: RatingSelectorProps) {
  return (
    <TooltipProvider delay={120}>
      {/*
        w-full!：压过外层 Field 的 *:w-auto，否则宽度塌成内容宽、间距无法伸缩。
        max-w-80：约等于 4 胶囊 + 3×2rem，用来封顶最大间距。
      */}
      <div className={cn('relative ml-auto w-full! min-w-0 max-w-80 py-2', className)}>
        {/* 细线在前、pill 在后，靠文档顺序压线 */}
        <div aria-hidden className='bg-border absolute top-1/2 right-6 left-6 h-px -translate-y-1/2' />

        <div
          role='radiogroup'
          aria-label={ariaLabel}
          className='relative flex w-full items-center justify-between gap-[2px]'
        >
          {ASCENDING_SYMBOLS.map(symbol => {
            const rating = resolveRating(symbol, ratings)
            const selected = value === symbol
            const color = RATING_SOFT[symbol]

            return (
              <Tooltip key={symbol}>
                <TooltipTrigger
                  render={
                    <button
                      type='button'
                      role='radio'
                      aria-checked={selected}
                      aria-label={`${symbol} · ${rating.name}`}
                      disabled={disabled}
                      onClick={() => onChange(symbol)}
                      className={cn(
                        'relative flex h-8 min-w-12 shrink-0 items-center justify-center rounded-full border px-4 text-sm font-medium outline-none',
                        'transition-[transform,box-shadow,background-color,color,border-color] duration-200 ease-out',
                        'hover:scale-105 focus-visible:ring-2 focus-visible:ring-offset-2',
                        'active:scale-95',
                        selected
                          ? cn(color.bg, color.text, color.border, 'scale-110 shadow-sm', color.ring, 'ring-2')
                          : 'bg-background text-foreground/70 border-border/80 hover:border-foreground/25 hover:text-foreground',
                        disabled && 'pointer-events-none opacity-50'
                      )}
                    />
                  }
                >
                  {symbol}
                </TooltipTrigger>
                <TooltipContent
                  side='top'
                  sideOffset={10}
                  className={cn(
                    'bg-popover text-popover-foreground flex max-w-80 flex-col items-stretch gap-0 rounded-lg border px-3.5 py-3 text-sm shadow-md ring-1 ring-black/5',
                    '[&>span:last-child]:bg-popover [&>span:last-child]:fill-popover'
                  )}
                >
                  <RatingHoverPanel rating={rating} color={color} />
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      </div>
    </TooltipProvider>
  )
}

export default RatingSelector
