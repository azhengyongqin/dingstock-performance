'use client'

/**
 * S/A/B/C 等级选择器：飞书式时间轴胶囊。
 * 选中用等级浅色；hover 白底介绍面板展示规则配置中的区间/映射/说明。
 */
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { PerfConfigTemplateRating, PerfPerformanceLevel } from '@/lib/perf-api'
import { cn } from '@/lib/utils'

/** 低→高时间轴，对齐飞书参考交互 */
const ASCENDING_SYMBOLS: PerfPerformanceLevel[] = ['C', 'B', 'A', 'S']

const FALLBACK_RATING: Record<PerfPerformanceLevel, Omit<PerfConfigTemplateRating, 'symbol'>> = {
  S: {
    name: '卓越',
    description: '工作结果、成长速度等方面有重大突破和创新',
    minScore: '90',
    maxScore: '100',
    mappingScore: '95'
  },
  A: {
    name: '优秀',
    description: '整体表现超出预期',
    minScore: '80',
    maxScore: '90',
    mappingScore: '85'
  },
  B: {
    name: '良好',
    description: '整体表现符合预期',
    minScore: '60',
    maxScore: '80',
    mappingScore: '70'
  },
  C: {
    name: '不符预期',
    description: '绩效目标、工作态度或价值观表现不符合预期',
    minScore: '0',
    maxScore: '60',
    mappingScore: '50'
  }
}

type RatingSoftColor = {
  bg: string
  text: string
  border: string
  ring: string
}

/** 与配置模板 getRatingColor 浅色一致 */
const RATING_SOFT: Record<PerfPerformanceLevel, RatingSoftColor> = {
  S: {
    bg: 'bg-purple-100',
    text: 'text-purple-700',
    border: 'border-purple-200',
    ring: 'ring-purple-300/60'
  },
  A: {
    bg: 'bg-green-100',
    text: 'text-green-700',
    border: 'border-green-200',
    ring: 'ring-green-300/60'
  },
  B: {
    bg: 'bg-amber-100',
    text: 'text-amber-700',
    border: 'border-amber-200',
    ring: 'ring-amber-300/60'
  },
  C: {
    bg: 'bg-red-100',
    text: 'text-red-700',
    border: 'border-red-200',
    ring: 'ring-red-300/60'
  }
}

function resolveRating(symbol: PerfPerformanceLevel, ratings?: PerfConfigTemplateRating[]): PerfConfigTemplateRating {
  const fromConfig = ratings?.find(item => item.symbol === symbol)
  const fallback = FALLBACK_RATING[symbol]

  return {
    symbol,
    name: fromConfig?.name || fallback.name,
    description: fromConfig?.description ?? fallback.description,
    minScore: fromConfig?.minScore ?? fallback.minScore,
    maxScore: fromConfig?.maxScore ?? fallback.maxScore,
    mappingScore: fromConfig?.mappingScore ?? fallback.mappingScore
  }
}

function RatingHoverPanel({ rating, color }: { rating: PerfConfigTemplateRating; color: RatingSoftColor }) {
  return (
    <div className='flex w-full gap-3 text-left'>
      <Badge
        variant='outline'
        className={cn('h-fit min-w-11 shrink-0 justify-center border bg-white/90 shadow-xs', color.text, color.border)}
      >
        {rating.symbol}
      </Badge>
      <div className='min-w-0 flex-1'>
        <div className='flex flex-wrap items-baseline gap-x-2 gap-y-0.5'>
          <span className={cn('text-sm font-semibold', color.text)}>{rating.name}</span>
          <span className='text-foreground/60 text-xs font-normal'>
            {rating.minScore}–{rating.maxScore} · 映射 {rating.mappingScore}
          </span>
        </div>
        <p className='text-foreground/75 mt-1.5 text-sm leading-relaxed'>{rating.description || '未配置说明'}</p>
      </div>
    </div>
  )
}

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
      {/* 固定宽度便于与 Label 同行两端对齐；勿用 w-full 以免撑满整行 */}
      <div className={cn('relative w-72 shrink-0 py-2', className)}>
        {/* 细线在前、pill 在后，靠文档顺序压线，避免 z-index 在滚动时盖住其它区块 */}
        <div aria-hidden className='bg-border absolute top-1/2 right-8 left-8 h-px -translate-y-1/2' />

        <div role='radiogroup' aria-label={ariaLabel} className='relative flex items-center justify-between'>
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
                        'relative flex h-8 min-w-14 items-center justify-center rounded-full border px-5 text-sm font-medium outline-none',
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
