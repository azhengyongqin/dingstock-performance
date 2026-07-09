'use client'

// Third-party Imports
import type { Table as TanstackTable } from '@tanstack/react-table'
import { DownloadIcon } from 'lucide-react'
import Papa from 'papaparse'

// Component Imports
import { Button } from '@/components/ui/button'

export interface DataTableExportButtonProps<TData> {
  table: TanstackTable<TData> // useReactTable 创建的表格实例

  /** 导出文件名前缀（自动追加日期与 .csv 后缀） */
  filename: string

  /** 行数据 → 导出记录的映射（key 为中文表头） */
  getExportRow: (row: TData) => Record<string, string | number>
}

/**
 * CSV 导出按钮（模板 export-button 变体惯用法）：
 * 导出当前筛选/排序后的全部行（跨分页），带 UTF-8 BOM 以便 Excel 正确识别中文。
 */
export function DataTableExportButton<TData>({ table, filename, getExportRow }: DataTableExportButtonProps<TData>) {
  const handleExport = () => {
    // 取筛选 + 排序后、分页前的全部行
    const rows = table.getPrePaginationRowModel().rows.map(row => getExportRow(row.original))
    const csv = Papa.unparse(rows, { header: true })
    const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.setAttribute('href', url)
    link.setAttribute('download', `${filename}-${new Date().toISOString().split('T')[0]}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <Button
      variant='outline'
      className='bg-primary/10 text-primary hover:bg-primary/20 border-none'
      onClick={handleExport}
    >
      <DownloadIcon />
      导出 CSV
    </Button>
  )
}
