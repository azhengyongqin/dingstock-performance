'use client'

// 左侧参考区「员工自评」只读呈现：等级行 / 浅灰内容底，复用 EvaluationReferenceSection。
import { useMemo } from 'react'

import {
  EvaluationContentSection,
  EvaluationLevelRow
} from '@/components/shared/EvaluationReferenceSection'
import { EvaluationAnswerContent } from '@/components/shared/markdown'
import type {
  PerfEvaluationDimensionAnswer,
  PerfFormFieldType,
  PerfPerformanceLevel
} from '@/lib/perf-api'

export type SelfReviewReferenceContentProps = {
  selfDimensionAnswers: PerfEvaluationDimensionAnswer[]
  notice?: string
}

/** 默认自评表单项 key 后缀 → 标题；后续应由自评表单快照 title 覆盖。 */
const TITLE_BY_SUFFIX: Record<string, string> = {
  '0:0': '自评等级',
  '1:0': '自评总结',
  '1:1': '半年度总结',
  '1:2': '下个半年规划',
  '1:3': '需要的支持和帮助',
  '1:4': '补充附件',
  '1:5': '补充链接'
}

const TYPE_FALLBACK: Record<PerfFormFieldType, string> = {
  MARKDOWN: '富文本',
  LONG_TEXT: '文本',
  SHORT_TEXT: '短文本',
  ATTACHMENT: '附件',
  LINK: '链接',
  SINGLE_SELECT: '单选',
  MULTI_SELECT: '多选'
}

const answerValue = (value: unknown) => {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(String).join('、')
  if (value != null) return JSON.stringify(value)

  return '—'
}

const fieldTitle = (fieldKey: string, type: PerfFormFieldType, index: number) => {
  const match = fieldKey.match(/:(\d+:\d+)$/)
  const suffix = match?.[1]

  if (suffix && TITLE_BY_SUFFIX[suffix]) return TITLE_BY_SUFFIX[suffix]

  return TYPE_FALLBACK[type] ?? `表单字段 ${index + 1}`
}

const isLevel = (value: string): value is PerfPerformanceLevel =>
  value === 'S' || value === 'A' || value === 'B' || value === 'C'

const SelfReviewReferenceContent = ({ selfDimensionAnswers, notice }: SelfReviewReferenceContentProps) => {
  const items = useMemo(() => selfDimensionAnswers.flatMap(dimension => [
    ...(dimension.rawLevel
      ? [{ key: `dimension:${dimension.id}`, title: '自评等级', type: 'RATING' as const, value: dimension.rawLevel }]
      : dimension.rawScore != null
        ? [{ key: `dimension:${dimension.id}`, title: '自评分数', type: 'SCORE' as const, value: dimension.rawScore }]
        : []),
    ...dimension.fields.map((field, index) => ({
      key: `field:${field.id}`,
      title: fieldTitle(field.fieldKey, field.fieldType, index),
      type: field.fieldType,
      value: answerValue(field.value)
    }))
  ]), [selfDimensionAnswers])

  if (items.length === 0) {
    return <p className='text-muted-foreground text-sm'>员工尚无生效自评</p>
  }

  return (
    <div className='space-y-6'>
      {notice && <p className='text-muted-foreground text-xs'>{notice}</p>}

      {items.map(({ key, title, type, value }) =>
        type === 'RATING' && isLevel(value) ? (
          <EvaluationLevelRow key={key} title={title} level={value} />
        ) : (
          <EvaluationContentSection key={key} title={title}>
            <EvaluationAnswerContent type={type} value={value} />
          </EvaluationContentSection>
        )
      )}
    </div>
  )
}

export default SelfReviewReferenceContent
