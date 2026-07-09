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
import type { ReviewTaskItem } from '@/lib/perf-api'
import { avatarUrlOf, formatDateTime } from '@/lib/perf-api'

/** 评审任务行 = 后端 GET /review-tasks 的 item（360° 与上级评估共用任务模型） */
export type ReviewTask = ReviewTaskItem

/** 任务关系 → 中文标签 */
const RELATION_LABEL: Record<string, string> = {
  LEADER: '直属上级',
  PEER: '同事互评',
  CROSS_DEPT: '跨部门协作评估',
  ORG_OWNER: '组织负责人',
  PROJECT_OWNER: '项目负责人'
}

/** 填写页链接：按任务类型区分 */
const fillHref = (task: ReviewTask) =>
  `/review-tasks/fill?participant_id=${task.participantId}&type=${task.taskType}`

/** 评审任务列定义：待办 / 已完成两个 Tab 共用同一份 columns */
export const reviewTaskColumns: ColumnDef<ReviewTask>[] = [
  {
    id: 'target',
    header: '被评估人',
    cell: ({ row }) => (
      <div className='flex items-center gap-2'>
        <UserAvatar
          openId={row.original.employee?.open_id}
          name={row.original.employee?.name}
          avatarUrl={avatarUrlOf(row.original.employee)}
          size='sm'
        />
        <div className='flex flex-col'>
          <span className='font-medium'>{row.original.employee?.name ?? '-'}</span>
          <span className='text-muted-foreground text-xs'>{row.original.employee?.job_title ?? ''}</span>
        </div>
      </div>
    )
  },
  {
    id: 'cycle',
    accessorFn: row => row.cycle.name,
    header: '所属周期',
    cell: ({ row }) => <span className='text-muted-foreground'>{row.original.cycle.name}</span>
  },
  {
    id: 'type',
    header: '评估类型',
    enableSorting: false,
    cell: ({ row }) => (
      <Badge variant='outline'>
        {row.original.taskType === 'MANAGER_REVIEW'
          ? '上级评估'
          : (RELATION_LABEL[row.original.relation ?? ''] ?? '360° 评估')}
      </Badge>
    )
  },
  {
    id: 'time',
    header: '提交时间',
    cell: ({ row }) => (
      <span className='text-muted-foreground'>
        {row.original.status === 'SUBMITTED'
          ? `提交于 ${formatDateTime(row.original.submittedAt) === '-' ? '—' : formatDateTime(row.original.submittedAt)}`
          : '待完成'}
      </span>
    )
  },
  {
    id: 'actions',
    header: '操作',
    enableSorting: false,
    meta: { headClassName: 'text-right', cellClassName: 'text-right' },
    cell: ({ row }) =>
      row.original.status === 'SUBMITTED' ? (
        <Button variant='ghost' size='sm' render={<Link href={fillHref(row.original)} />} nativeButton={false}>
          查看评估
        </Button>
      ) : (
        <Button size='sm' render={<Link href={fillHref(row.original)} />} nativeButton={false}>
          开始评估
        </Button>
      )
  }
]
