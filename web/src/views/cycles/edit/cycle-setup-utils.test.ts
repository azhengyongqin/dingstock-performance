import { describe, expect, it } from 'vitest'

import type { PerfConfigTemplateVersionSummary } from '@/lib/perf-api'

import {
  CYCLE_SETUP_STEPS,
  summarizePrefixChecks,
  toConfigTemplateOptions,
  toDateTimeInputValue,
  toIsoDateTimeValue
} from './cycle-setup-utils'

const configVersion = (
  overrides: Partial<PerfConfigTemplateVersionSummary>
): PerfConfigTemplateVersionSummary => ({
  id: overrides.id ?? 1,
  templateId: overrides.templateId ?? 10,
  name: overrides.name ?? '标准配置',
  version: overrides.version ?? 1,
  status: overrides.status ?? 'PUBLISHED',
  updatedAt: overrides.updatedAt ?? '2026-07-14T10:00:00.000Z',
  isUsable: overrides.isUsable ?? true,
  unavailableReasons: overrides.unavailableReasons ?? []
})

describe('cycle setup utilities', () => {
  it('创建流程固定为基本信息、参与者、计划预览和启动检查四步', () => {
    expect(CYCLE_SETUP_STEPS.map(step => step.key)).toEqual(['basic', 'participants', 'plan', 'checks'])
  })

  it('只允许选择可用的已发布配置版本，并保留不可用原因', () => {
    expect(
      toConfigTemplateOptions([
        configVersion({ id: 1, name: '可用配置', version: 3 }),
        configVersion({
          id: 2,
          name: '未发布配置',
          status: 'DRAFT',
          isUsable: false,
          unavailableReasons: [{ code: 'CONFIG_VERSION_DRAFT', message: '配置模板版本尚未发布' }]
        }),
        configVersion({
          id: 3,
          name: '已归档配置',
          status: 'ARCHIVED',
          isUsable: false,
          unavailableReasons: ['配置模板版本已归档']
        })
      ])
    ).toEqual([
      { value: '1', label: '可用配置 · v3', disabled: false, reason: '' },
      { value: '2', label: '未发布配置 · v1', disabled: true, reason: '配置模板版本尚未发布' },
      { value: '3', label: '已归档配置 · v1', disabled: true, reason: '配置模板版本已归档' }
    ])
  })

  it('汇总 D/M 匹配和异常人数，不为异常参与者生成兜底前缀', () => {
    expect(
      summarizePrefixChecks([
        { participantId: 1, status: 'MATCHED', jobLevelPrefix: 'D', message: '已匹配 D 表单' },
        { participantId: 2, status: 'MATCHED', jobLevelPrefix: 'M', message: '已匹配 M 表单' },
        { participantId: 3, status: 'MISSING_JOB_LEVEL', jobLevelPrefix: null, message: '缺少职级' },
        { participantId: 4, status: 'UNSUPPORTED_PREFIX', jobLevelPrefix: null, message: '不支持的前缀' }
      ])
    ).toEqual({ total: 4, matchedD: 1, matchedM: 1, errors: 2 })
  })

  it('日期时间输入值按本地时区转换，并可转回 ISO', () => {
    const input = toDateTimeInputValue('2026-07-14T08:30:00.000Z')

    expect(input).toMatch(/^2026-07-14T\d{2}:30$/)
    expect(toIsoDateTimeValue(input)).toBe(new Date(input).toISOString())
  })
})
