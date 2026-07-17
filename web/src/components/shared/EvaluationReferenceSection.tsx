'use client'

/**
 * 参考区通用板块：
 * - EvaluationLevelRow：标题与等级徽章同一行两端对齐（自评等级 / 360°维度等级）
 * - EvaluationContentSection：标题 + 浅灰内容底（评语、总结等）
 */
import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import type { PerfPerformanceLevel } from '@/lib/perf-api'
import { cn } from '@/lib/utils'

export const EVALUATION_LEVEL_STYLES: Record<PerfPerformanceLevel, string> = {
  S: 'border-violet-200 bg-violet-50 text-violet-700',
  A: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  B: 'border-sky-200 bg-sky-50 text-sky-700',
  C: 'border-amber-200 bg-amber-50 text-amber-700'
}

export const EVALUATION_LEVEL_NAME: Record<PerfPerformanceLevel, string> = {
  S: '卓越',
  A: '优秀',
  B: '符合预期',
  C: '不符预期'
}

type EvaluationLevelRowProps = {
  title: string
  level: PerfPerformanceLevel
  /** 默认用 EVALUATION_LEVEL_NAME */
  levelLabel?: string
  className?: string
}

/** 标题左、等级右，同一行两端对齐（详情级 text-xs） */
export function EvaluationLevelRow({ title, level, levelLabel, className }: EvaluationLevelRowProps) {
  const label = levelLabel ?? EVALUATION_LEVEL_NAME[level]

  return (
    <section className={cn('flex items-center justify-between gap-3', className)}>
      <h2 className='min-w-0 truncate text-xs font-semibold'>{title}</h2>
      <div className='flex shrink-0 items-center gap-2'>
        <Badge variant='outline' className={cn('text-xs tabular-nums', EVALUATION_LEVEL_STYLES[level])}>
          {level}
        </Badge>
        {label ? <span className='text-muted-foreground text-xs'>{label}</span> : null}
      </div>
    </section>
  )
}

type EvaluationContentSectionProps = {
  title: string
  children: ReactNode
  className?: string
}

/** 标题在上，浅灰内容底承载正文（详情级 text-xs） */
export function EvaluationContentSection({ title, children, className }: EvaluationContentSectionProps) {
  return (
    <section className={cn('space-y-2', className)}>
      <h2 className='text-xs font-semibold'>{title}</h2>
      <div className='bg-muted/50 rounded-xl px-4 py-3.5'>{children}</div>
    </section>
  )
}
