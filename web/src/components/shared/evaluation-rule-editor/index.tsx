'use client'

import { useMemo, useRef, useState } from 'react'

import { ChevronDownIcon, ChevronUpIcon, EyeIcon, PlusIcon, Trash2Icon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { EvaluationRating } from '@/lib/perf-api'
import { cn } from '@/lib/utils'

import {
  addInterval,
  clampScore,
  createEmptyRating,
  findRatingByScore,
  getRatingColor,
  normalizeEvaluationRuleDraft,
  removeInterval,
  setBoundary,
  validateEvaluationRuleDraft
} from './utils'
import type { EvaluationRuleDraft } from './utils'

type EvaluationRuleEditorProps = {
  value: EvaluationRuleDraft
  disabled?: boolean
  onChange: (value: EvaluationRuleDraft) => void
}

/** 分数步进输入框：带上下箭头，禁用态置灰只读（如派生的下限、锁定的 0/100）。 */
const ScoreStepper = ({
  value,
  onChange,
  disabled = false,
  className
}: {
  value: number
  onChange: (value: number) => void
  disabled?: boolean
  className?: string
}) => {
  const step = (delta: number) => onChange(clampScore(value + delta))

  return (
    <div className={cn('relative', className)}>
      <Input
        type='number'
        min={0}
        max={100}
        value={value}
        disabled={disabled}
        onChange={event => onChange(clampScore(Number(event.target.value)))}
        className={cn(
          'text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          !disabled && 'pr-7',
          disabled && 'text-muted-foreground bg-muted/60'
        )}
      />
      {!disabled && (
        <div className='absolute inset-y-px right-px flex w-6 flex-col overflow-hidden rounded-r-md border-l'>
          <Button
            type='button'
            variant='ghost'
            tabIndex={-1}
            className='text-muted-foreground hover:text-foreground h-1/2 w-full rounded-none p-0'
            onClick={() => step(1)}
          >
            <ChevronUpIcon className='size-3' />
          </Button>
          <Button
            type='button'
            variant='ghost'
            tabIndex={-1}
            className='text-muted-foreground hover:text-foreground h-1/2 w-full rounded-none border-t p-0'
            onClick={() => step(-1)}
          >
            <ChevronDownIcon className='size-3' />
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * 评估规则编辑器：模板与周期共用同一个业务编辑器（口径统一）。
 * 采用「连续区间」模型——只编辑相邻档之间的边界，另一侧自动派生，连续性从结构上成立。
 * 顶部为可拖动的堆叠色条（快速调边界 + 结构预览），下方为逐档行内精编（区间表达式 · 代号 · 名称 · 备注）。
 */
export const EvaluationRuleEditor = ({ value, disabled = false, onChange }: EvaluationRuleEditorProps) => {
  const [previewOpen, setPreviewOpen] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<number | null>(null)

  // 以升序视图为准，边界索引与展示顺序一致；对合法数据本就有序，这里兜底再排一次。
  const sorted = useMemo(() => [...value.levels].sort((a, b) => a.minScore - b.minScore), [value.levels])
  const normalized = useMemo(() => normalizeEvaluationRuleDraft(value), [value])
  const validationMessage = useMemo(() => validateEvaluationRuleDraft(value), [value])

  const commit = (levels: EvaluationRating[]) => onChange({ ...value, levels })

  const patchLevel = (index: number, patch: Partial<EvaluationRating>) =>
    commit(sorted.map((item, i) => (i === index ? { ...item, ...patch } : item)))

  const updateRequiredSymbols = (symbol: string, checked: boolean) => {
    const current = value.commentRequiredRules.requiredRatingSymbols ?? []
    const next = checked ? [...current, symbol] : current.filter(item => item !== symbol)

    onChange({ ...value, commentRequiredRules: { requiredRatingSymbols: [...new Set(next)] } })
  }

  // ---- 色条拖动：把 clientX 换算成 0–100 分，落到相邻档之间的边界 ----

  const scoreFromClientX = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect()

    if (!rect) return 0

    return Math.round(((clientX - rect.left) / rect.width) * 100)
  }

  const startDrag = (boundaryIndex: number) => (event: React.PointerEvent) => {
    if (disabled) return
    event.preventDefault()
    setDragging(boundaryIndex)

    const move = (e: PointerEvent) => commit(setBoundary(sorted, boundaryIndex, scoreFromClientX(e.clientX)))

    const up = () => {
      setDragging(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className='flex flex-col gap-5'>
      {/* 顶部：可拖动的堆叠色条（结构预览 + 快速调边界） */}
      <div className='flex flex-col gap-2'>
        <div className='flex items-center justify-between'>
          <span className='text-muted-foreground text-xs'>分数分布</span>
          <Button variant='outline' size='sm' onClick={() => setPreviewOpen(true)}>
            <EyeIcon className='size-4' />
            预览
          </Button>
        </div>

        <div className='pt-6'>
          <div ref={barRef} className='relative h-9 w-full select-none rounded-md'>
            <div className='flex h-full overflow-hidden rounded-md border'>
              {sorted.map((rating, index) => {
                const color = getRatingColor(rating)
                const width = Math.max(0, rating.maxScore - rating.minScore)

                return (
                  <div
                    key={index}
                    className={cn('flex items-center justify-center text-xs font-semibold', color.bg, color.text)}
                    style={{ flexBasis: `${width}%` }}
                  >
                    {rating.symbol || '—'}
                  </div>
                )
              })}
            </div>

            {/* 分隔线手柄（相邻档之间），禁用态不渲染 */}
            {!disabled &&
              sorted.slice(0, -1).map((rating, index) => (
                <div
                  key={index}
                  role='slider'
                  aria-label={`${rating.symbol || '档'} 与下一档的分数边界`}
                  aria-valuenow={rating.maxScore}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  tabIndex={0}
                  onPointerDown={startDrag(index)}
                  onKeyDown={event => {
                    if (event.key === 'ArrowLeft') commit(setBoundary(sorted, index, rating.maxScore - 1))
                    if (event.key === 'ArrowRight') commit(setBoundary(sorted, index, rating.maxScore + 1))
                  }}
                  className='group absolute top-0 bottom-0 z-10 flex -translate-x-1/2 cursor-ew-resize flex-col items-center'
                  style={{ left: `${rating.maxScore}%` }}
                >
                  <span
                    className={cn(
                      'bg-foreground/70 group-hover:bg-primary absolute -top-6 rounded px-1.5 py-0.5 text-xs font-medium text-white transition-colors',
                      dragging === index && 'bg-primary'
                    )}
                  >
                    {rating.maxScore}
                  </span>
                  <span
                    className={cn(
                      'bg-foreground/50 group-hover:bg-primary h-full w-1 transition-colors',
                      dragging === index && 'bg-primary'
                    )}
                  />
                </div>
              ))}
          </div>

          <div className='text-muted-foreground mt-1.5 flex justify-between text-xs'>
            <span>0</span>
            <span>25</span>
            <span>50</span>
            <span>75</span>
            <span>100</span>
          </div>
        </div>
      </div>

      {/* 逐档行内精编：[下限只读] ≤ 分数 (< | ≤) [上限] · 等级代号 · 等级名称 · 删除 */}
      <div className='flex flex-col gap-3'>
        <div className='overflow-hidden rounded-lg border'>
          {/* 列头 */}
          <div className='text-muted-foreground bg-muted/40 grid grid-cols-[12rem_5rem_minmax(0,1fr)_1rem] items-center gap-3 border-b px-3 py-2 text-xs'>
            <span>
              分数子区间 <span className='text-destructive'>*</span>
            </span>
            <span>
              等级代号 <span className='text-destructive'>*</span>
            </span>
            <span>等级名称</span>
            <span />
          </div>

          {/* 各档行，行间分割线 */}
          <div className='divide-y'>
            {sorted.map((rating, index) => {
              const isLast = index === sorted.length - 1
              const color = getRatingColor(rating)

              return (
                <div
                  key={index}
                  className='grid grid-cols-[12rem_5rem_minmax(0,1fr)_2rem] items-center gap-3 px-3 py-2.5'
                >
                  {/* 区间表达式：min ≤ 分数 (< | ≤) max */}
                  <div className='flex items-center gap-2'>
                    <ScoreStepper value={rating.minScore} disabled onChange={() => {}} />
                    <span className='text-muted-foreground shrink-0 text-sm'>≤ 分数 {isLast ? '≤' : '<'}</span>
                    <ScoreStepper
                      value={rating.maxScore}
                      disabled={disabled || isLast}
                      onChange={next => commit(setBoundary(sorted, index, next))}
                    />
                  </div>

                  {/* 等级代号，带色点 */}
                  <div className='relative'>
                    <span
                      className={cn(
                        'absolute top-1/2 left-2.5 size-2 -translate-y-1/2 rounded-full border',
                        color.bg,
                        color.border
                      )}
                    />
                    <Input
                      value={rating.symbol}
                      placeholder='如 A'
                      disabled={disabled}
                      className='pl-6 font-medium'
                      onChange={event => patchLevel(index, { symbol: event.target.value.toUpperCase() })}
                    />
                  </div>

                  {/* 等级名称 */}
                  <Input
                    value={rating.name}
                    placeholder='请输入等级名称'
                    disabled={disabled}
                    onChange={event => patchLevel(index, { name: event.target.value })}
                  />

                  {/* 删除 */}
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    disabled={disabled || sorted.length <= 1}
                    onClick={() => commit(removeInterval(sorted, index))}
                  >
                    <Trash2Icon className='text-destructive size-4' />
                    <span className='sr-only'>删除该区间</span>
                  </Button>

                  {/* 备注：保留数据模型，弱化为整行次要输入 */}
                  <Input
                    value={rating.remark ?? ''}
                    placeholder='备注（可选，如：需绩效改进…）'
                    disabled={disabled}
                    className='text-muted-foreground col-span-3 h-8 border-dashed text-xs'
                    onChange={event => patchLevel(index, { remark: event.target.value })}
                  />
                </div>
              )
            })}
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-3'>
          <Button
            variant='link'
            size='sm'
            disabled={disabled}
            className='w-fit px-0'
            onClick={() => commit(addInterval(sorted.length ? sorted : [createEmptyRating()]))}
          >
            <PlusIcon className='size-4' />
            添加分数子区间
          </Button>
          {validationMessage ? <span className='text-destructive text-xs'>{validationMessage}</span> : null}
        </div>
      </div>

      <Field className='gap-2'>
        <FieldLabel>评语必填评级</FieldLabel>
        <div className='flex flex-wrap gap-3'>
          {normalized.levels.map(rating => (
            <label key={rating.symbol} className='flex items-center gap-1.5 text-sm'>
              <Checkbox
                checked={(value.commentRequiredRules.requiredRatingSymbols ?? []).includes(rating.symbol)}
                disabled={disabled}
                onCheckedChange={checked => updateRequiredSymbols(rating.symbol, Boolean(checked))}
              />
              {rating.symbol} {rating.name}
            </label>
          ))}
        </div>
      </Field>

      <EvaluationRulePreview open={previewOpen} onOpenChange={setPreviewOpen} levels={normalized.levels} />
    </div>
  )
}

const EvaluationRulePreview = ({
  open,
  onOpenChange,
  levels
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  levels: EvaluationRating[]
}) => {
  const [score, setScore] = useState(95)
  const barRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const boundedScore = clampScore(score)
  const active = findRatingByScore(levels, boundedScore)

  // 试算游标拖动：把 clientX 换算成 0–100 分（与编辑器色条同一套换算逻辑）
  const scoreFromClientX = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect()

    if (!rect) return boundedScore

    return clampScore(((clientX - rect.left) / rect.width) * 100)
  }

  const startDrag = (event: React.PointerEvent) => {
    event.preventDefault()
    setScore(scoreFromClientX(event.clientX))
    setDragging(true)

    const move = (e: PointerEvent) => setScore(scoreFromClientX(e.clientX))

    const up = () => {
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>预览</DialogTitle>
        </DialogHeader>

        <div className='flex flex-col gap-5'>
          <div className='flex items-center gap-2'>
            <span className='text-muted-foreground shrink-0 text-sm'>试算分数</span>
            <Input
              type='number'
              min={0}
              max={100}
              className='w-32'
              value={score}
              onChange={event => setScore(Number(event.target.value))}
            />
            <span className='text-muted-foreground text-sm'>命中：{active?.symbol ?? '-'} {active?.name ?? ''}</span>
          </div>

          {/* 试算色条：与编辑器顶部色条同款样式，游标可拖动 */}
          <div className='pt-6'>
            <div
              ref={barRef}
              onPointerDown={startDrag}
              className='relative h-9 w-full cursor-ew-resize touch-none select-none rounded-md'
            >
              <div className='flex h-full overflow-hidden rounded-md border'>
                {levels.map(rating => {
                  const color = getRatingColor(rating)
                  const width = Math.max(0, rating.maxScore - rating.minScore)

                  return (
                    <div
                      key={rating.symbol}
                      className={cn('flex items-center justify-center text-xs font-semibold', color.bg, color.text)}
                      style={{ flexBasis: `${width}%` }}
                    >
                      {rating.symbol}
                    </div>
                  )
                })}
              </div>

              {/* 试算游标 */}
              <div
                className='pointer-events-none absolute top-0 bottom-0 z-10 flex -translate-x-1/2 flex-col items-center'
                style={{ left: `${boundedScore}%` }}
              >
                <span
                  className={cn(
                    'absolute -top-6 rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-white transition-colors',
                    dragging ? 'bg-primary' : 'bg-foreground/70'
                  )}
                >
                  {boundedScore} 分 · {active?.symbol ?? '-'}
                </span>
                <span className={cn('h-full w-1 transition-colors', dragging ? 'bg-primary' : 'bg-foreground/60')} />
              </div>
            </div>

            <div className='text-muted-foreground mt-1.5 flex justify-between text-xs'>
              <span>0</span>
              <span>25</span>
              <span>50</span>
              <span>75</span>
              <span>100</span>
            </div>
          </div>

          <div className='divide-y'>
            {levels.map(rating => {
              const color = getRatingColor(rating)

              return (
                <div key={rating.symbol} className='flex gap-3 py-3'>
                  <Badge variant='outline' className={cn('h-fit min-w-12 justify-center', color.bg, color.text, color.border)}>
                    {rating.symbol}
                  </Badge>
                  <div className='min-w-0'>
                    <div className='font-medium'>{rating.name}</div>
                    <p className='text-muted-foreground mt-1 text-sm'>{rating.remark || '未配置备注'}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export {
  DEFAULT_COMMENT_REQUIRED_RULES,
  DEFAULT_EVALUATION_RATINGS,
  normalizeEvaluationRuleDraft,
  validateEvaluationRuleDraft
} from './utils'
