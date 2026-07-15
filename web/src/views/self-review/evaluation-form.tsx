'use client'

// 动态评估表单渲染器：按周期表单快照的子表单/维度分组，逐项分发给 EvaluationItemField。
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { PerfConfigTemplateRating, PerfEvalFormSubform } from '@/lib/perf-api'

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
}

const EvaluationForm = ({ subforms, answers, onAnswerChange, errors, disabled, ratings }: EvaluationFormProps) => (
  <div className='flex flex-col gap-6'>
    {subforms.map(subform => (
      <Card key={subform.key}>
        <CardHeader>
          <CardTitle>{subformTitle(subform)}</CardTitle>
          {subform.description && <CardDescription>{subform.description}</CardDescription>}
        </CardHeader>
        <CardContent className='flex flex-col gap-6'>
          {subform.dimensions.map(dimension => (
            <section key={dimension.key} className='flex flex-col gap-4'>
              <div className='flex flex-wrap items-center gap-2'>
                <h3 className='text-sm font-medium'>{dimension.name}</h3>
                {dimension.isCore && <Badge variant='secondary'>核心</Badge>}
              </div>
              {dimension.description && <p className='text-muted-foreground -mt-2 text-sm'>{dimension.description}</p>}
              <div className='flex flex-col gap-5'>
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
          ))}
        </CardContent>
      </Card>
    ))}
  </div>
)

export default EvaluationForm
