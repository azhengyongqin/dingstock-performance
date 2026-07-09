import { describe, expect, it } from 'vitest'

import type { PerfTemplate } from '@/lib/perf-api'
import { findDefaultUsableTemplateId, shouldConfirmTemplateOverwrite, toTemplateOptions } from './cycle-template-utils'

const template = (overrides: Partial<PerfTemplate>): PerfTemplate => ({
  id: overrides.id ?? 1,
  name: overrides.name ?? '模板',
  isDefault: overrides.isDefault ?? false,
  canCreateCycle: overrides.canCreateCycle,
  unavailableReasons: overrides.unavailableReasons,
  levels: overrides.levels ?? [],
  _count: overrides._count ?? { dimensions: 0, cycles: 0 }
})

describe('cycle template selection', () => {
  it('只默认选中默认且可用于创建的配置模板', () => {
    expect(
      findDefaultUsableTemplateId([
        template({
          id: 1,
          name: '默认但不可用',
          isDefault: true,
          canCreateCycle: false,
          unavailableReasons: ['缺少评分等级']
        }),
        template({ id: 2, name: '可用但非默认', canCreateCycle: true }),
        template({ id: 3, name: '默认且可用', isDefault: true, canCreateCycle: true })
      ])
    ).toBe('3')
  })

  it('不可用模板在选项中保留原因并标记禁用', () => {
    expect(
      toTemplateOptions([
        template({
          id: 4,
          name: '权重不完整',
          canCreateCycle: false,
          unavailableReasons: ['全员维度权重合计 80，需为 100']
        })
      ])
    ).toEqual([
      {
        value: '4',
        label: '权重不完整',
        disabled: true,
        reason: '全员维度权重合计 80，需为 100'
      }
    ])
  })

  it('已手动修改周期配置后重新套用模板需要确认覆盖', () => {
    expect(shouldConfirmTemplateOverwrite(true)).toBe(true)
    expect(shouldConfirmTemplateOverwrite(false)).toBe(false)
  })
})
