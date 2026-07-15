import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { PerfCycleConfigSnapshot } from '@/lib/perf-api'

import SnapshotProvenanceCard from './snapshot-provenance-card'

const baseSnapshot = {
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
  forms: [{ id: 1, jobLevelPrefix: 'D', sourceFormTemplateVersionId: 201, name: 'D 普通岗表单' }],
  manuallyModified: false
} as PerfCycleConfigSnapshot

describe('SnapshotProvenanceCard', () => {
  it('有来源时展示来源模板名称+版本号，并表达复制语义、不暗示持续同步', () => {
    render(<SnapshotProvenanceCard snapshot={baseSnapshot} />)

    expect(screen.getByText(/标准配置/)).toBeInTheDocument()
    expect(screen.getByText(/v2/)).toBeInTheDocument()
    expect(screen.getByText(/已复制为本周期独立配置快照/)).toBeInTheDocument()
    expect(screen.getByText(/不会影响本周期/)).toBeInTheDocument()
    expect(screen.queryByText(/同步/)).not.toBeInTheDocument()
    expect(screen.getByText(/D 普通岗表单/)).toBeInTheDocument()
  })

  it('manuallyModified 为 true 时提示评估规则或评估维度可能已被手动修改', () => {
    render(<SnapshotProvenanceCard snapshot={{ ...baseSnapshot, manuallyModified: true }} />)

    expect(screen.getByText(/评估规则或评估维度可能已被手动修改/)).toBeInTheDocument()
  })

  it('manuallyModified 为 false 时不出现手动修改提示', () => {
    render(<SnapshotProvenanceCard snapshot={{ ...baseSnapshot, manuallyModified: false }} />)

    expect(screen.queryByText(/可能已被手动修改/)).not.toBeInTheDocument()
  })

  it('无来源时渲染退化文案', () => {
    render(<SnapshotProvenanceCard snapshot={{ ...baseSnapshot, source: null }} />)

    expect(screen.getByText('未记录来源配置模板版本。')).toBeInTheDocument()
    expect(screen.queryByText(/标准配置/)).not.toBeInTheDocument()
  })

  it('snapshot 为 null 时渲染退化文案', () => {
    render(<SnapshotProvenanceCard snapshot={null} />)

    expect(screen.getByText('未记录来源配置模板版本。')).toBeInTheDocument()
  })

  it('重套后来源更新：rerender 传入新来源，展示最新来源且旧来源不再可见', () => {
    const view = render(<SnapshotProvenanceCard snapshot={baseSnapshot} />)

    expect(screen.getByText(/标准配置/)).toBeInTheDocument()
    expect(screen.getByText(/v2/)).toBeInTheDocument()

    const reappliedSnapshot = {
      ...baseSnapshot,
      source: { id: 31, templateId: 4, name: '晋升配置', version: 5 },
      manuallyModified: false
    } as PerfCycleConfigSnapshot

    view.rerender(<SnapshotProvenanceCard snapshot={reappliedSnapshot} />)

    expect(screen.getByText(/晋升配置/)).toBeInTheDocument()
    expect(screen.getByText(/v5/)).toBeInTheDocument()
    expect(screen.queryByText(/标准配置/)).not.toBeInTheDocument()
  })
})
