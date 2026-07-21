'use client'

// Next Imports
import Link from 'next/link'

// Third-party Imports
import type { ColumnDef } from '@tanstack/react-table'

// Component Imports
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

// Util Imports
import type { PerfCycle } from '@/lib/perf-api'
import { CYCLE_STATUS_BADGE, CYCLE_STATUS_LABEL, CYCLE_TYPE_LABEL, formatDateTime } from '@/lib/perf-api'

/** 周期列表行数据 = 后端 GET /cycles 的 item */
export type CycleRow = PerfCycle

/** 状态筛选候选值（中文标签；status 列 accessor 返回中文，配合 equalsString 过滤） */
export const CYCLE_STATUS_OPTIONS: string[] = Object.values(CYCLE_STATUS_LABEL)

/** 周期列表列定义（与页面分离，仿模板 users-list 的拆分方式） */
export const cycleTableColumns: ColumnDef<CycleRow>[] = [
  {
    id: 'name',
    accessorKey: 'name',
    header: '周期名称',
    cell: ({ row }) => (
      <Link href={`/cycles/${row.original.id}`} className='hover:text-primary font-medium hover:underline'>
        {row.original.name}
      </Link>
    )
  },
  {
    id: 'type',
    accessorFn: row => CYCLE_TYPE_LABEL[row.type] ?? row.type,
    header: '类型'
  },
  {
    id: 'status',
    accessorFn: row => CYCLE_STATUS_LABEL[row.status] ?? row.status,
    header: '状态',
    filterFn: 'equalsString',
    cell: ({ row }) => (
      <Badge className={CYCLE_STATUS_BADGE[row.original.status]}>
        {CYCLE_STATUS_LABEL[row.original.status] ?? row.original.status}
      </Badge>
    )
  },
  {
    id: 'memberCount',
    accessorFn: row => row._count?.participants ?? 0,
    header: '参评人数',
    enableSorting: false,
    meta: { headClassName: 'text-right', cellClassName: 'text-right' }
  },
  {
    id: 'plannedStartAt',
    header: '计划启动时间',
    enableSorting: false,
    cell: ({ row }) => <span className='text-muted-foreground'>{formatDateTime(row.original.plannedStartAt)}</span>
  },
  {
    id: 'actions',
    header: '操作',
    enableSorting: false,
    meta: { headClassName: 'text-right', cellClassName: 'text-right' },
    cell: ({ row }) => (
      <div className='flex justify-end gap-1'>
        <Button variant='ghost' size='sm' render={<Link href={`/cycles/${row.original.id}`} />} nativeButton={false}>
          详情
        </Button>
        <Button
          variant='ghost'
          size='sm'
          render={<Link href={`/cycles/${row.original.id}/edit`} />}
          nativeButton={false}
          disabled={row.original.status === 'ARCHIVED'}
        >
          编辑
        </Button>
      </div>
    )
  }
]
