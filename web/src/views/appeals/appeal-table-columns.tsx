'use client'

// Third-party Imports
import type { ColumnDef } from '@tanstack/react-table'

// Component Imports
import { UserAvatar } from '@/components/shared/lark'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

// Util Imports
import type { LarkUserBrief, PerfAppealStatus } from '@/lib/perf-api'
import { APPEAL_STATUS_LABEL, avatarUrlOf, formatDateTime } from '@/lib/perf-api'

/** 申诉行 = 后端 GET /appeals 的 item */
export type AppealRow = {
  id: number
  reason: string
  status: PerfAppealStatus
  conclusion: string | null
  resultAdjusted: boolean
  resolvedAt: string | null
  createdAt: string
  employee: LarkUserBrief | null
  handler: { open_id: string; name?: string } | null
  participant: {
    id: number
    cycle: { id: number; name: string }
    resultVersions: Array<{ id: number; version: number; finalLevel: string }>
  }
}

/** 状态筛选候选值（中文标签，按处理流程顺序） */
export const APPEAL_STATUS_OPTIONS: string[] = [
  APPEAL_STATUS_LABEL.PENDING,
  APPEAL_STATUS_LABEL.IN_INTERVIEW,
  APPEAL_STATUS_LABEL.RESOLVED
]

// 状态 Badge 色彩语义：待处理黄、面谈处理中蓝、已处理绿
const statusBadgeClass: Record<PerfAppealStatus, string> = {
  PENDING: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  IN_INTERVIEW: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  RESOLVED: 'bg-green-500/10 text-green-600 dark:text-green-400'
}

/** 列定义工厂的上下文：行内「处理」按钮回调由页面侧提供（打开处理弹窗） */
export type AppealColumnsContext = {
  onHandle: (row: AppealRow) => void
}

/** 申诉列表列定义（filters 变体：状态列筛选） */
export const buildAppealTableColumns = ({ onHandle }: AppealColumnsContext): ColumnDef<AppealRow>[] => [
  {
    id: 'employee',
    accessorFn: row => row.employee?.name ?? '',
    header: '申诉人',
    cell: ({ row }) => {
      const employee = row.original.employee

      return (
        <div className='flex items-center gap-2'>
          {/* 统一人员头像组件：点击弹出飞书成员名片 */}
          <UserAvatar openId={employee?.open_id} name={employee?.name} avatarUrl={avatarUrlOf(employee)} size='sm' />
          <span className='font-medium whitespace-nowrap'>{employee?.name ?? '-'}</span>
        </div>
      )
    }
  },
  {
    id: 'cycle',
    accessorFn: row => row.participant.cycle.name,
    header: '所属周期',
    cell: ({ row }) => <span className='text-muted-foreground whitespace-nowrap'>{row.original.participant.cycle.name}</span>
  },
  {
    id: 'finalLevel',
    header: '当前等级',
    enableSorting: false,
    cell: ({ row }) =>
      row.original.participant.resultVersions[0]?.finalLevel ? (
        <Badge variant='outline'>{row.original.participant.resultVersions[0].finalLevel}</Badge>
      ) : (
        <span className='text-muted-foreground'>-</span>
      )
  },
  {
    id: 'reason',
    header: '申诉理由',
    enableSorting: false,
    meta: { cellClassName: 'max-w-80' },
    cell: ({ row }) => <span className='text-muted-foreground block max-w-80 truncate'>{row.original.reason}</span>
  },
  {
    id: 'status',

    // 归一化为中文标签以支持状态筛选（equalsString）
    accessorFn: row => APPEAL_STATUS_LABEL[row.status],
    header: '状态',
    filterFn: 'equalsString',
    enableSorting: false,
    cell: ({ row }) => (
      <Badge className={statusBadgeClass[row.original.status]}>{APPEAL_STATUS_LABEL[row.original.status]}</Badge>
    )
  },
  {
    id: 'handler',
    header: '处理人',
    enableSorting: false,
    cell: ({ row }) => <span className='text-muted-foreground whitespace-nowrap'>{row.original.handler?.name ?? '-'}</span>
  },
  {
    id: 'createdAt',
    accessorKey: 'createdAt',
    header: '发起时间',
    cell: ({ row }) => (
      <span className='text-muted-foreground whitespace-nowrap'>{formatDateTime(row.original.createdAt)}</span>
    )
  },
  {
    id: 'actions',
    header: '操作',
    enableSorting: false,
    meta: { headClassName: 'text-right', cellClassName: 'text-right' },
    cell: ({ row }) => (
      <Button variant='ghost' size='sm' onClick={() => onHandle(row.original)}>
        {row.original.status === 'RESOLVED' ? '查看记录' : '处理'}
      </Button>
    )
  }
]
