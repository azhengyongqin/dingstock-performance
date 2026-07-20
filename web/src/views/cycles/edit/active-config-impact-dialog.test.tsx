import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ActiveConfigImpactDialog from './active-config-impact-dialog'

const impact = {
  cycleId: 8,
  currentConfigVersionId: 31,
  currentVersion: 2,
  nextVersion: 3,
  impactRevision: 'a'.repeat(64),
  summary: {
    affectedParticipantCount: 12,
    affectedStageResultCount: 20,
    changedStageResultCount: 6,
    calibratedParticipantCount: 4,
    publishedParticipantCount: 3,
    confirmedParticipantCount: 2,
    automaticRecalibrationParticipantCount: 0 as const,
    affectedCalculationDimensionCount: 1,
    changedCalculationDimensionCount: 1
  },
  stageChanges: [
    {
      participantId: 51,
      employeeOpenId: 'ou_employee',
      stage: 'MANAGER' as const,
      before: {
        compositeScore: '70',
        stageLevel: 'B',
        dimensions: [],
        matchedConstraints: []
      },
      after: {
        compositeScore: '65',
        stageLevel: 'C',
        dimensions: [{ key: 'delivery', name: '核心业绩', weight: '100', isCore: true, score: '65', level: 'C' }],
        matchedConstraints: [{ id: 'core-low' }]
      },
      changed: true,
      finalResultProtected: true
    }
  ],
  calculationDimensionChanges: [
    {
      participantId: 51,
      employeeOpenId: 'ou_employee',
      submissionId: 62,
      stage: 'SELF',
      status: 'DRAFT',
      dimensionKey: 'dimension:self-rating',
      before: '85',
      after: '88',
      changed: true
    }
  ]
}

describe('ActiveConfigImpactDialog', () => {
  it('展示保护范围，并在填写原因和勾选确认前禁用提交', () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)

    render(<ActiveConfigImpactDialog open impact={impact} applying={false} onCancel={() => {}} onConfirm={onConfirm} />)

    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText(/不会自动覆盖校准决定、结果版本或员工确认/)).toBeInTheDocument()
    expect(screen.getAllByText('ou_employee')).toHaveLength(2)
    expect(screen.getByText(/核心业绩 65\/C/)).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: '确认创建新版本并重算' })

    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText('修改原因'), { target: { value: '修正评级区间' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /我已确认影响范围/ }))
    expect(submit).toBeEnabled()

    fireEvent.click(submit)
    expect(onConfirm).toHaveBeenCalledWith('修正评级区间')
  })
})
