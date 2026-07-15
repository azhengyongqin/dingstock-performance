import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiFetch } from './api'
import {
  createPerfCycle,
  initializePerfCycleSetup,
  applyActivePerfCycleConfig,
  previewActivePerfCycleConfig,
  reapplyPerfCycleConfigSnapshot,
  returnPerfCycleToDraft,
  schedulePerfCycle,
  updatePerfCyclePlan
} from './perf-api'

vi.mock('./api', () => ({ apiFetch: vi.fn() }))

const apiFetchMock = vi.mocked(apiFetch)

describe('绩效周期四步创建 API', () => {
  beforeEach(() => apiFetchMock.mockReset())

  it('创建只提交名称、配置版本和带时区的计划启动时间', () => {
    void createPerfCycle({
      name: '2026 上半年绩效评定',
      configTemplateVersionId: 12,
      plannedStartAt: '2026-08-01T01:00:00.000Z'
    })

    expect(apiFetchMock).toHaveBeenCalledWith('/cycles', {
      method: 'POST',
      body: JSON.stringify({
        name: '2026 上半年绩效评定',
        configTemplateVersionId: 12,
        plannedStartAt: '2026-08-01T01:00:00.000Z'
      })
    })
  })

  it('实际计划统一使用 stages 契约', () => {
    const plan = {
      allowStageOverlap: true,
      stages: [
        {
          stage: 'SELF' as const,
          startAt: '2026-08-01T01:00:00.000Z',
          reminderDeadlineAt: '2026-08-04T01:00:00.000Z'
        }
      ],
      notificationRules: { stages: [] }
    }

    void updatePerfCyclePlan(8, plan)

    expect(apiFetchMock).toHaveBeenCalledWith('/cycles/8/plan', {
      method: 'PUT',
      body: JSON.stringify(plan)
    })
  })

  it('迁移后的旧草稿通过专用接口原子初始化快照', () => {
    const input = {
      name: '迁移后的周期',
      configTemplateVersionId: 12,
      plannedStartAt: '2026-08-01T01:00:00.000Z'
    }

    void initializePerfCycleSetup(8, input)

    expect(apiFetchMock).toHaveBeenCalledWith('/cycles/8/config-snapshot/initialize', {
      method: 'POST',
      body: JSON.stringify(input)
    })
  })

  it('重新套用模板整体覆盖当前配置快照', () => {
    void reapplyPerfCycleConfigSnapshot(8, 12)

    expect(apiFetchMock).toHaveBeenCalledWith('/cycles/8/config-snapshot/reapply', {
      method: 'POST',
      body: JSON.stringify({ configTemplateVersionId: 12 })
    })
  })

  it('设为待启动和退回草稿不会调用旧启动接口', () => {
    void schedulePerfCycle(8)
    void returnPerfCycleToDraft(8)

    expect(apiFetchMock).toHaveBeenNthCalledWith(1, '/cycles/8/schedule', { method: 'POST' })
    expect(apiFetchMock).toHaveBeenNthCalledWith(2, '/cycles/8/return-to-draft', { method: 'POST' })
    expect(apiFetchMock.mock.calls.some(([path]) => path === '/cycles/8/start')).toBe(false)
  })

  it('活动周期先预览影响，再携带预览 revision、原因和确认应用', async () => {
    const input = {
      expectedConfigVersionId: 31,
      dimensionOverrides: [],
      stageModes: {
        SELF: 'DIRECT_RATING' as const,
        PEER: 'WEIGHTED_RATING' as const,
        MANAGER: 'WEIGHTED_SCORE' as const,
        AI: 'DIRECT_RATING' as const
      },
      ratings: [],
      constraintProfiles: { WEIGHTED_RATING: [], WEIGHTED_SCORE: [] },
      reviewerRelationWeights: { ORG_OWNER: '30', PROJECT_OWNER: '30', PEER: '25', CROSS_DEPT: '15' }
    }

    apiFetchMock.mockResolvedValueOnce({ impactRevision: 'a'.repeat(64) })
    const preview = await previewActivePerfCycleConfig(8, input)

    void applyActivePerfCycleConfig(8, {
      ...input,
      impactRevision: preview.impactRevision,
      reason: '修正规则',
      confirmed: true
    })

    expect(apiFetchMock).toHaveBeenNthCalledWith(1, '/cycles/8/active-config/preview', {
      method: 'POST',
      body: JSON.stringify(input)
    })
    expect(apiFetchMock).toHaveBeenNthCalledWith(2, '/cycles/8/active-config/apply', {
      method: 'POST',
      body: JSON.stringify({ ...input, impactRevision: 'a'.repeat(64), reason: '修正规则', confirmed: true })
    })
  })
})
