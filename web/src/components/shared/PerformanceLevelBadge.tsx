'use client'

/**
 * 只读绩效等级徽章：色阶与 RatingSelector / ScoreSelector 一致，hover 展示等级说明面板。
 */
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { PerfConfigTemplateRating, PerfPerformanceLevel } from '@/lib/perf-api'
import { cn } from '@/lib/utils'

export type RatingSoftColor = {
  bg: string
  text: string
  border: string
  ring: string
}

/** 与配置模板 getRatingColor / RatingSelector 浅色一致 */
export const RATING_SOFT: Record<PerfPerformanceLevel, RatingSoftColor> = {
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

export function isPerfPerformanceLevel(value: string): value is PerfPerformanceLevel {
  return value === 'S' || value === 'A' || value === 'B' || value === 'C'
}

export function resolveRating(
  symbol: PerfPerformanceLevel,
  ratings?: PerfConfigTemplateRating[]
): PerfConfigTemplateRating {
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

export function RatingHoverPanel({
  rating,
  color
}: {
  rating: PerfConfigTemplateRating
  color: RatingSoftColor
}) {
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

type PerformanceLevelBadgeProps = {
  level: string
  ratings?: PerfConfigTemplateRating[]

  /** sm=维度行；md=摘要卡；lg=强调展示 */
  size?: 'sm' | 'md' | 'lg'

  /** badge=带底色徽章；plain=仅文字色 span，无背景 */
  variant?: 'badge' | 'plain'
  className?: string
}

/**
 * 只读等级展示：合法 S/A/B/C 时套系统色并支持 hover 说明；非法值降级为普通文案。
 */
export function PerformanceLevelBadge({
  level,
  ratings,
  size = 'sm',
  variant = 'badge',
  className
}: PerformanceLevelBadgeProps) {
  if (!isPerfPerformanceLevel(level)) {
    if (variant === 'plain') {
      return <span className={cn('tabular-nums font-medium', className)}>{level}</span>
    }

    return (
      <Badge variant='outline' className={cn('tabular-nums', className)}>
        {level}
      </Badge>
    )
  }

  const rating = resolveRating(level, ratings)
  const color = RATING_SOFT[level]

  const trigger =
    variant === 'plain' ? (
      <span
        className={cn(
          'inline-block tabular-nums transition-opacity duration-150 hover:opacity-80',
          color.text,
          size === 'sm' && 'text-sm font-semibold',
          size === 'md' && 'text-2xl font-medium',
          size === 'lg' && 'text-4xl font-bold',
          className
        )}
      >
        {level}
      </span>
    ) : (
      <Badge
        variant='outline'
        className={cn(
          'justify-center border tabular-nums transition-[filter,transform] duration-150',
          'hover:brightness-95 hover:saturate-125',
          color.bg,
          color.text,
          color.border,
          size === 'sm' && 'h-6 min-w-8 px-1.5 text-xs',
          size === 'md' && 'h-10 min-w-10 rounded-lg px-3 text-xl font-bold',
          size === 'lg' && 'h-16 min-w-16 rounded-2xl px-4 text-4xl font-bold',
          className
        )}
      >
        {level}
      </Badge>
    )

  return (
    <TooltipProvider delay={120}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button type='button' className='outline-none' aria-label={`${level} · ${rating.name}`} />
          }
        >
          {trigger}
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
    </TooltipProvider>
  )
}
