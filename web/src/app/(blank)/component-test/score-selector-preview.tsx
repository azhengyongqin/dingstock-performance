'use client'

/**
 * 组件实验台：ScoreSelector（自评 / 360° / 上级评估 SCORE 项共用）。
 */
import { useState } from 'react'

import { ScoreSelector } from '@/components/shared/ScoreSelector'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldTitle } from '@/components/ui/field'
import type { PerfConfigTemplateRating } from '@/lib/perf-api'

const SAMPLE_RATINGS: PerfConfigTemplateRating[] = [
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

export default function ScoreSelectorPreview() {
  const [score, setScore] = useState('72')
  const [empty, setEmpty] = useState('')

  return (
    <div className='flex flex-col gap-4'>
      <Card>
        <CardHeader>
          <CardTitle>ScoreSelector</CardTitle>
          <CardDescription>
            整数 0–100 +「分」+ 命中等级徽章；Label 与输入同一行（评估表单 SCORE 项布局）。
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-6'>
          <Field className='gap-2'>
            <div className='flex w-full items-center justify-between gap-x-3'>
              <FieldTitle className='shrink-0'>目标完成度</FieldTitle>
              <ScoreSelector value={score} onChange={setScore} ratings={SAMPLE_RATINGS} aria-label='目标完成度' />
            </div>
            <FieldDescription>hover 等级徽章可查看区间与说明</FieldDescription>
          </Field>

          <Field className='gap-2'>
            <div className='flex w-full items-center justify-between gap-x-3'>
              <FieldTitle className='shrink-0'>未填写</FieldTitle>
              <ScoreSelector value={empty} onChange={setEmpty} ratings={SAMPLE_RATINGS} aria-label='未填写' />
            </div>
          </Field>

          <Field className='gap-2'>
            <div className='flex w-full items-center justify-between gap-x-3'>
              <FieldTitle className='shrink-0'>只读</FieldTitle>
              <ScoreSelector
                value='95'
                onChange={() => undefined}
                disabled
                ratings={SAMPLE_RATINGS}
                aria-label='只读'
              />
            </div>
          </Field>
        </CardContent>
      </Card>
    </div>
  )
}
