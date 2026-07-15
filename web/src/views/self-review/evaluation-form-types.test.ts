import { describe, expect, it } from 'vitest'

import type { PerfEvalFormItem, PerfEvaluationItemResult } from '@/lib/perf-api'

import {
  buildDraftPayloadItems,
  buildSubmitPayload,
  toEvaluationAnswers,
  validateEvaluationItem,
  type EvaluationAnswers
} from './evaluation-form-types'

const ratingItem: PerfEvalFormItem = {
  key: 'item:SELF:EMPLOYEE:0:0',
  type: 'RATING',
  title: '自评等级',
  required: true,
  sortOrder: 0
}

const scoreItem: PerfEvalFormItem = {
  key: 'item:SELF:EMPLOYEE:1:0',
  type: 'SCORE',
  title: '目标完成度',
  required: false,
  sortOrder: 0
}

const requiredScoreItem: PerfEvalFormItem = { ...scoreItem, required: true }

const multiSelectItem: PerfEvalFormItem = {
  key: 'item:SELF:EMPLOYEE:1:1',
  type: 'MULTI_SELECT',
  title: '协作方式',
  required: true,
  sortOrder: 1,
  config: {
    options: [
      { value: 'A', label: '跨团队协作' },
      { value: 'B', label: '导师带教' },
      { value: 'C', label: '文档沉淀' }
    ],
    minSelections: 1,
    maxSelections: 2
  }
}

const linkItem: PerfEvalFormItem = {
  key: 'item:SELF:EMPLOYEE:1:2',
  type: 'LINK',
  title: '参考链接',
  required: false,
  sortOrder: 2
}

describe('validateEvaluationItem SCORE 边界', () => {
  it('空文本：必填拒绝，选填通过', () => {
    expect(validateEvaluationItem(requiredScoreItem, { rawScoreText: '' })).toMatch(/必填/)
    expect(validateEvaluationItem(scoreItem, { rawScoreText: '' })).toBeNull()
  })

  it('超过 100 拒绝', () => {
    expect(validateEvaluationItem(scoreItem, { rawScoreText: '100.01' })).toMatch(/0-100/)
  })

  it('三位小数拒绝', () => {
    expect(validateEvaluationItem(scoreItem, { rawScoreText: '85.123' })).toMatch(/0-100/)
  })

  it('负数拒绝', () => {
    expect(validateEvaluationItem(scoreItem, { rawScoreText: '-1' })).toMatch(/0-100/)
  })

  it('边界值 0 与 100 通过', () => {
    expect(validateEvaluationItem(scoreItem, { rawScoreText: '0' })).toBeNull()
    expect(validateEvaluationItem(scoreItem, { rawScoreText: '100' })).toBeNull()
  })

  it('两位小数通过', () => {
    expect(validateEvaluationItem(scoreItem, { rawScoreText: '85.55' })).toBeNull()
  })
})

describe('validateEvaluationItem RATING', () => {
  it('必填未选择时拒绝', () => {
    expect(validateEvaluationItem(ratingItem, undefined)).toMatch(/必填/)
  })

  it('已选择时通过', () => {
    expect(validateEvaluationItem(ratingItem, { rawLevel: 'A' })).toBeNull()
  })
})

describe('validateEvaluationItem MULTI_SELECT min/max', () => {
  it('未选择时按必填拒绝', () => {
    expect(validateEvaluationItem(multiSelectItem, { value: [] })).toMatch(/至少选择 1 项/)
  })

  it('超过 maxSelections 拒绝', () => {
    expect(validateEvaluationItem(multiSelectItem, { value: ['A', 'B', 'C'] })).toMatch(/最多选择 2 项/)
  })

  it('数量在区间内通过', () => {
    expect(validateEvaluationItem(multiSelectItem, { value: ['A', 'B'] })).toBeNull()
  })
})

describe('validateEvaluationItem LINK', () => {
  it('非法链接拒绝', () => {
    expect(validateEvaluationItem(linkItem, { value: '不是链接' })).toMatch(/合法的链接/)
  })

  it('合法 https 链接通过', () => {
    expect(validateEvaluationItem(linkItem, { value: 'https://example.com/doc' })).toBeNull()
  })

  it('选填为空时通过', () => {
    expect(validateEvaluationItem(linkItem, { value: '' })).toBeNull()
  })
})

describe('toEvaluationAnswers', () => {
  it('按 itemType 还原 rawLevel/rawScoreText/value', () => {
    const items: PerfEvaluationItemResult[] = [
      {
        id: 1,
        submissionId: 10,
        subformKey: 'subform:SELF',
        dimensionKey: 'dimension:SELF:EMPLOYEE:0',
        itemKey: 'item:SELF:EMPLOYEE:0:0',
        itemType: 'RATING',
        rawLevel: 'A',
        rawScore: null,
        calculationScore: '85.00',
        value: null
      },
      {
        id: 2,
        submissionId: 10,
        subformKey: 'subform:SELF',
        dimensionKey: 'dimension:SELF:EMPLOYEE:1',
        itemKey: 'item:SELF:EMPLOYEE:1:0',
        itemType: 'SCORE',
        rawLevel: null,
        rawScore: '92.50',
        calculationScore: '92.50',
        value: null
      },
      {
        id: 3,
        submissionId: 10,
        subformKey: 'subform:SELF',
        dimensionKey: 'dimension:SELF:EMPLOYEE:1',
        itemKey: 'item:SELF:EMPLOYEE:1:1',
        itemType: 'LONG_TEXT',
        rawLevel: null,
        rawScore: null,
        calculationScore: null,
        value: '文本内容'
      }
    ]

    const answers = toEvaluationAnswers(items)

    expect(answers['item:SELF:EMPLOYEE:0:0']).toEqual({ rawLevel: 'A' })
    expect(answers['item:SELF:EMPLOYEE:1:0']).toEqual({ rawScoreText: '92.50' })
    expect(answers['item:SELF:EMPLOYEE:1:1']).toEqual({ value: '文本内容' })
  })
})

describe('buildDraftPayloadItems 草稿允许不完整', () => {
  const subforms = [
    {
      key: 'subform:SELF',
      type: 'SELF' as const,
      title: '员工自评',
      sortOrder: 0,
      dimensions: [
        {
          key: 'dimension:SELF:EMPLOYEE:0',
          audience: 'EMPLOYEE' as const,
          name: '自评',
          sortOrder: 0,
          items: [ratingItem, scoreItem]
        }
      ]
    }
  ]

  it('只填一项也能生成草稿载荷，未答项与非法格式项被跳过', () => {
    const answers: EvaluationAnswers = { [ratingItem.key]: { rawLevel: 'A' }, [scoreItem.key]: { rawScoreText: 'abc' } }
    const items = buildDraftPayloadItems(subforms, answers)

    expect(items).toEqual([
      { subformKey: 'subform:SELF', dimensionKey: 'dimension:SELF:EMPLOYEE:0', itemKey: ratingItem.key, rawLevel: 'A' }
    ])
  })
})

describe('buildSubmitPayload 必填拦截', () => {
  const subforms = [
    {
      key: 'subform:SELF',
      type: 'SELF' as const,
      title: '员工自评',
      sortOrder: 0,
      dimensions: [
        {
          key: 'dimension:SELF:EMPLOYEE:0',
          audience: 'EMPLOYEE' as const,
          name: '自评',
          sortOrder: 0,
          items: [ratingItem]
        }
      ]
    }
  ]

  it('缺必填项时返回错误且不产出 items', () => {
    const result = buildSubmitPayload(subforms, {})

    expect(result.errors[ratingItem.key]).toMatch(/必填/)
    expect(result.items).toEqual([])
  })

  it('必填项齐全时返回可提交 items', () => {
    const result = buildSubmitPayload(subforms, { [ratingItem.key]: { rawLevel: 'B' } })

    expect(result.errors).toEqual({})
    expect(result.items).toEqual([
      { subformKey: 'subform:SELF', dimensionKey: 'dimension:SELF:EMPLOYEE:0', itemKey: ratingItem.key, rawLevel: 'B' }
    ])
  })
})
