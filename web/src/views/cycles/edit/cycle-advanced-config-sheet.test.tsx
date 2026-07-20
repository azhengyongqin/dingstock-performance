import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { PerfCycleConfigSnapshot } from '@/lib/perf-api'

import CycleAdvancedConfigSheet from './cycle-advanced-config-sheet'

const snapshot = {
  id: 19,
  cycleId: 9,
  version: 1,
  sourceConfigTemplateVersionId: 30,
  source: { id: 30, templateId: 3, name: '标准配置', version: 2 },
  ratings: ['S', 'A', 'B', 'C'].map((symbol, index) => ({
    symbol,
    name: symbol,
    minScore: String([90, 80, 60, 0][index]),
    maxScore: String([100, 90, 80, 60][index]),
    mappingScore: String([95, 85, 70, 50][index])
  })),
  reviewerRelationWeights: { ORG_OWNER: '30', PROJECT_OWNER: '30', PEER: '25', CROSS_DEPT: '15' },
  notificationRules: { stages: [] },
  allowStageOverlap: false,
  forms: [
    {
      id: 41,
      jobLevelPrefix: 'D',
      sourceFormTemplateVersionId: 21,
      content: {
        name: 'D 表单',
        subforms: [
          {
            dimensions: [{ key: 'dimension:delivery', weight: '100', isCore: true }]
          }
        ]
      }
    }
  ]
} as PerfCycleConfigSnapshot

describe('CycleAdvancedConfigSheet', () => {
  it('DRAFT/SCHEDULED 可以保存周期自己的高级配置', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(
      <CycleAdvancedConfigSheet
        open
        onOpenChange={() => {}}
        snapshot={snapshot}
        editable
        saving={false}
        onSave={onSave}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '保存高级配置' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/不会回写来源模板/)).toBeInTheDocument()
  })

  it('ACTIVE 只进入影响预览，不把按钮描述成直接保存', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(
      <CycleAdvancedConfigSheet
        open
        onOpenChange={() => {}}
        snapshot={snapshot}
        editable
        active
        saving={false}
        onSave={onSave}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '预览影响并继续' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][1]).toEqual([
      { jobLevelPrefix: 'D', dimensionKey: 'dimension:delivery', weight: '100', isCore: true }
    ])
    expect(screen.getByLabelText('dimension:delivery 权重')).toHaveValue(100)
    expect(screen.queryByRole('button', { name: '保存高级配置' })).not.toBeInTheDocument()
  })
})
