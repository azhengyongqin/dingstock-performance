'use client'

// 动态评估表单：大标题/说明固定在上方，色块维度标题吸顶，其下表单项在独立滚动区内。
import { Badge } from '@/components/ui/badge'
import type { PerfConfigTemplateRating, PerfEvalFormSubform } from '@/lib/perf-api'
import { cn } from '@/lib/utils'

import EvaluationItemField from './evaluation-item-field'
import type { EvaluationAnswers, EvaluationItemAnswer } from './evaluation-form-types'

/** PROMOTION 标题按实际下发的受众标注，明确员工材料与 Leader 结论的填写边界。 */
const subformTitle = (subform: PerfEvalFormSubform) => {
  if (subform.type !== 'PROMOTION') return subform.title
  const isLeaderSection = subform.dimensions.length > 0 && subform.dimensions.every(item => item.audience === 'LEADER')

  return isLeaderSection ? '晋升评估（Leader 填写）' : '晋升评估（员工填写）'
}

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
}) => (
  <section className='flex flex-col'>
    {/* 实底吸顶：铺满滚动区横向，避免半透明/顶间距透出下层内容 */}
    <div className='bg-card sticky top-0 z-10 -mx-5 px-5 pt-4 pb-3 sm:-mx-6 sm:px-6'>
      <div className='flex items-start gap-3'>
        <span className='bg-primary mt-1 h-5 w-1 shrink-0 rounded-full' aria-hidden />
        <div className='min-w-0'>
          <div className='flex flex-wrap items-center gap-2'>
            <h3 className='text-base font-semibold'>{dimension.name}</h3>
            {dimension.isCore && <Badge variant='secondary'>核心</Badge>}
          </div>
          {dimension.description && <p className='text-muted-foreground mt-1 text-sm'>{dimension.description}</p>}
        </div>
      </div>
    </div>
    <div className='flex flex-col gap-5 pb-8 pl-4'>
      {dimension.items.map(item => (
        <EvaluationItemField
          key={item.key}
          item={item}
          answer={answers[item.key]}
          onChange={answer => onAnswerChange(item.key, answer)}
          disabled={disabled}
          error={errors?.[item.key]}
          ratings={ratings}
        />
      ))}
    </div>
  </section>
)

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
          <h2 className='text-xl font-semibold'>{subformTitle(subform)}</h2>
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
            <h2 className='text-xl font-semibold'>{subformTitle(subform)}</h2>
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
