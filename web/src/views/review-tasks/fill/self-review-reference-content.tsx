'use client'

// 左侧参考区「员工自评」只读呈现：等级行 / 浅灰内容底，复用 EvaluationReferenceSection。
// 标题一律来自 SELF 表单快照的维度名 / 字段 title，不用字段类型名兜底。
import { useMemo } from 'react'

import {
  EvaluationContentSection,
  EvaluationLevelRow
} from '@/components/shared/EvaluationReferenceSection'
import { EvaluationAnswerContent } from '@/components/shared/markdown'
import type {
  PerfEvalFormSubform,
  PerfEvaluationDimensionAnswer,
  PerfPerformanceLevel
} from '@/lib/perf-api'

export type SelfReviewReferenceContentProps = {
  selfDimensionAnswers: PerfEvaluationDimensionAnswer[]
  /** SELF 子表单快照，用于解析维度名与字段标题 */
  selfSubforms?: PerfEvalFormSubform[]
  notice?: string
}

const answerValue = (value: unknown) => {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(String).join('、')
  if (value != null) return JSON.stringify(value)

  return '—'
}

const isLevel = (value: string): value is PerfPerformanceLevel =>
  value === 'S' || value === 'A' || value === 'B' || value === 'C'

const buildTitleIndex = (selfSubforms: PerfEvalFormSubform[] | undefined) => {
  const dimensionNames = new Map<string, string>()
  const fieldTitles = new Map<string, string>()

  for (const subform of selfSubforms ?? []) {
    for (const dimension of subform.dimensions ?? []) {
      dimensionNames.set(dimension.key, dimension.name)
      for (const field of dimension.fields ?? []) {
        fieldTitles.set(field.key, field.title)
      }
    }
  }

  return { dimensionNames, fieldTitles }
}

const SelfReviewReferenceContent = ({
  selfDimensionAnswers,
  selfSubforms,
  notice
}: SelfReviewReferenceContentProps) => {
  const { dimensionNames, fieldTitles } = useMemo(() => buildTitleIndex(selfSubforms), [selfSubforms])

  const items = useMemo(
    () =>
      selfDimensionAnswers.flatMap(dimension => {
        const dimensionTitle = dimensionNames.get(dimension.dimensionKey) ?? dimension.dimensionKey

        return [
          ...(dimension.rawLevel
            ? [
                {
                  key: `dimension:${dimension.id}`,
                  title: dimensionTitle,
                  type: 'RATING' as const,
                  value: dimension.rawLevel
                }
              ]
            : dimension.rawScore != null
              ? [
                  {
                    key: `dimension:${dimension.id}`,
                    title: dimensionTitle,
                    type: 'SCORE' as const,
                    value: dimension.rawScore
                  }
                ]
              : []),
          ...dimension.fields.map(field => ({
            key: `field:${field.id}`,
            title: fieldTitles.get(field.fieldKey) ?? field.fieldKey,
            type: field.fieldType,
            value: answerValue(field.value)
          }))
        ]
      }),
    [selfDimensionAnswers, dimensionNames, fieldTitles]
  )

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
