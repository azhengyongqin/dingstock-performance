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
  PerfEvaluationItemResult,
  PerfPerformanceLevel
} from '@/lib/perf-api'

export type SelfReviewReferenceContentProps = {
  selfItems: PerfEvaluationItemResult[]
  selfDimensionAnswers?: PerfEvaluationDimensionAnswer[]
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

const TYPE_FALLBACK: Record<string, string> = {
  RATING: '评级',
  SCORE: '评分',
  MARKDOWN: '富文本',
  LONG_TEXT: '文本',
  SHORT_TEXT: '短文本',
  ATTACHMENT: '附件',
  LINK: '链接',
  SINGLE_SELECT: '单选',
  MULTI_SELECT: '多选'
}

const resultValue = (item: PerfEvaluationItemResult) => {
  if (item.rawLevel) return item.rawLevel
  if (item.rawScore != null) return String(item.rawScore)
  if (typeof item.value === 'string') return item.value
  if (Array.isArray(item.value)) return item.value.map(String).join('、')
  if (item.value != null) return JSON.stringify(item.value)

  return '—'
}

const itemTitle = (item: PerfEvaluationItemResult, index: number) => {
  const match = item.itemKey.match(/:(\d+:\d+)$/)
  const suffix = match?.[1]

  if (suffix && TITLE_BY_SUFFIX[suffix]) return TITLE_BY_SUFFIX[suffix]

  return TYPE_FALLBACK[item.itemType] ?? `表单字段 ${index + 1}`
}

const isLevel = (value: string): value is PerfPerformanceLevel =>
  value === 'S' || value === 'A' || value === 'B' || value === 'C'

const SelfReviewReferenceContent = ({ selfItems, selfDimensionAnswers = [], notice }: SelfReviewReferenceContentProps) => {
  const items = useMemo(
    () => {
      // 三类填写链路均消费维度/字段作答；旧 items 仅供后续消费者迁移前兼容只读数据。
      const visibleItems: PerfEvaluationItemResult[] = selfDimensionAnswers.length
        ? selfDimensionAnswers.flatMap(dimension => [
            ...(dimension.rawLevel
              ? [{
                  id: dimension.id,
                  submissionId: dimension.submissionId,
                  subformKey: dimension.subformKey,
                  dimensionKey: dimension.dimensionKey,
                  itemKey: dimension.dimensionKey,
                  itemType: 'RATING' as const,
                  rawLevel: dimension.rawLevel
                }]
              : []),
            ...dimension.fields.map(field => ({
              id: field.id,
              submissionId: dimension.submissionId,
              subformKey: dimension.subformKey,
              dimensionKey: dimension.dimensionKey,
              itemKey: field.fieldKey,
              itemType: field.fieldType,
              value: field.value
            }))
          ])
        : selfItems

      return visibleItems.map((item, index) => ({
        item,
        title: itemTitle(item, index),
        value: resultValue(item)
      }))
    },
    [selfDimensionAnswers, selfItems]
  )

  if (items.length === 0) {
    return <p className='text-muted-foreground text-sm'>员工尚无生效自评</p>
  }

  return (
    <div className='space-y-6'>
      {notice && <p className='text-muted-foreground text-xs'>{notice}</p>}

      {items.map(({ item, title, value }) =>
        item.itemType === 'RATING' && isLevel(value) ? (
          <EvaluationLevelRow key={item.id} title={title} level={value} />
        ) : (
          <EvaluationContentSection key={item.id} title={title}>
            <EvaluationAnswerContent type={item.itemType} value={value} />
          </EvaluationContentSection>
        )
      )}
    </div>
  )
}

export default SelfReviewReferenceContent
