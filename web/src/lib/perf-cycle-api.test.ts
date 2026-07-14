import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiFetch } from './api'
import {
  createPerfCycle,
  initializePerfCycleSetup,
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

  it('设为待启动和退回草稿不会调用旧启动接口', () => {
    void schedulePerfCycle(8)
    void returnPerfCycleToDraft(8)

    expect(apiFetchMock).toHaveBeenNthCalledWith(1, '/cycles/8/schedule', { method: 'POST' })
    expect(apiFetchMock).toHaveBeenNthCalledWith(2, '/cycles/8/return-to-draft', { method: 'POST' })
    expect(apiFetchMock.mock.calls.some(([path]) => path === '/cycles/8/start')).toBe(false)
  })
})
