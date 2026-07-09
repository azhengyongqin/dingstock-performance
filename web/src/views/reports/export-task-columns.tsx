'use client'

// Third-party Imports
import type { ColumnDef } from '@tanstack/react-table'

// Component Imports
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

/** 导出任务状态 */
export type ExportStatus = '已完成' | '生成中' | '失败'

/** 导出任务行数据 */
export type ExportTaskRow = {
  id: string
  name: string
  cycle: string
  status: ExportStatus
  createdAt: string
}

// 状态 Badge 色彩语义：已完成绿、生成中蓝、失败红
const statusBadgeClass: Record<ExportStatus, string> = {
  已完成: 'bg-green-500/10 text-green-600 dark:text-green-400',
  生成中: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  失败: 'bg-red-500/10 text-red-600 dark:text-red-400'
}

/** 导出任务列定义（basic 变体：小表格，无筛选/分页） */
export const exportTaskColumns: ColumnDef<ExportTaskRow>[] = [
  {
    accessorKey: 'name',
    header: '报表名称',
    cell: ({ row }) => <span className='font-medium'>{row.original.name}</span>
  },
  {
    accessorKey: 'cycle',
    header: '所属周期'
  },
  {
    accessorKey: 'status',
    header: '状态',
    cell: ({ row }) => <Badge className={statusBadgeClass[row.original.status]}>{row.original.status}</Badge>
  },
  {
    accessorKey: 'createdAt',
    header: '发起时间',
    cell: ({ row }) => <span className='text-muted-foreground'>{row.original.createdAt}</span>
  },
  {
    id: 'actions',
    header: '操作',
    meta: { headClassName: 'text-right', cellClassName: 'text-right' },
    cell: ({ row }) => (
      <Button variant='ghost' size='sm' disabled={row.original.status !== '已完成'}>
        下载
      </Button>
    )
  }
]
