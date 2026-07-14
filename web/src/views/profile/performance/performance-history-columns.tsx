'use client'

// Third-party Imports
import type { ColumnDef } from '@tanstack/react-table'

// Component Imports
import { Badge } from '@/components/ui/badge'

// Util Imports
import { formatDate } from '@/lib/perf-api'

/** 历史绩效行数据 = 后端 GET /profiles/{openId}/performance 的 item */
export type PerformanceHistoryRow = {
  cycle: { id: number; name: string }
  finalLevel: string
  promotionResult?: string | null
  confirmedByEmployee: boolean
  archivedAt?: string | null
}

/** 等级 → 趋势图数值映射（S 最高；未知等级按 B 档处理） */
export const LEVEL_VALUE: Record<string, number> = { S: 5, A: 4, B: 3, C: 2, D: 1 }

export const levelToValue = (level: string): number => LEVEL_VALUE[level] ?? 3

/** 历史绩效列定义（与页面分离，仿模板 users-list 的拆分方式；basic 变体） */
export const performanceHistoryColumns: ColumnDef<PerformanceHistoryRow>[] = [
  {
    id: 'cycle',
    accessorFn: row => row.cycle.name,
    header: '考核周期',
    cell: ({ row }) => <span className='font-medium'>{row.original.cycle.name}</span>
  },
  {
    id: 'finalLevel',
    accessorKey: 'finalLevel',
    header: '绩效等级',
    cell: ({ row }) => <Badge className='bg-primary/10 text-primary'>等级 {row.original.finalLevel}</Badge>
  },
  {
    id: 'promotionResult',
    header: '晋升结果',
    enableSorting: false,
    cell: ({ row }) => row.original.promotionResult || <span className='text-muted-foreground'>-</span>
  },
  {
    id: 'confirmed',
    header: '员工确认',
    enableSorting: false,
    cell: ({ row }) =>
      row.original.confirmedByEmployee ? (
        <Badge className='bg-green-500/10 text-green-600 dark:text-green-400'>已确认</Badge>
      ) : (
        <Badge variant='outline'>未确认</Badge>
      )
  },
  {
    id: 'archivedAt',
    header: '归档时间',
    enableSorting: false,
    cell: ({ row }) => <span className='text-muted-foreground'>{formatDate(row.original.archivedAt)}</span>
  }
]
