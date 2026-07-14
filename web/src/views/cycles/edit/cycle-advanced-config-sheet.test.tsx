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
  stageModes: {
    SELF: 'DIRECT_RATING',
    PEER: 'WEIGHTED_RATING',
    MANAGER: 'WEIGHTED_SCORE',
    AI: 'DIRECT_RATING'
  },
  ratings: ['S', 'A', 'B', 'C'].map((symbol, index) => ({
    symbol,
    name: symbol,
    minScore: String([90, 80, 60, 0][index]),
    maxScore: String([100, 90, 80, 60][index]),
    mappingScore: String([95, 85, 70, 50][index]),
    commentRequired: false
  })),
  constraintProfiles: { WEIGHTED_RATING: [], WEIGHTED_SCORE: [] },
  reviewerRelationWeights: { ORG_OWNER: '30', PROJECT_OWNER: '30', PEER: '25', CROSS_DEPT: '15' },
  notificationRules: { stages: [] },
  allowStageOverlap: false,
  forms: []
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
})
