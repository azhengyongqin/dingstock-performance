'use client'

/**
 * 组件实验台：PerformanceLevelBadge（只读等级 + 系统色 + Hover 说明）。
 */
import { PerformanceLevelBadge } from '@/components/shared/PerformanceLevelBadge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const LEVELS = ['S', 'A', 'B', 'C'] as const

export default function PerformanceLevelBadgePreview() {
  return (
    <div className='flex flex-col gap-4'>
      <Card>
        <CardHeader>
          <CardTitle>PerformanceLevelBadge</CardTitle>
          <CardDescription>
            与 RatingSelector / ScoreSelector 共用色阶；hover 展示区间、映射分与说明。用于结果确认等只读场景。
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-6'>
          <div className='space-y-2'>
            <p className='text-muted-foreground text-sm'>sm · 维度行</p>
            <div className='flex flex-wrap items-center gap-3'>
              {LEVELS.map(level => (
                <PerformanceLevelBadge key={level} level={level} size='sm' />
              ))}
            </div>
          </div>
          <div className='space-y-2'>
            <p className='text-muted-foreground text-sm'>md · 摘要卡（plain，无背景）</p>
            <div className='flex flex-wrap items-center gap-3'>
              {LEVELS.map(level => (
                <PerformanceLevelBadge key={level} level={level} size='md' variant='plain' />
              ))}
            </div>
          </div>
          <div className='space-y-2'>
            <p className='text-muted-foreground text-sm'>非法等级降级</p>
            <PerformanceLevelBadge level='D' />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
