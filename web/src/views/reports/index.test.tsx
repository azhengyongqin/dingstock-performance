import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import Reports from './index'

describe('报表导出领域术语', () => {
  it('360° 明细采用维度作答与字段作答术语', () => {
    render(<Reports />)

    expect(screen.getByText('各评估任务的维度作答与字段作答明细（脱敏）')).toBeInTheDocument()
    expect(screen.queryByText(/评估项作答/)).not.toBeInTheDocument()
  })
})
