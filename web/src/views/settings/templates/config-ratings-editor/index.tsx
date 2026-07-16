'use client'

import { useMemo, useState } from 'react'

import { ChevronDownIcon, ChevronUpIcon, EyeIcon } from 'lucide-react'

import type { PerfConfigTemplateRating, PerfPerformanceLevel } from '@/lib/perf-api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import {
  ConfigRuleSectionChrome,
  ConfigRuleTable,
  configRuleNestedRowClassName
} from '../config-rule-table'
import { ConfigRatingsPreviewDialog } from './preview-dialog'
import { RatingScoreBar } from './score-bar'
import {
  applyBoundary,
  clampScore,
  getRatingColor,
  patchRatingBySymbol,
  sortRatingsAscending
} from './utils'

const RATINGS_GRID = 'grid-cols-[12rem_4rem_minmax(0,1fr)_5rem_4.5rem]'

type Props = {
  ratings: PerfConfigTemplateRating[]
  editable: boolean
  onChange: (next: PerfConfigTemplateRating[]) => void
}

const ScoreStepper = ({
  value,
  onChange,
  disabled = false
}: {
  value: number
  onChange: (value: number) => void
  disabled?: boolean
}) => {
  const step = (delta: number) => onChange(clampScore(value + delta))

  return (
    <div className='relative w-16'>
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
 * 配置模板 S/A/B/C 评级编辑：色条调边界 + 行内精编（含映射分、评语必填）。
 * 符号与档位数固定，连续性由边界联动保证。
 */
export const ConfigRatingsEditor = ({ ratings, editable, onChange }: Props) => {
  const [previewOpen, setPreviewOpen] = useState(false)
  const sorted = useMemo(() => sortRatingsAscending(ratings), [ratings])

  const patch = (symbol: PerfPerformanceLevel, next: Partial<PerfConfigTemplateRating>) =>
    onChange(patchRatingBySymbol(ratings, symbol, next))

  return (
    <section className='flex flex-col gap-5'>
      <ConfigRuleSectionChrome
        title='S/A/B/C 评级'
        description='符号和顺序固定；拖色条或改上限调整连续区间，映射分需落在所属区间。'
      />

      <div className='flex flex-col gap-2'>
        <div className='flex items-center justify-between'>
          <span className='text-muted-foreground text-xs'>分数分布</span>
          <Button type='button' variant='outline' size='sm' onClick={() => setPreviewOpen(true)}>
            <EyeIcon className='size-4' />
            预览
          </Button>
        </div>
        <RatingScoreBar ratings={ratings} disabled={!editable} onChange={onChange} />
      </div>

      <ConfigRuleTable
        gridClassName={RATINGS_GRID}
        headers={[
          <>
            分数子区间 <span className='text-destructive'>*</span>
          </>,
          '代号',
          '等级名称',
          '映射分',
          '评语必填'
        ]}
      >
        {sorted.map((rating, index) => {
          const isLast = index === sorted.length - 1
          const color = getRatingColor({
            minScore: Number(rating.minScore),
            maxScore: Number(rating.maxScore)
          })

          return (
            <div key={rating.symbol} className='flex flex-col gap-2 px-3 py-2.5'>
              <div className={configRuleNestedRowClassName(RATINGS_GRID)}>
                <div className='flex items-center gap-2'>
                  <ScoreStepper value={Number(rating.minScore)} disabled onChange={() => {}} />
                  <span className='text-muted-foreground shrink-0 text-sm'>
                    ≤ 分数 {isLast ? '≤' : '<'}
                  </span>
                  <ScoreStepper
                    value={Number(rating.maxScore)}
                    disabled={!editable || isLast}
                    onChange={next => onChange(applyBoundary(sorted, index, next))}
                  />
                </div>

                <div className='relative'>
                  <span
                    className={cn(
                      'absolute top-1/2 left-2.5 size-2 -translate-y-1/2 rounded-full border',
                      color.bg,
                      color.border
                    )}
                  />
                  <Input value={rating.symbol} disabled className='pl-6 font-medium' />
                </div>

                <Input
                  value={rating.name}
                  placeholder='请输入等级名称'
                  disabled={!editable}
                  onChange={event => patch(rating.symbol, { name: event.target.value })}
                />

                <Input
                  type='number'
                  value={rating.mappingScore}
                  disabled={!editable}
                  onChange={event => patch(rating.symbol, { mappingScore: event.target.value })}
                />

                <label className='flex items-center justify-start'>
                  <Checkbox
                    checked={rating.commentRequired}
                    disabled={!editable}
                    onCheckedChange={checked =>
                      patch(rating.symbol, { commentRequired: Boolean(checked) })
                    }
                  />
                  <span className='sr-only'>{rating.symbol} 评语必填</span>
                </label>
              </div>

              <Input
                value={rating.description ?? ''}
                placeholder='说明（可选）'
                disabled={!editable}
                className='text-muted-foreground h-8 border-dashed text-xs'
                onChange={event => patch(rating.symbol, { description: event.target.value })}
              />
            </div>
          )
        })}
      </ConfigRuleTable>

      <ConfigRatingsPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        ratings={ratings}
      />
    </section>
  )
}
