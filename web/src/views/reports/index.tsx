'use client'

// Third-party Imports
import { getCoreRowModel, getPaginationRowModel, useReactTable } from '@tanstack/react-table'
import { DownloadIcon, FileSpreadsheetIcon } from 'lucide-react'

// Component Imports
import { DataTable, DataTablePagination } from '@/components/datatable'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

import { exportTaskColumns } from './export-task-columns'
import type { ExportTaskRow } from './export-task-columns'

// ===== 页面内 mock 数据 =====

// 报表类型
const REPORT_TYPES = [
  { name: '周期结果总表', description: '全员绩效等级、综合评分与校准记录' },
  { name: '部门维度汇总', description: '按部门统计的等级分布与完成率' },
  { name: '360° 评估明细', description: '各评估任务的维度作答与字段作答明细（脱敏）' },
  { name: '申诉与面谈记录', description: '申诉处理过程与面谈结论归档' }
]

// 导出任务列表
const MOCK_EXPORT_TASKS: ExportTaskRow[] = [
  { id: 'export-1', name: '360° 评估明细', cycle: '2026 上半年', status: '生成中', createdAt: '2026-07-06 16:02' },
  { id: 'export-2', name: '部门维度汇总', cycle: '2026 上半年', status: '失败', createdAt: '2026-06-29 17:55' },
  { id: 'export-3', name: '周期结果总表', cycle: '2025 下半年', status: '已完成', createdAt: '2026-02-15 10:32' },
  { id: 'export-4', name: '部门维度汇总', cycle: '2025 下半年', status: '已完成', createdAt: '2026-02-15 10:30' },
  { id: 'export-5', name: '申诉与面谈记录', cycle: '2025 下半年', status: '已完成', createdAt: '2026-02-12 09:18' },
  { id: 'export-6', name: '周期结果总表', cycle: '2025 上半年', status: '已完成', createdAt: '2025-08-25 14:06' }
]

/**
 * 报表导出：报表类型卡片 + 导出任务 Data Table（basic 变体）。
 */
const Reports = () => {
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: MOCK_EXPORT_TASKS,
    columns: exportTaskColumns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize: 5 } },
    enableSorting: false
  })

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader title='报表导出' description='选择报表类型发起导出，生成完成后可下载 Excel 文件' />

      {/* 报表类型卡片 */}
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        {REPORT_TYPES.map(report => (
          <Card key={report.name}>
            <CardHeader>
              <FileSpreadsheetIcon className='text-primary size-6' />
              <CardTitle className='mt-2 text-base'>{report.name}</CardTitle>
              <CardDescription>{report.description}</CardDescription>
            </CardHeader>
            <CardContent className='mt-auto'>
              <Button variant='outline' size='sm' className='w-full'>
                <DownloadIcon />
                发起导出
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 导出任务列表（basic Data Table） */}
      <Card>
        <CardHeader>
          <CardTitle>导出任务</CardTitle>
          <CardDescription>最近发起的报表导出任务</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable table={table} emptyText='暂无导出任务' />
          <DataTablePagination table={table} />
        </CardContent>
      </Card>
    </div>
  )
}

export default Reports
