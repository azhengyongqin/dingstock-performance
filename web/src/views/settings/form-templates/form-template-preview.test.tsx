import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { PerfFormTemplateVersion } from '@/lib/perf-api'

import FormTemplatePreview from './form-template-preview'

describe('FormTemplatePreview', () => {
  it('按真实禁用控件预览分数维度、选项、Markdown 和附件限制', () => {
    const value = {
      jobLevelPrefix: 'D',
      subforms: [
        {
          type: 'SELF',
          title: '员工自评',
          sortOrder: 0,
          dimensions: [
            {
              key: 'result',
              type: 'SCORING',
              scoringMethod: 'SCORE',
              audience: 'EMPLOYEE',
              name: '目标达成',
              weight: 100,
              isCore: true,
              sortOrder: 0,
              fields: [
                {
                  key: 'summary',
                  type: 'MARKDOWN',
                  title: '成果说明',
                  placeholder: '按 Markdown 大纲填写',
                  requiredRule: 'CONDITIONAL',
                  requiredLevels: ['S', 'C'],
                  sortOrder: 0,
                  config: { defaultValue: '## 关键成果' }
                },
                {
                  key: 'conclusion',
                  type: 'SINGLE_SELECT',
                  title: '结论',
                  requiredRule: 'ALWAYS',
                  requiredLevels: [],
                  sortOrder: 1,
                  config: { options: [{ value: 'YES', label: '达成' }] }
                },
                {
                  key: 'evidence',
                  type: 'ATTACHMENT',
                  title: '证据',
                  requiredRule: 'OPTIONAL',
                  requiredLevels: [],
                  sortOrder: 2,
                  config: { maxFiles: 2, maxSizeMb: 20 }
                }
              ]
            }
          ]
        }
      ]
    } as unknown as PerfFormTemplateVersion

    render(<FormTemplatePreview value={value} />)

    expect(screen.getByPlaceholderText('请输入 0～100 分')).toBeDisabled()
    expect(screen.getByDisplayValue('## 关键成果')).toBeDisabled()
    expect(screen.getByText('达成')).toBeInTheDocument()
    expect(screen.getByText(/最多 2 个文件.*20 MB/)).toBeInTheDocument()
    expect(screen.getByText(/S\/C 时必填/)).toBeInTheDocument()
  })
})
