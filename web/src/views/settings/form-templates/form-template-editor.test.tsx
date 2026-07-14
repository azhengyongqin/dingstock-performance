import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { PerfFormTemplateVersion } from '@/lib/perf-api'

import FormTemplateEditor from './form-template-editor'

const draftVersion: PerfFormTemplateVersion = {
  id: 11,
  templateId: 3,
  name: 'D 评估表单',
  version: 1,
  status: 'DRAFT',
  jobLevelPrefix: 'D',
  sourceVersionId: null,
  updatedAt: '2026-07-14T10:00:00.000Z',
  subforms: [
    { type: 'SELF', title: '员工自评', sortOrder: 0, dimensions: [] },
    { type: 'PEER', title: '360°评估', sortOrder: 1, dimensions: [] },
    { type: 'MANAGER', title: '上级评估', sortOrder: 2, dimensions: [] },
    { type: 'PROMOTION', title: '晋升评估', sortOrder: 3, dimensions: [] }
  ]
}

describe('FormTemplateEditor', () => {
  it('晋升评估只提供员工和 Leader 内容边界', async () => {
    const user = userEvent.setup()

    render(<FormTemplateEditor value={draftVersion} editable onChange={vi.fn()} />)

    await user.click(screen.getByRole('tab', { name: '晋升评估' }))

    expect(screen.getByText('员工内容')).toBeInTheDocument()
    expect(screen.getByText('Leader 内容')).toBeInTheDocument()
    expect(screen.queryByText('360°评审员内容')).not.toBeInTheDocument()
  })

  it('在晋升评估中新增 Leader 维度时写入受控受众', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<FormTemplateEditor value={draftVersion} editable onChange={onChange} />)

    await user.click(screen.getByRole('tab', { name: '晋升评估' }))
    await user.click(screen.getByRole('button', { name: '添加 Leader 维度' }))

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        subforms: expect.arrayContaining([
          expect.objectContaining({
            type: 'PROMOTION',
            dimensions: [expect.objectContaining({ audience: 'LEADER', kind: 'PROMOTION' })]
          })
        ])
      })
    )
  })

  it('可在常规维度内新增受控评级项', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    const value: PerfFormTemplateVersion = {
      ...draftVersion,
      subforms: draftVersion.subforms.map(subform =>
        subform.type === 'PEER'
          ? {
              ...subform,
              dimensions: [
                {
                  kind: 'REGULAR',
                  audience: 'REVIEWER',
                  name: '协作沟通',
                  weight: 100,
                  isCore: true,
                  sortOrder: 0,
                  items: []
                }
              ]
            }
          : subform
      )
    }

    render(<FormTemplateEditor value={value} editable onChange={onChange} />)

    await user.click(screen.getByRole('tab', { name: '360°评估' }))
    await user.click(screen.getByRole('button', { name: '添加评估项' }))

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        subforms: expect.arrayContaining([
          expect.objectContaining({
            type: 'PEER',
            dimensions: [expect.objectContaining({ items: [expect.objectContaining({ type: 'RATING' })] })]
          })
        ])
      })
    )
  })
})
