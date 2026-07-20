import { describe, expect, it } from 'vitest'

import type { PerfEvalFormSubform, PerfEvaluationDimensionAnswer } from '@/lib/perf-api'

import {
  buildDimensionSubmitPayload,
  buildDraftPayloadDimensions,
  subformsForStage,
  toDimensionEvaluationAnswers,
  type EvaluationAnswers
} from './evaluation-form-types'

const ratings = [
  { symbol: 'C', name: '待改进', description: '', minScore: '0', maxScore: '60', mappingScore: '50' },
  { symbol: 'B', name: '良好', description: '', minScore: '60', maxScore: '80', mappingScore: '70' },
  { symbol: 'A', name: '优秀', description: '', minScore: '80', maxScore: '90', mappingScore: '85' },
  { symbol: 'S', name: '卓越', description: '', minScore: '90', maxScore: '100', mappingScore: '95' }
] as const

const selfSubform: PerfEvalFormSubform = {
  key: 'subform:SELF',
  type: 'SELF',
  title: '员工自评',
  sortOrder: 0,
  dimensions: [
    {
      key: 'dimension:SELF:EMPLOYEE:0',
      type: 'SCORING',
      scoringMethod: 'RATING',
      audience: 'EMPLOYEE',
      name: '工作结果',
      sortOrder: 0,
      fields: [
        {
          key: 'field:summary',
          type: 'LONG_TEXT',
          title: '工作总结',
          requiredRule: 'CONDITIONAL',
          requiredLevels: ['S', 'C'],
          sortOrder: 0
        },
        {
          key: 'field:attachment',
          type: 'ATTACHMENT',
          title: '佐证材料',
          requiredRule: 'OPTIONAL',
          sortOrder: 1
        }
      ]
    }
  ]
}

describe('评估维度回答契约', () => {
  it('从 dimensionAnswers 回填维度与字段状态', () => {
    const stored: PerfEvaluationDimensionAnswer[] = [{
      id: 1,
      submissionId: 2,
      subformKey: selfSubform.key,
      dimensionKey: selfSubform.dimensions[0].key,
      scoringMethod: 'RATING',
      rawLevel: 'A',
      fields: [{ id: 3, fieldKey: 'field:summary', fieldType: 'LONG_TEXT', value: '完成重点项目' }]
    }]

    expect(toDimensionEvaluationAnswers(stored)).toEqual({
      'dimension:SELF:EMPLOYEE:0': { rawLevel: 'A', rawScoreText: undefined },
      'field:summary': { value: '完成重点项目' }
    })
  })

  it('草稿只提交已有输入，并过滤附件空行', () => {
    const answers: EvaluationAnswers = {
      'dimension:SELF:EMPLOYEE:0': { rawLevel: 'B' },
      'field:attachment': {
        value: [{ name: '证明.pdf', url: 'https://example.com/proof.pdf' }, { name: '', url: '' }]
      }
    }

    expect(buildDraftPayloadDimensions([selfSubform], answers)).toEqual([{
      subformKey: selfSubform.key,
      dimensionKey: selfSubform.dimensions[0].key,
      rawLevel: 'B',
      rawScore: undefined,
      fields: [{ fieldKey: 'field:attachment', value: [{ name: '证明.pdf', url: 'https://example.com/proof.pdf' }] }]
    }])
  })

  it('命中条件等级时拦截必填字段', () => {
    const result = buildDimensionSubmitPayload(
      [selfSubform],
      { 'dimension:SELF:EMPLOYEE:0': { rawLevel: 'S' } },
      [...ratings]
    )

    expect(result.errors['field:summary']).toMatch(/必填/)
    expect(result.dimensions).toEqual([])
  })

  it('只保留当前阶段的精确子表单', () => {
    const peer = { ...selfSubform, key: 'subform:PEER', type: 'PEER' as const }

    expect(subformsForStage([selfSubform, peer], 'PEER')).toEqual([peer])
  })
})
