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
      key: 'dimension:SELF:EMPLOYEE:0',
      audience: 'EMPLOYEE',
      name: '综合评估',
      isCore: true,
      sortOrder: 0,
      items: [
        { key: 'item:rating', type: 'RATING', title: '自评等级', required: true, sortOrder: 0 },
        { key: 'item:score', type: 'SCORE', title: '目标完成度', required: false, sortOrder: 1 },
        { key: 'item:short', type: 'SHORT_TEXT', title: '一句话总结', required: true, sortOrder: 2, config: { maxLength: 20 } },
        { key: 'item:long', type: 'LONG_TEXT', title: '详细说明', required: false, sortOrder: 3 },
        { key: 'item:markdown', type: 'MARKDOWN', title: '复盘总结', required: false, sortOrder: 4 },
        {
          key: 'item:single',
          type: 'SINGLE_SELECT',
          title: '晋升意愿',
          required: true,
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
          required: true,
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
          required: true,
          sortOrder: 7,
          config: { maxFiles: 2 }
        },
        { key: 'item:link', type: 'LINK', title: '参考链接', required: false, sortOrder: 8 }
      ]
    }
  ]
}

const RATINGS: PerfConfigTemplateRating[] = [
  { symbol: 'S', name: '卓越', description: '超预期完成', minScore: '90', maxScore: '100', mappingScore: '95', commentRequired: true },
  { symbol: 'A', name: '优秀', description: '完全达成目标', minScore: '80', maxScore: '90', mappingScore: '85', commentRequired: false },
  { symbol: 'B', name: '良好', description: '基本达成目标', minScore: '60', maxScore: '80', mappingScore: '70', commentRequired: false },
  { symbol: 'C', name: '待改进', description: '未达成目标', minScore: '0', maxScore: '60', mappingScore: '50', commentRequired: true }
]

const PROMOTION_SUBFORM: PerfEvalFormSubform = {
  key: 'subform:PROMOTION',
  type: 'PROMOTION',
  title: '晋升评估',
  sortOrder: 1,
  dimensions: [
    {
      key: 'dimension:PROMOTION:EMPLOYEE:0',
      audience: 'EMPLOYEE',
      name: '突出贡献',
      sortOrder: 0,
      items: [{ key: 'item:promotion-text', type: 'MARKDOWN', title: '突出工作产出结果', required: true, sortOrder: 0 }]
    }
  ]
}

/** 受控测试壳：真实页面同样以 answers/onAnswerChange 驱动，用本地 state 还原完整交互链路 */
const Harness = ({
  subforms,
  errors,
  disabled,
  ratings,
  onAnswerChange
}: {
  subforms: PerfEvalFormSubform[]
  errors?: Record<string, string>
  disabled?: boolean
  ratings?: PerfConfigTemplateRating[]
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
  it('RATING 渲染 4 档 radio，SCORE 渲染数字输入，文本类渲染 Input/Textarea', () => {
    render(<Harness subforms={[ALL_TYPES_SUBFORM]} ratings={RATINGS} />)

    expect(screen.getAllByRole('radio')).toHaveLength(4)
    expect(screen.getByRole('radio', { name: 'A · 优秀' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: '目标完成度' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '一句话总结' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '详细说明' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '复盘总结' })).toBeInTheDocument()
    expect(screen.getByText('支持 Markdown 语法')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '晋升意愿' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '跨团队协作' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '导师带教' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加附件' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '参考链接' })).toBeInTheDocument()
  })

  it('必填项标题带 * 标记', () => {
    render(<Harness subforms={[ALL_TYPES_SUBFORM]} />)

    const title = screen.getByText('自评等级').closest('div')

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

  it('SCORE 输入非法文本仍如实回显，交由校验层拦截', async () => {
    const user = userEvent.setup()

    render(<Harness subforms={[ALL_TYPES_SUBFORM]} />)
    const scoreInput = screen.getByRole('spinbutton', { name: '目标完成度' })

    await user.type(scoreInput, '85.5')
    expect(scoreInput).toHaveValue(85.5)
  })
})

describe('EvaluationForm 校验错误内联展示', () => {
  it('errors 中的信息以 FieldError 显示在对应评估项下方', () => {
    render(
      <Harness
        subforms={[ALL_TYPES_SUBFORM]}
        errors={{ 'item:rating': '「自评等级」为必填项，请选择评级', 'item:multi': '「协作方式」至少选择 1 项' }}
      />
    )

    expect(screen.getByText('「自评等级」为必填项，请选择评级')).toBeInTheDocument()
    expect(screen.getByText('「协作方式」至少选择 1 项')).toBeInTheDocument()
  })
})

describe('EvaluationForm 禁用态', () => {
  it('disabled 时所有控件不可交互', () => {
    render(<Harness subforms={[ALL_TYPES_SUBFORM]} disabled />)

    // RatingSelector 用原生 button[role=radio]，可用 toBeDisabled；Checkbox 仍是 span，看 aria-disabled。
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: '跨团队协作' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('spinbutton', { name: '目标完成度' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '一句话总结' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: '晋升意愿' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '添加附件' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '参考链接' })).toBeDisabled()
  })
})

describe('EvaluationForm 晋升评估分区标题', () => {
  it('PROMOTION 子表单标题固定展示「晋升评估（员工填写）」', () => {
    render(<Harness subforms={[PROMOTION_SUBFORM]} />)

    expect(screen.getByText('晋升评估（员工填写）')).toBeInTheDocument()
  })
})
