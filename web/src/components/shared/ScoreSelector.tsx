'use client'

/**
 * SCORE 0～100 分打分：最多两位小数，标准 InputGroup（数字 +「分」+ 命中等级徽章）。
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
    mappingScore: '95'
  },
  {
    symbol: 'A',
    name: '优秀',
    description: '整体表现超出预期',
    minScore: '80',
    maxScore: '90',
    mappingScore: '85'
  },
  {
    symbol: 'B',
    name: '良好',
    description: '整体表现符合预期',
    minScore: '60',
    maxScore: '80',
    mappingScore: '70'
  },
  {
    symbol: 'C',
    name: '不符预期',
    description: '绩效目标、工作态度或价值观表现不符合预期',
    minScore: '0',
    maxScore: '60',
    mappingScore: '50'
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

  return Math.min(100, Math.max(0, value))
}

function normalizeScoreInput(raw: string): string {
  const trimmed = raw.trim()

  if (trimmed === '') return ''

  const n = Number(trimmed)

  if (!Number.isFinite(n)) return trimmed

  return String(clampScore(n))
}

/** 仅保留数字与首个小数点，小数最多两位，并即时钳制到 0～100。 */
function sanitizeScoreInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const [integer = '', ...decimalParts] = cleaned.split('.')
  const hasDot = cleaned.includes('.')
  const decimal = decimalParts.join('').slice(0, 2)
  const normalizedInteger = integer === '' && hasDot ? '0' : integer
  const next = `${normalizedInteger}${hasDot ? `.${decimal}` : ''}`

  if (next === '') return ''
  const numeric = Number(next)

  return Number.isFinite(numeric) && numeric > 100 ? '100' : next
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

/** 最多两位小数的分数输入 + 命中等级徽章（0～100） */
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
            inputMode='decimal'
            pattern='(?:100(?:\.0{1,2})?|\d{1,2}(?:\.\d{1,2})?)'
            autoComplete='off'
            disabled={disabled}
            placeholder='0–100'
            value={value}
            onKeyDown={event => {
              // 科学计数、正负号和空格不属于受控分数格式；小数点由清洗函数限制为一个。
              if ([',', 'e', 'E', '+', '-', ' '].includes(event.key)) {
                event.preventDefault()
              }
            }}
            onChange={event => onChange(sanitizeScoreInput(event.target.value))}
            onBlur={() => {
              if (value.trim() !== '') onChange(normalizeScoreInput(value))
            }}
            className='w-14 flex-none px-1.5 text-center tabular-nums'
          />
          <InputGroupText className='px-1 text-xs'>分</InputGroupText>

          {/* 与等级徽章拉开间距，避免和「分」挤在一起 */}
          <InputGroupAddon align='inline-end' className='pl-2.5'>
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
