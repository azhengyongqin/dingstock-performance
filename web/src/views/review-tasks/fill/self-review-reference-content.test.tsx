import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import SelfReviewReferenceContent from './self-review-reference-content'

describe('SelfReviewReferenceContent', () => {
  it('标题使用 SELF 快照中的维度名与字段 title，而不是字段类型名', () => {
    render(
      <SelfReviewReferenceContent
        selfSubforms={[
          {
            key: 'subform:SELF',
            type: 'SELF',
            title: '员工自评',
            sortOrder: 0,
            dimensions: [
              {
                key: 'dimension:SELF:EMPLOYEE:0',
                type: 'SCORING',
                audience: 'EMPLOYEE',
                name: '自评等级',
                scoringMethod: 'RATING',
                weight: '100',
                isCore: true,
                sortOrder: 0,
                fields: [
                  {
                    key: 'field:self:summary',
                    type: 'MARKDOWN',
                    title: '自评总结',
                    requiredRule: 'CONDITIONAL',
                    requiredLevels: ['S', 'C'],
                    sortOrder: 0
                  }
                ]
              }
            ]
          }
        ]}
        selfDimensionAnswers={[
          {
            id: 1,
            submissionId: 90,
            subformKey: 'subform:SELF',
            dimensionKey: 'dimension:SELF:EMPLOYEE:0',
            scoringMethod: 'RATING',
            rawLevel: 'A',
            fields: [
              {
                id: 2,
                fieldKey: 'field:self:summary',
                fieldType: 'MARKDOWN',
                value: '## 完成核心项目'
              }
            ]
          }
        ]}
      />
    )

    expect(screen.getByRole('heading', { name: '自评等级' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '自评总结' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '富文本' })).not.toBeInTheDocument()
  })
})
