'use client'

// Next Imports
import Link from 'next/link'

// Third-party Imports
import type { ColumnDef } from '@tanstack/react-table'

// Component Imports
import { UserAvatar } from '@/components/shared/lark'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

// Util Imports
import type { LarkUserBrief, PerfAppealStatus } from '@/lib/perf-api'
import {
  APPEAL_IN_INTERVIEW_LABEL,
  APPEAL_STATUS_LABEL,
  appealDisplayLabel,
  avatarUrlOf,
  formatDateTime
} from '@/lib/perf-api'
import { matchesPinyinSearch } from '@/lib/pinyin-search'

/** 申诉行 = 后端 GET /appeals 的 item */
export type AppealRow = {
  id: number
  reason: string
  status: PerfAppealStatus

  /** 由未取消面谈推导的「面谈中」展示态 */
  inInterview?: boolean

  /** 最新关联面谈 id（含已取消），表格展示「面谈 #id」 */
  linkedInterviewId?: number | null

  /** 关联面谈条数（含已取消） */
  linkedInterviewCount?: number
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

/** 状态筛选：主状态两态 + 推导「面谈中」 */
export const APPEAL_STATUS_OPTIONS: string[] = [
  APPEAL_STATUS_LABEL.PENDING,
  APPEAL_IN_INTERVIEW_LABEL,
  APPEAL_STATUS_LABEL.RESOLVED
]

const statusBadgeClass = (row: AppealRow): string => {
  if (row.status === 'RESOLVED') {
    return 'bg-green-500/10 text-green-600 dark:text-green-400'
  }

  if (row.inInterview) {
    return 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
  }

  return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
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
    // 配合工具栏 SearchInput：支持姓名原文 / 拼音 / 首字母
    filterFn: (row, _columnId, filterValue) =>
      matchesPinyinSearch(row.original.employee?.name ?? '', String(filterValue ?? '')),
    cell: ({ row }) => {
      const employee = row.original.employee

      return (
        <div className='flex items-center gap-2'>
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
    accessorFn: row => appealDisplayLabel(row),
    header: '状态',
    filterFn: 'equalsString',
    enableSorting: false,
    cell: ({ row }) => (
      <Badge className={statusBadgeClass(row.original)}>{appealDisplayLabel(row.original)}</Badge>
    )
  },
  {
    id: 'interviewLink',

    // 链接列看全部关联（含已取消）；与详情「面谈 · N」一致，勿只用 inInterview
    accessorFn: row =>
      (row.linkedInterviewCount ?? 0) > 0 || row.inInterview ? '已关联面谈' : '无关联面谈',
    header: '面谈关联',
    filterFn: 'equalsString',
    enableSorting: false,
    cell: ({ row }) => {
      const appeal = row.original
      const interviewId = appeal.linkedInterviewId

      // 对齐面谈表「申诉 #N」：有关联则显示「面谈 #id」
      if (interviewId != null) {
        return (
          <Link
            href={`/interviews?appealId=${appeal.id}&participantId=${appeal.participant.id}`}
            className='text-primary text-sm font-medium underline-offset-4 hover:underline'
          >
            面谈 #{interviewId}
          </Link>
        )
      }

      return <span className='text-muted-foreground text-sm'>无关联面谈</span>
    }
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
