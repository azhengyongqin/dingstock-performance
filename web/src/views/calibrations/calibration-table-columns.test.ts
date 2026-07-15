import { describe, expect, it } from 'vitest'

import { PARTICIPANT_STATUS_LABEL } from '@/lib/perf-api'

import {
  calibrationBlockerText,
  participantNoResultActionLabel,
  type CalibrationRow
} from './calibration-table-columns'

const row = (overrides: Partial<CalibrationRow>): CalibrationRow => ({
  id: 7,
  employee: null,
  status: 'PENDING_SELF_REVIEW',
  initialLevel: null,
  currentLevel: null,
  promotionConclusion: null,
  adjusted: false,
  requiredEvaluations: {
    ready: false,
    self: 'MISSING',
    manager: 'MISSING',
    blockers: []
  },
  ...overrides
})

describe('校准工作台必交评估与无绩效结果文案', () => {
  it('NO_RESULT 使用产品要求的“当前周期无绩效结果”文案并提供撤销动作', () => {
    const noResult = row({ status: 'NO_RESULT' })

    expect(PARTICIPANT_STATUS_LABEL.NO_RESULT).toBe('当前周期无绩效结果')
    expect(participantNoResultActionLabel(noResult)).toBe('撤销无绩效结果')
  })

  it('只缺 MANAGER 时提示催办或更换考核 Leader，不能提供 NO_RESULT 动作', () => {
    const missingManager = row({
      requiredEvaluations: {
        ready: false,
        self: 'EFFECTIVE',
        manager: 'MISSING',
        blockers: [
          {
            stage: 'MANAGER',
            message: '上级评估尚未形成有效提交，请催办或更换考核 Leader',
            action: 'REMIND_OR_TRANSFER_LEADER'
          }
        ]
      }
    })

    expect(calibrationBlockerText(missingManager)).toBe('上级评估缺失：请催办或更换考核 Leader')
    expect(participantNoResultActionLabel(missingManager)).toBeNull()
  })

  it('SELF 从未提交时提供标记当前周期无绩效结果动作', () => {
    expect(participantNoResultActionLabel(row({}))).toBe('设为无绩效结果')
  })
})
