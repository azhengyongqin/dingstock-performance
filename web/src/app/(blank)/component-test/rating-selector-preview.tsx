'use client'

/**
 * 组件实验台：RatingSelector（自评 / 360° / 上级评估共用）。
 */
import { useState } from 'react'

import { RatingSelector } from '@/components/shared/RatingSelector'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldTitle } from '@/components/ui/field'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import type { PerfConfigTemplateRating, PerfPerformanceLevel } from '@/lib/perf-api'
import { cn } from '@/lib/utils'

const SAMPLE_RATINGS: PerfConfigTemplateRating[] = [
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

const SOFT: Record<PerfPerformanceLevel, string> = {
  S: 'bg-purple-100 text-purple-700 border-purple-200',
  A: 'bg-green-100 text-green-700 border-green-200',
  B: 'bg-amber-100 text-amber-700 border-amber-200',
  C: 'bg-red-100 text-red-700 border-red-200'
}

export default function RatingSelectorPreview() {
  const [performance, setPerformance] = useState<PerfPerformanceLevel | null>('B')
  const [values, setValues] = useState<PerfPerformanceLevel | null>(null)
  const [comment, setComment] = useState('')

  return (
    <div className='flex flex-col gap-4'>
      <Card>
        <CardHeader>
          <CardTitle>RatingSelector</CardTitle>
          <CardDescription>
            员工自评与 360° 环评的 RATING 评估项共用此组件；选中浅色，hover 白底介绍面板。
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-3'>
          <div className='flex flex-wrap gap-2'>
            {SAMPLE_RATINGS.map(rating => (
              <Badge key={rating.symbol} variant='outline' className={cn(SOFT[rating.symbol])}>
                {rating.symbol} · {rating.name}
              </Badge>
            ))}
          </div>
          <FieldDescription>Hover 各档可查看区间、映射分、评语要求与说明。</FieldDescription>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className='flex items-center gap-2'>
            <span aria-hidden className='bg-primary h-4 w-1 rounded-full' />
            <CardTitle className='text-base'>业绩</CardTitle>
          </div>
        </CardHeader>
        <CardContent className='flex flex-col gap-5'>
          <Field className='gap-3'>
            <FieldTitle>
              业绩评分
              <span aria-hidden className='text-destructive ml-1'>
                *
              </span>
            </FieldTitle>
            <RatingSelector
              aria-label='业绩评分'
              value={performance}
              onChange={setPerformance}
              ratings={SAMPLE_RATINGS}
            />
          </Field>
          <div className='flex flex-col gap-2'>
            <span className='text-sm font-medium'>业绩评价</span>
            <Textarea
              rows={3}
              placeholder='请输入业绩评价'
              value={comment}
              onChange={event => setComment(event.target.value)}
            />
          </div>

          <Separator />

          <div className='flex items-center gap-2'>
            <span aria-hidden className='bg-primary h-4 w-1 rounded-full' />
            <span className='text-base font-semibold'>价值观</span>
          </div>
          <Field className='gap-3'>
            <FieldTitle>
              价值观评分
              <span aria-hidden className='text-destructive ml-1'>
                *
              </span>
            </FieldTitle>
            <RatingSelector
              aria-label='价值观评分'
              value={values}
              onChange={setValues}
              ratings={SAMPLE_RATINGS}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>当前状态</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className='bg-muted overflow-x-auto rounded-md p-3 text-xs'>
            {JSON.stringify({ performance, values, commentLength: comment.length }, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}
