import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { performanceHistoryColumns, type PerformanceHistoryRow } from './performance-history-columns'

const HistoryRow = ({ item }: { item: PerformanceHistoryRow }) => {
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: [item],
    columns: performanceHistoryColumns,
    getCoreRowModel: getCoreRowModel()
  })

  return (
    <div>
      {table
        .getRowModel()
        .rows[0].getVisibleCells()
        .map(cell => (
          <div key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</div>
        ))}
    </div>
  )
}

const historyItem = (promotionResult: string | null): PerformanceHistoryRow => ({
  cycle: { id: 1, name: '2025 下半年绩效' },
  finalLevel: 'A',
  promotionResult,
  confirmedByEmployee: true,
  archivedAt: '2026-01-01T00:00:00.000Z'
})

describe('个人绩效历史列', () => {
  it('显示后端收敛后的晋升文本摘要', () => {
    render(<HistoryRow item={historyItem('晋升陈述：历史可见内容')} />)

    expect(screen.getByText('晋升陈述：历史可见内容')).toBeInTheDocument()
  })

  it('无可见晋升内容时显示占位符', () => {
    render(<HistoryRow item={historyItem(null)} />)

    expect(screen.getByText('-')).toBeInTheDocument()
  })
})
