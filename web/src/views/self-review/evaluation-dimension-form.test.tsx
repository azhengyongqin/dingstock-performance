import { useState } from 'react'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { PerfEvalFormSubform } from '@/lib/perf-api'

import EvaluationForm from './evaluation-form'
import type { EvaluationAnswers } from './evaluation-form-types'

const ratings = [
  { symbol: 'S' as const, name: '卓越', description: '', minScore: '90', maxScore: '100', mappingScore: '95' },
  { symbol: 'A' as const, name: '优秀', description: '', minScore: '80', maxScore: '90', mappingScore: '85' },
  { symbol: 'B' as const, name: '良好', description: '', minScore: '60', maxScore: '80', mappingScore: '70' },
  { symbol: 'C' as const, name: '待改进', description: '', minScore: '0', maxScore: '60', mappingScore: '50' }
]

const subforms = [
  {
    key: 'subform:self',
    type: 'SELF',
    title: '员工自评',
    sortOrder: 0,
    dimensions: [
      {
        key: 'dimension:result',
        type: 'SCORING',
        audience: 'EMPLOYEE',
        name: '自评结论',
        scoringMethod: 'RATING',
        weight: '100',
        isCore: true,
        sortOrder: 0,
        fields: [
          {
            key: 'field:summary',
            type: 'MARKDOWN',
            title: '自评总结',
            requiredRule: 'CONDITIONAL',
            requiredLevels: ['S', 'C'],
            sortOrder: 0
          },
          {
            key: 'field:next',
            type: 'SHORT_TEXT',
            title: '下阶段计划',
            requiredRule: 'OPTIONAL',
            sortOrder: 1
          }
        ]
      }
    ]
  }
] as const

const Harness = () => {
  const [answers, setAnswers] = useState<EvaluationAnswers>({})

  return (
    <EvaluationForm
      subforms={subforms as never}
      ratings={ratings}
      answers={answers}
      onAnswerChange={(key, answer) => setAnswers(current => ({ ...current, [key]: answer }))}
    />
  )
}

const ScoreHarness = () => {
  const [answers, setAnswers] = useState<EvaluationAnswers>({})
  const scoreSubforms = structuredClone(subforms) as unknown as PerfEvalFormSubform[]
  const dimension = scoreSubforms[0].dimensions[0]

  dimension.scoringMethod = 'SCORE'
  dimension.fields = []

  return (
    <EvaluationForm
      subforms={scoreSubforms as never}
      ratings={ratings}
      answers={answers}
      onAnswerChange={(key, answer) => setAnswers(current => ({ ...current, [key]: answer }))}
    />
  )
}

describe('新版统一维度填写表单', () => {
  it('维度直接展示计分控件，选择命中等级后立即标记条件必填字段', async () => {
    const user = userEvent.setup()

    render(<Harness />)

    expect(screen.getByText('自评结论')).toBeInTheDocument()
    expect(screen.getByText('占比 100%')).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(4)
    expect(screen.getByText('自评总结')).toBeInTheDocument()
    expect(screen.getByText('自评总结').compareDocumentPosition(screen.getByText('下阶段计划'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )

    await user.click(screen.getByRole('radio', { name: 'S · 卓越' }))

    expect(screen.getByText('选择 S 时必填')).toBeInTheDocument()
  })

  it('分数维度允许输入 0-100、最多两位小数', async () => {
    const user = userEvent.setup()

    render(<ScoreHarness />)
    const input = screen.getByRole('textbox', { name: '自评结论' })

    await user.type(input, '85.55')

    expect(input).toHaveValue('85.55')
  })
})
