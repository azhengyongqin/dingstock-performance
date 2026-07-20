'use client'

import { useRef, useState } from 'react'

import { findRatingByScore } from '@/components/shared/evaluation-rule-editor/utils'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import {
  clampScore,
  getRatingColor,
  scoreFromClientX,
  sortRatingsAscending,
  toEvaluationLevels,
  type ConfigRatingDraft
} from './utils'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  ratings: ConfigRatingDraft[]
}

/** 分数试算预览：拖色条游标或输入分数，查看命中等级与说明。 */
export const ConfigRatingsPreviewDialog = ({ open, onOpenChange, ratings }: Props) => {
  const [score, setScore] = useState(85)
  const barRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const sorted = sortRatingsAscending(ratings)
  const levels = toEvaluationLevels(sorted)
  const boundedScore = clampScore(score)
  const active = findRatingByScore(levels, boundedScore)

  const startDrag = (event: React.PointerEvent) => {
    event.preventDefault()
    const rect = barRef.current?.getBoundingClientRect()

    setScore(scoreFromClientX(event.clientX, rect))
    setDragging(true)

    const move = (e: PointerEvent) => {
      setScore(scoreFromClientX(e.clientX, barRef.current?.getBoundingClientRect()))
    }

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
          <DialogTitle>分数试算预览</DialogTitle>
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
            <span className='text-muted-foreground text-sm'>
              命中：{active?.symbol ?? '-'} {active?.name ?? ''}
            </span>
          </div>

          <div className='pt-6'>
            <div
              ref={barRef}
              onPointerDown={startDrag}
              className='relative h-9 w-full cursor-ew-resize touch-none rounded-md select-none'
            >
              <div className='flex h-full overflow-hidden rounded-md border'>
                {sorted.map(rating => {
                  const color = getRatingColor({
                    minScore: Number(rating.minScore),
                    maxScore: Number(rating.maxScore)
                  })

                  const width = Math.max(0, Number(rating.maxScore) - Number(rating.minScore))

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
            {sorted.map(rating => {
              const color = getRatingColor({
                minScore: Number(rating.minScore),
                maxScore: Number(rating.maxScore)
              })

              const hit = active?.symbol === rating.symbol

              return (
                <div key={rating.symbol} className={cn('flex gap-3 py-3', hit && 'bg-primary/5 -mx-2 rounded-md px-2')}>
                  <Badge
                    variant='outline'
                    className={cn('h-fit min-w-12 justify-center', color.bg, color.text, color.border)}
                  >
                    {rating.symbol}
                  </Badge>
                  <div className='min-w-0'>
                    <div className='flex flex-wrap items-center gap-2 font-medium'>
                      <span>{rating.name}</span>
                      <span className='text-muted-foreground text-xs font-normal'>
                        {rating.minScore}–{rating.maxScore} · 映射 {rating.mappingScore}
                      </span>
                    </div>
                    <p className='text-muted-foreground mt-1 text-sm'>{rating.description || '未配置说明'}</p>
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
