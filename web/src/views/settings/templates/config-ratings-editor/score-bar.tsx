'use client'

import { useRef, useState } from 'react'

import { cn } from '@/lib/utils'

import {
  applyBoundary,
  getRatingColor,
  scoreFromClientX,
  sortRatingsAscending,
  type ConfigRatingDraft
} from './utils'

type RatingScoreBarProps = {
  ratings: ConfigRatingDraft[]
  disabled?: boolean
  onChange: (next: ConfigRatingDraft[]) => void
}

/** 堆叠色条 + 边界手柄：固定四档，连续性由边界联动保证。 */
export const RatingScoreBar = ({ ratings, disabled = false, onChange }: RatingScoreBarProps) => {
  const barRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const sorted = sortRatingsAscending(ratings)

  const startBoundaryDrag = (boundaryIndex: number) => (event: React.PointerEvent) => {
    if (disabled) return
    event.preventDefault()
    setDragging(boundaryIndex)

    const move = (e: PointerEvent) => {
      const rect = barRef.current?.getBoundingClientRect()

      onChange(applyBoundary(sorted, boundaryIndex, scoreFromClientX(e.clientX, rect)))
    }

    const up = () => {
      setDragging(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className='pt-6'>
      <div ref={barRef} className='relative h-9 w-full select-none rounded-md'>
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

        {!disabled &&
          sorted.slice(0, -1).map((rating, index) => (
            <div
              key={rating.symbol}
              role='slider'
              aria-label={`${rating.symbol} 与下一档的分数边界`}
              aria-valuenow={Number(rating.maxScore)}
              aria-valuemin={0}
              aria-valuemax={100}
              tabIndex={0}
              onPointerDown={startBoundaryDrag(index)}
              onKeyDown={event => {
                if (event.key === 'ArrowLeft') {
                  onChange(applyBoundary(sorted, index, Number(rating.maxScore) - 1))
                }

                if (event.key === 'ArrowRight') {
                  onChange(applyBoundary(sorted, index, Number(rating.maxScore) + 1))
                }
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
  )
}
