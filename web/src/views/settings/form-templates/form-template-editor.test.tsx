import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { PerfFormTemplateVersion } from '@/lib/perf-api'

import FormTemplateEditor from './form-template-editor'

const draftVersion = {
  id: 11,
  templateId: 3,
  name: 'D 评估表单',
  version: 1,
  status: 'DRAFT',
  jobLevelPrefix: 'D',
  sourceVersionId: null,
  updatedAt: '2026-07-14T10:00:00.000Z',
  subforms: [
    {
      type: 'SELF',
      title: '员工自评',
      sortOrder: 0,
      dimensions: [
        {
          key: 'self-performance',
          type: 'SCORING',
          scoringMethod: 'RATING',
          audience: 'EMPLOYEE',
          name: '绩效自评',
          weight: 100,
          isCore: true,
          sortOrder: 0,
          fields: []
        }
      ]
    },
    { type: 'PEER', title: '360°评估', sortOrder: 1, dimensions: [] },
    { type: 'MANAGER', title: '上级评估', sortOrder: 2, dimensions: [] }
  ]
} as unknown as PerfFormTemplateVersion

describe('FormTemplateEditor', () => {
  it('只展示员工自评、360°评估和上级评估三个绩效子表单', () => {
    render(<FormTemplateEditor value={draftVersion} editable onChange={vi.fn()} />)

    expect(screen.getByRole('tab', { name: '员工自评' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '360°评估' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '上级评估' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /晋升评估/ })).not.toBeInTheDocument()
  })

  it('在维度标题行直接展示计分类型、计分方式、占比和核心标记', () => {
    render(<FormTemplateEditor value={draftVersion} editable onChange={vi.fn()} />)

    expect(screen.getByDisplayValue('绩效自评')).toBeInTheDocument()
    expect(screen.getByText('计分维度')).toBeInTheDocument()
    expect(screen.getByText('评级')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: '维度占比' })).toHaveValue(100)
    expect(screen.getByText('核心')).toBeInTheDocument()
  })

  it('新增内容使用表单字段且字段类型目录不包含评级和分数', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<FormTemplateEditor value={draftVersion} editable onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: '添加表单字段' }))

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        subforms: expect.arrayContaining([
          expect.objectContaining({
            type: 'SELF',
            dimensions: [
              expect.objectContaining({
                fields: [expect.objectContaining({ type: 'MARKDOWN' })]
              })
            ]
          })
        ])
      })
    )
    expect(screen.queryByText('添加评估项')).not.toBeInTheDocument()
  })
})
