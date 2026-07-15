import { describe, expect, it } from 'vitest'

import { ApiError } from '@/lib/api'

import { requiresActiveConfigRepreview } from './active-config-flow'

describe('活动周期配置编辑并发流程', () => {
  it('409 影响修订冲突要求丢弃旧确认并重新预览', () => {
    expect(
      requiresActiveConfigRepreview(
        new ApiError(409, '预览已过期', { code: 'ACTIVE_CONFIG_IMPACT_STALE' })
      )
    ).toBe(true)
    expect(requiresActiveConfigRepreview(new ApiError(500, '服务异常'))).toBe(false)
  })
})
