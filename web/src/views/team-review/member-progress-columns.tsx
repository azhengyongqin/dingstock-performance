'use client'

// Next Imports
import Link from 'next/link'

// Third-party Imports
import type { ColumnDef } from '@tanstack/react-table'

// Component Imports
import { UserAvatar } from '@/components/shared/lark'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

// Util Imports
import type {
  LarkUserBrief,
  PerfParticipantStatus,
  PerfReviewStatus,
  PerfSelfReviewStatus
} from '@/lib/perf-api'
import { SELF_REVIEW_STATUS_LABEL, avatarUrlOf } from '@/lib/perf-api'

/** 成员评审进度行 = 后端 GET /dashboard/team 的 item */
export type MemberProgressRow = {
  participantId: number
  employee: LarkUserBrief | null
  status: PerfParticipantStatus
  isPromotionEnabled: boolean
  selfReviewStatus: PerfSelfReviewStatus | null
  reviewProgress: { submitted: number; total: number }
  managerReviewStatus: PerfReviewStatus | null
  initialLevel: string | null
  finalLevel: string | null
}

// 环节状态 Badge 色彩语义：已提交绿、草稿蓝、已退回黄、未开始灰
const SELF_REVIEW_BADGE: Record<PerfSelfReviewStatus, string> = {
  SUBMITTED: 'bg-green-500/10 text-green-600 dark:text-green-400',
  DRAFT: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  RETURNED: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
}

const MUTED_BADGE = 'bg-muted text-muted-foreground'

/**
 * 成员评审进度列定义（progress 变体：360° 进度列用进度条渲染）。
 * 操作列为跳转链接，无需页面回调，直接导出静态 columns。
 */
export const memberProgressColumns: ColumnDef<MemberProgressRow>[] = [
  {
    id: 'name',
    accessorFn: row => row.employee?.name ?? '',
    header: '成员',
    cell: ({ row }) => {
      const employee = row.original.employee

      return (
        <div className='flex items-center gap-3'>
          {/* 统一人员头像组件：点击弹出飞书成员名片 */}
          <UserAvatar
            openId={employee?.open_id}
            name={employee?.name}
            avatarUrl={avatarUrlOf(employee)}
            className='size-8'
          />
          <div className='flex flex-col'>
            <span className='font-medium whitespace-nowrap'>{employee?.name ?? '-'}</span>
            {employee?.job_title && <span className='text-muted-foreground text-xs'>{employee.job_title}</span>}
          </div>
        </div>
      )
    }
  },
  {
    id: 'selfReview',
    header: '员工自评',
    enableSorting: false,
    cell: ({ row }) => {
      const status = row.original.selfReviewStatus

      return (
        <Badge className={status ? SELF_REVIEW_BADGE[status] : MUTED_BADGE}>
          {status ? SELF_REVIEW_STATUS_LABEL[status] : '未开始'}
        </Badge>
      )
    }
  },
  {
    id: 'peerReview',
    header: '360° 评估',
    size: 220,

    // 按提交比例排序；未指派评审人的排在最后
    accessorFn: row =>
      row.reviewProgress.total > 0 ? row.reviewProgress.submitted / row.reviewProgress.total : -1,
    cell: ({ row }) => {
      const { submitted, total } = row.original.reviewProgress

      // 未指派评审人时无进度可言，显示提示文案
      if (total === 0) return <span className='text-muted-foreground text-sm'>未指派</span>

      return (
        <div className='flex items-center gap-2'>
          <Progress value={Math.round((submitted / total) * 100)} className='h-2' />
          <span className='text-muted-foreground w-9 text-right text-xs whitespace-nowrap'>
            {submitted}/{total}
          </span>
        </div>
      )
    }
  },
  {
    id: 'managerReview',
    header: '上级评估',
    enableSorting: false,
    cell: ({ row }) => {
      const status = row.original.managerReviewStatus

      return (
        <Badge
          className={
            status === 'SUBMITTED'
              ? 'bg-green-500/10 text-green-600 dark:text-green-400'
              : status === 'DRAFT'
                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : MUTED_BADGE
          }
        >
          {status === 'SUBMITTED' ? '已提交' : status === 'DRAFT' ? '草稿' : '未开始'}
        </Badge>
      )
    }
  },
  {
    id: 'initialLevel',
    header: '初评等级',
    enableSorting: false,
    cell: ({ row }) =>
      row.original.initialLevel ? (
        <Badge variant='outline'>{row.original.initialLevel}</Badge>
      ) : (
        <span className='text-muted-foreground'>-</span>
      )
  },
  {
    id: 'actions',
    header: '操作',
    enableSorting: false,
    meta: { headClassName: 'text-right', cellClassName: 'text-right' },
    cell: ({ row }) => {
      const { participantId, managerReviewStatus } = row.original

      return (
        <div className='flex justify-end gap-1'>
          <Button
            variant='ghost'
            size='sm'
            render={<Link href={`/review-tasks/assign?participant_id=${participantId}`} />}
            nativeButton={false}
          >
            评审人指派
          </Button>
          {managerReviewStatus === 'SUBMITTED' ? (

            // 上级评估已提交后不可重复填写
            <Button variant='ghost' size='sm' disabled>
              已提交
            </Button>
          ) : (
            <Button
              size='sm'
              render={<Link href={`/review-tasks/fill?participant_id=${participantId}&type=MANAGER_REVIEW`} />}
              nativeButton={false}
            >
              上级评估
            </Button>
          )}
        </div>
      )
    }
  }
]
