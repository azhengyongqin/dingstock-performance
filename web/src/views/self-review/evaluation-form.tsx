'use client'

// 动态评估表单：大标题/说明固定在上方，色块维度标题吸顶，其下表单项在独立滚动区内。
// 字号阶梯 B：主标题 text-base；维度详情 text-xs。
import { Badge } from '@/components/ui/badge'
import { RatingSelector } from '@/components/shared/RatingSelector'
import { ScoreSelector } from '@/components/shared/ScoreSelector'
import { Field, FieldError } from '@/components/ui/field'
import type { PerfConfigTemplateRating, PerfEvalFormSubform } from '@/lib/perf-api'
import { cn } from '@/lib/utils'

import EvaluationItemField from './evaluation-item-field'
import {
  levelForDimensionAnswer,
  type EvaluationAnswers,
  type EvaluationItemAnswer
} from './evaluation-form-types'

export type EvaluationFormProps = {
  subforms: PerfEvalFormSubform[]
  answers: EvaluationAnswers
  onAnswerChange: (itemKey: string, answer: EvaluationItemAnswer) => void
  errors?: Record<string, string>
  disabled?: boolean
  ratings?: PerfConfigTemplateRating[]
  className?: string
}

const DimensionBlock = ({
  dimension,
  answers,
  onAnswerChange,
  errors,
  disabled,
  ratings
}: {
  dimension: PerfEvalFormSubform['dimensions'][number]
  answers: EvaluationAnswers
  onAnswerChange: (itemKey: string, answer: EvaluationItemAnswer) => void
  errors?: Record<string, string>
  disabled?: boolean
  ratings?: PerfConfigTemplateRating[]
}) => {
  const dimensionAnswer = answers[dimension.key]
  const level = levelForDimensionAnswer(dimension, dimensionAnswer, ratings ?? [])
  const fields = dimension.fields ?? []

  return (
    <section className='flex flex-col'>
    {/* 实底吸顶：铺满滚动区横向，避免半透明/顶间距透出下层内容 */}
    <div className='bg-card sticky top-0 z-10 -mx-5 px-5 pt-4 pb-3 sm:-mx-6 sm:px-6'>
      <div className='space-y-1'>
        {/* 色条与标题同一行 items-center，避免 mt/h 与 text-xs 行高错位 */}
        <div className='flex items-center gap-2'>
          <span className='bg-primary h-3.5 w-1 shrink-0 rounded-full' aria-hidden />
          <div className='flex min-w-0 flex-wrap items-center gap-2'>
            <h2 className='text-xs font-semibold'>{dimension.name}</h2>
            {dimension.weight != null && <Badge variant='outline'>占比 {dimension.weight}%</Badge>}
            {dimension.isCore && <Badge variant='secondary'>核心</Badge>}
          </div>
        </div>
        {dimension.description && (
          <p className='text-muted-foreground pl-3 text-sm'>{dimension.description}</p>
        )}
      </div>
    </div>
    <div className='flex flex-col gap-5 pb-8 pl-4'>
      {dimension.type === 'SCORING' && (
        <Field data-invalid={!!errors?.[dimension.key]} className='gap-2'>
          {dimension.scoringMethod === 'RATING' ? (
            <RatingSelector
              aria-label={dimension.name}
              value={dimensionAnswer?.rawLevel ?? null}
              onChange={rawLevel => onAnswerChange(dimension.key, { rawLevel })}
              disabled={disabled}
            />
          ) : (
            <ScoreSelector
              aria-label={dimension.name}
              value={dimensionAnswer?.rawScoreText ?? ''}
              onChange={rawScoreText => onAnswerChange(dimension.key, { rawScoreText })}
              disabled={disabled}
            />
          )}
          {errors?.[dimension.key] && <FieldError>{errors[dimension.key]}</FieldError>}
        </Field>
      )}
      {fields.map(field => {
        const conditionalRequired =
          field.requiredRule === 'CONDITIONAL' && level != null && (field.requiredLevels ?? []).includes(level)

        const required = field.requiredRule === 'ALWAYS' || conditionalRequired

        return (
          <div key={field.key} className='flex flex-col gap-1.5'>
            {conditionalRequired && <span className='text-destructive text-xs'>选择 {level} 时必填</span>}
            <EvaluationItemField
              item={{ ...field, required }}
              answer={answers[field.key]}
              onChange={answer => onAnswerChange(field.key, answer)}
              disabled={disabled}
              error={errors?.[field.key]}
            />
          </div>
        )
      })}
    </div>
  </section>
  )
}

const EvaluationForm = ({
  subforms,
  answers,
  onAnswerChange,
  errors,
  disabled,
  ratings,
  className
}: EvaluationFormProps) => {
  // 单子表单：大标题固定，仅维度表单区滚动并吸顶
  if (subforms.length === 1) {
    const subform = subforms[0]

    return (
      <div className={cn('flex h-full min-h-0 flex-col', className)}>
        <div className='shrink-0 px-5 pt-5 sm:px-6 sm:pt-6'>
          <h2 className='text-base font-semibold'>{subform.title}</h2>
          {subform.description && <p className='text-muted-foreground mt-1 text-sm'>{subform.description}</p>}
        </div>
        {/* 顶 padding 放进吸顶条，避免 sticky top-0 上方留出透底空隙 */}
        <div className='h-0 min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6'>
          {subform.dimensions.map(dimension => (
            <DimensionBlock
              key={dimension.key}
              dimension={dimension}
              answers={answers}
              onAnswerChange={onAnswerChange}
              errors={errors}
              disabled={disabled}
              ratings={ratings}
            />
          ))}
        </div>
      </div>
    )
  }

  // 多子表单：整区滚动，子表单标题与色块维度标题均吸顶
  return (
    <div className={cn('h-full min-h-0 overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6', className)}>
      {subforms.map(subform => (
        <div key={subform.key} className='flex flex-col'>
          <div className='bg-card sticky top-0 z-20 -mx-5 border-b px-5 pt-5 pb-3 sm:-mx-6 sm:px-6'>
            <h2 className='text-base font-semibold'>{subform.title}</h2>
            {subform.description && <p className='text-muted-foreground mt-1 text-sm'>{subform.description}</p>}
          </div>
          {subform.dimensions.map(dimension => (
            <DimensionBlock
              key={dimension.key}
              dimension={dimension}
              answers={answers}
              onAnswerChange={onAnswerChange}
              errors={errors}
              disabled={disabled}
              ratings={ratings}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export default EvaluationForm
