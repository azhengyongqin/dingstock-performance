'use client'

/**
 * SCORE 整数打分：标准 InputGroup（数字 +「分」+ 命中等级徽章）。
 * hover 徽章展示规则配置中的区间/映射/说明，色阶与 RatingSelector 一致。
 */
import { Badge } from '@/components/ui/badge'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { PerfConfigTemplateRating, PerfPerformanceLevel } from '@/lib/perf-api'
import { cn } from '@/lib/utils'

const FALLBACK_RATINGS: PerfConfigTemplateRating[] = [
  {
    symbol: 'S',
    name: '卓越',
    description: '工作结果、成长速度等方面有重大突破和创新',
    minScore: '90',
    maxScore: '100',
    mappingScore: '95',
    commentRequired: true
  },
  {
    symbol: 'A',
    name: '优秀',
    description: '整体表现超出预期',
    minScore: '80',
    maxScore: '90',
    mappingScore: '85',
    commentRequired: false
  },
  {
    symbol: 'B',
    name: '良好',
    description: '整体表现符合预期',
    minScore: '60',
    maxScore: '80',
    mappingScore: '70',
    commentRequired: false
  },
  {
    symbol: 'C',
    name: '不符预期',
    description: '绩效目标、工作态度或价值观表现不符合预期',
    minScore: '0',
    maxScore: '60',
    mappingScore: '50',
    commentRequired: true
  }
]

const SCORE_SOFT: Record<PerfPerformanceLevel, { bg: string; text: string; border: string }> = {
  S: { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-200' },
  A: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200' },
  B: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' },
  C: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200' }
}

type SoftColor = (typeof SCORE_SOFT)[keyof typeof SCORE_SOFT]

/** 左闭右开，最高档右闭 */
function findLevelByScore(score: number, ratings: PerfConfigTemplateRating[]): PerfConfigTemplateRating | null {
  if (!Number.isFinite(score)) return null

  const sorted = [...ratings].sort((a, b) => Number(a.minScore) - Number(b.minScore))

  for (let i = 0; i < sorted.length; i += 1) {
    const item = sorted[i]
    const min = Number(item.minScore)
    const max = Number(item.maxScore)
    const isLast = i === sorted.length - 1
    const hit = isLast ? score >= min && score <= max : score >= min && score < max

    if (hit) return item
  }

  return null
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0

  return Math.min(100, Math.max(0, Math.round(value)))
}

function normalizeScoreInput(raw: string): string {
  const trimmed = raw.trim()

  if (trimmed === '') return ''

  const n = Number(trimmed)

  if (!Number.isFinite(n)) return trimmed

  return String(clampScore(n))
}

/** 仅保留数字并钳制到 0–100；拒绝小数与其它字符 */
function sanitizeScoreDigits(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '')

  if (digits === '') return ''

  return String(Math.min(100, Number(digits)))
}

function ScoreLevelHoverPanel({ rating, color }: { rating: PerfConfigTemplateRating; color: SoftColor }) {
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
            {rating.commentRequired ? ' · 评语必填' : ''}
          </span>
        </div>
        <p className='text-foreground/75 mt-1.5 text-sm leading-relaxed'>{rating.description || '未配置说明'}</p>
      </div>
    </div>
  )
}

export type ScoreSelectorProps = {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  ratings?: PerfConfigTemplateRating[]
  'aria-label'?: string
  className?: string
}

/** 整数分数输入 + 命中等级徽章（0–100） */
export function ScoreSelector({
  value,
  onChange,
  disabled,
  ratings,
  'aria-label': ariaLabel = '分数',
  className
}: ScoreSelectorProps) {
  const levels = ratings?.length ? ratings : FALLBACK_RATINGS
  const numeric = value.trim() === '' ? null : Number(value)
  const score = numeric != null && Number.isFinite(numeric) ? clampScore(numeric) : null
  const level = score == null ? null : findLevelByScore(score, levels)
  const color = level ? SCORE_SOFT[level.symbol] : null

  return (
    <TooltipProvider delay={120}>
      <div className={cn('w-fit', className)}>
        <InputGroup className={cn('w-fit!', disabled && 'opacity-50')}>
          <InputGroupInput
            aria-label={ariaLabel}
            type='text'
            inputMode='numeric'
            pattern='[0-9]*'
            autoComplete='off'
            disabled={disabled}
            placeholder='0–100'
            value={value}
            onKeyDown={event => {
              // 拦截小数点与科学计数等，保证只能输整数
              if (['.', ',', 'e', 'E', '+', '-', ' '].includes(event.key)) {
                event.preventDefault()
              }
            }}
            onChange={event => onChange(sanitizeScoreDigits(event.target.value))}
            onBlur={() => {
              if (value.trim() !== '') onChange(normalizeScoreInput(value))
            }}
            className='w-20 flex-none text-center tabular-nums'
          />
          <InputGroupText className='px-1 text-xs'>分</InputGroupText>

          <InputGroupAddon align='inline-end' className='pl-0'>
            {level && color ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type='button'
                      disabled={disabled}
                      className='outline-none'
                      aria-label={`${level.symbol} · ${level.name}`}
                    />
                  }
                >
                  <Badge
                    variant='outline'
                    className={cn(
                      'h-6 min-w-8 justify-center px-1.5 text-xs transition-[filter,transform] duration-150',
                      'hover:brightness-95 hover:saturate-125',
                      color.bg,
                      color.text,
                      color.border
                    )}
                  >
                    {level.symbol}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent
                  side='top'
                  sideOffset={10}
                  className={cn(
                    'bg-popover text-popover-foreground flex max-w-80 flex-col items-stretch gap-0 rounded-lg border px-3.5 py-3 text-sm shadow-md ring-1 ring-black/5',
                    '[&>span:last-child]:bg-popover [&>span:last-child]:fill-popover'
                  )}
                >
                  <ScoreLevelHoverPanel rating={level} color={color} />
                </TooltipContent>
              </Tooltip>
            ) : (
              <InputGroupText className='text-muted-foreground w-8 justify-center text-xs'>—</InputGroupText>
            )}
          </InputGroupAddon>
        </InputGroup>
      </div>
    </TooltipProvider>
  )
}

export default ScoreSelector
