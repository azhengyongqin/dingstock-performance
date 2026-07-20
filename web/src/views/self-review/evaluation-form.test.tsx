import { useState } from 'react'

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { PerfConfigTemplateRating, PerfEvalFormSubform } from '@/lib/perf-api'

import EvaluationForm from './evaluation-form'
import type { EvaluationAnswers } from './evaluation-form-types'

const ALL_TYPES_SUBFORM: PerfEvalFormSubform = {
  key: 'subform:SELF',
  type: 'SELF',
  title: '员工自评',
  sortOrder: 0,
  dimensions: [
    {
      key: 'dimension:rating',
      type: 'SCORING',
      scoringMethod: 'RATING',
      audience: 'EMPLOYEE',
      name: '综合评估',
      weight: '60',
      isCore: true,
      sortOrder: 0,
      fields: [
        {
          key: 'item:short',
          type: 'SHORT_TEXT',
          title: '一句话总结',
          requiredRule: 'ALWAYS',
          sortOrder: 2,
          config: { maxLength: 20 }
        },
        { key: 'item:long', type: 'LONG_TEXT', title: '详细说明', requiredRule: 'OPTIONAL', sortOrder: 3 },
        { key: 'item:markdown', type: 'MARKDOWN', title: '复盘总结', requiredRule: 'OPTIONAL', sortOrder: 4 },
        {
          key: 'item:single',
          type: 'SINGLE_SELECT',
          title: '晋升意愿',
          requiredRule: 'ALWAYS',
          sortOrder: 5,
          config: {
            options: [
              { value: 'YES', label: '是' },
              { value: 'NO', label: '否' }
            ]
          }
        },
        {
          key: 'item:multi',
          type: 'MULTI_SELECT',
          title: '协作方式',
          requiredRule: 'ALWAYS',
          sortOrder: 6,
          config: {
            options: [
              { value: 'A', label: '跨团队协作' },
              { value: 'B', label: '导师带教' },
              { value: 'C', label: '文档沉淀' }
            ],
            minSelections: 1,
            maxSelections: 2
          }
        },
        {
          key: 'item:attachment',
          type: 'ATTACHMENT',
          title: '证明材料',
          requiredRule: 'ALWAYS',
          sortOrder: 7,
          config: { maxFiles: 2 }
        },
        { key: 'item:link', type: 'LINK', title: '参考链接', requiredRule: 'OPTIONAL', sortOrder: 8 }
      ]
    },
    {
      key: 'dimension:score',
      type: 'SCORING',
      scoringMethod: 'SCORE',
      audience: 'EMPLOYEE',
      name: '目标完成度',
      weight: '40',
      sortOrder: 1,
      fields: []
    }
  ]
}

const RATINGS: PerfConfigTemplateRating[] = [
  { symbol: 'S', name: '卓越', description: '超预期完成', minScore: '90', maxScore: '100', mappingScore: '95' },
  { symbol: 'A', name: '优秀', description: '完全达成目标', minScore: '80', maxScore: '90', mappingScore: '85' },
  { symbol: 'B', name: '良好', description: '基本达成目标', minScore: '60', maxScore: '80', mappingScore: '70' },
  { symbol: 'C', name: '待改进', description: '未达成目标', minScore: '0', maxScore: '60', mappingScore: '50' }
]

/** 受控测试壳：真实页面同样以 answers/onAnswerChange 驱动，用本地 state 还原完整交互链路 */
const Harness = ({
  subforms,
  errors,
  disabled,
  ratings,
  showWeightedResult,
  onAnswerChange
}: {
  subforms: PerfEvalFormSubform[]
  errors?: Record<string, string>
  disabled?: boolean
  ratings?: PerfConfigTemplateRating[]
  showWeightedResult?: boolean
  onAnswerChange?: (itemKey: string, value: unknown) => void
}) => {
  const [answers, setAnswers] = useState<EvaluationAnswers>({})

  return (
    <EvaluationForm
      subforms={subforms}
      answers={answers}
      errors={errors}
      disabled={disabled}
      ratings={ratings}
      showWeightedResult={showWeightedResult}
      onAnswerChange={(itemKey, answer) => {
        setAnswers(prev => ({ ...prev, [itemKey]: answer }))
        onAnswerChange?.(itemKey, answer)
      }}
    />
  )
}

const openSelect = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  screen.getByRole('combobox', { name }).focus()
  await user.keyboard('{Enter}')
}

describe('EvaluationForm 各评估项类型渲染正确组件', () => {
  it('完成全部计分维度后实时显示加权评分与最终等级', async () => {
    const user = userEvent.setup()

    render(<Harness subforms={[ALL_TYPES_SUBFORM]} ratings={RATINGS} showWeightedResult />)

    expect(screen.getByText('请完成全部计分维度')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'A · 优秀' }))
    await user.type(screen.getByRole('textbox', { name: '目标完成度' }), '95')

    expect(screen.getByText('加权评分 89.00 分')).toBeInTheDocument()
    expect(screen.getByText('加权等级 A')).toBeInTheDocument()
  })

  it('综合分只在最终出口四舍五入后映射等级', async () => {
    const user = userEvent.setup()

    const boundarySubform: PerfEvalFormSubform = {
      key: 'subform:MANAGER',
      type: 'MANAGER',
      title: '边界评分',
      sortOrder: 0,
      dimensions: [
        {
          key: 'dimension:core',
          type: 'SCORING',
          scoringMethod: 'SCORE',
          audience: 'LEADER',
          name: '核心维度',
          weight: '50',
          isCore: true,
          sortOrder: 0,
          fields: []
        },
        {
          key: 'dimension:other',
          type: 'SCORING',
          scoringMethod: 'SCORE',
          audience: 'LEADER',
          name: '其他维度',
          weight: '50',
          isCore: false,
          sortOrder: 1,
          fields: []
        }
      ]
    }

    render(<Harness subforms={[boundarySubform]} ratings={RATINGS} showWeightedResult />)
    await user.type(screen.getByRole('textbox', { name: '核心维度' }), '89.99')
    await user.type(screen.getByRole('textbox', { name: '其他维度' }), '90')

    // 89.995 应先四舍五入为 90.00，再按 S 档区间映射等级。
    expect(screen.getByText('加权评分 90.00 分')).toBeInTheDocument()
    expect(screen.getByText('加权等级 S')).toBeInTheDocument()
  })

  it('实时结果应用核心维度等级上限约束', async () => {
    const user = userEvent.setup()

    render(<Harness subforms={[ALL_TYPES_SUBFORM]} ratings={RATINGS} showWeightedResult />)
    await user.click(screen.getByRole('radio', { name: 'B · 良好' }))
    await user.type(screen.getByRole('textbox', { name: '目标完成度' }), '100')

    expect(screen.getByText('加权评分 82.00 分')).toBeInTheDocument()
    expect(screen.getByText('加权等级 B')).toBeInTheDocument()
    expect(screen.getByText('已应用维度约束（初始 A）')).toBeInTheDocument()
  })

  it('RATING 渲染 4 档 radio，SCORE 渲染数字输入，文本类渲染 Input/Textarea', () => {
    render(<Harness subforms={[ALL_TYPES_SUBFORM]} ratings={RATINGS} />)

    expect(screen.getAllByRole('radio')).toHaveLength(4)
    expect(screen.getByRole('radio', { name: 'A · 优秀' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '目标完成度' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '一句话总结' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '详细说明' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '复盘总结' })).toBeInTheDocument()
    expect(screen.getByText('富文本编辑，内容以 Markdown 格式保存')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '晋升意愿' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '跨团队协作' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '导师带教' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加附件' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '参考链接' })).toBeInTheDocument()
  })

  it('必填项标题带 * 标记', () => {
    render(<Harness subforms={[ALL_TYPES_SUBFORM]} />)

    const title = screen.getByText('一句话总结').closest('div')

    expect(within(title!).getByText('*')).toBeInTheDocument()
  })

  it('RATING 选择后回填对应档位说明', async () => {
    const user = userEvent.setup()

    render(<Harness subforms={[ALL_TYPES_SUBFORM]} ratings={RATINGS} />)
    await user.click(screen.getByRole('radio', { name: 'A · 优秀' }))

    expect(screen.getByRole('radio', { name: 'A · 优秀' })).toHaveAttribute('aria-checked', 'true')
  })

  it('SINGLE_SELECT 选择后受控值更新', async () => {
    const user = userEvent.setup()
    const onAnswerChange = vi.fn()

    render(<Harness subforms={[ALL_TYPES_SUBFORM]} onAnswerChange={onAnswerChange} />)
    await openSelect(user, '晋升意愿')
    await user.click(screen.getByRole('option', { name: '是' }))

    expect(onAnswerChange).toHaveBeenCalledWith('item:single', { value: 'YES' })
  })

  it('MULTI_SELECT 可勾选多项，取消后同步移除', async () => {
    const user = userEvent.setup()

    render(<Harness subforms={[ALL_TYPES_SUBFORM]} />)
    await user.click(screen.getByRole('checkbox', { name: '跨团队协作' }))
    await user.click(screen.getByRole('checkbox', { name: '导师带教' }))
    expect(screen.getByRole('checkbox', { name: '跨团队协作' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('checkbox', { name: '导师带教' })).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('checkbox', { name: '跨团队协作' }))
    expect(screen.getByRole('checkbox', { name: '跨团队协作' })).toHaveAttribute('aria-checked', 'false')
  })

  it('ATTACHMENT 增删行，达到 maxFiles 后禁用继续添加', async () => {
    const user = userEvent.setup()

    render(<Harness subforms={[ALL_TYPES_SUBFORM]} />)
    await user.click(screen.getByRole('button', { name: '添加附件' }))
    await user.click(screen.getByRole('button', { name: '添加附件' }))

    expect(screen.getByRole('textbox', { name: '证明材料 附件 1 名称' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '证明材料 附件 2 名称' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加附件' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '删除附件 1' }))
    expect(screen.queryByRole('textbox', { name: '证明材料 附件 2 名称' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加附件' })).not.toBeDisabled()
  })

  it('SCORE 接受 0-100 范围内最多两位小数', async () => {
    const user = userEvent.setup()

    render(<Harness subforms={[ALL_TYPES_SUBFORM]} />)
    const scoreInput = screen.getByRole('textbox', { name: '目标完成度' })

    await user.type(scoreInput, '85.5')

    expect(scoreInput).toHaveValue('85.5')
  })
})

describe('EvaluationForm 校验错误内联展示', () => {
  it('errors 中的信息以 FieldError 显示在对应评估项下方', () => {
    render(
      <Harness
        subforms={[ALL_TYPES_SUBFORM]}
        errors={{ 'dimension:rating': '计分维度「综合评估」请选择评级', 'item:multi': '「协作方式」至少选择 1 项' }}
      />
    )

    expect(screen.getByText('计分维度「综合评估」请选择评级')).toBeInTheDocument()
    expect(screen.getByText('「协作方式」至少选择 1 项')).toBeInTheDocument()
  })
})

describe('EvaluationForm 禁用态', () => {
  it('disabled 时所有控件不可交互', () => {
    render(<Harness subforms={[ALL_TYPES_SUBFORM]} disabled />)

    // RatingSelector 用原生 button[role=radio]，可用 toBeDisabled；Checkbox 仍是 span，看 aria-disabled。
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: '跨团队协作' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('textbox', { name: '目标完成度' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '一句话总结' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: '晋升意愿' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '添加附件' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '参考链接' })).toBeDisabled()
  })
})
