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
import type { LarkUserBrief, PerfParticipantStatus, PerfReviewStatus } from '@/lib/perf-api'
import { avatarUrlOf } from '@/lib/perf-api'

/** 成员评审进度行 = 后端 GET /dashboard/team 的 item */
export type MemberProgressRow = {
  participantId: number
  employee: LarkUserBrief | null
  status: PerfParticipantStatus
  isPromotionEnabled: boolean
  selfSubmissionStatus: PerfReviewStatus | null
  reviewProgress: { submitted: number; total: number }
  managerEvaluationState: 'NOT_STARTED' | 'DRAFT' | 'EFFECTIVE' | 'PENDING_RESUBMIT'
  managerSubmissionStatus: PerfReviewStatus | null
  managerInitialLevel: string | null
  finalLevel: string | null
}

// 自评状态直接来自统一 submission，不再复用旧 self-review 状态机。
const SELF_REVIEW_BADGE: Record<PerfReviewStatus, string> = {
  SUBMITTED: 'bg-green-500/10 text-green-600 dark:text-green-400',
  DRAFT: 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
}

const MUTED_BADGE = 'bg-muted text-muted-foreground'

const managerReviewHref = (participantId: number) =>
  `/review-tasks/fill?participant_id=${participantId}&type=MANAGER_REVIEW&from=team-review`

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
      const href = managerReviewHref(row.original.participantId)

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
            <Link href={href} className='font-medium whitespace-nowrap hover:underline'>
              {employee?.name ?? '-'}
            </Link>
            {employee?.job_title && <span className='text-muted-foreground text-xs'>{employee.job_title}</span>}
          </div>
        </div>
      )
    }
  },
  {
    id: 'selfSubmission',
    header: '员工自评',
    enableSorting: false,
    cell: ({ row }) => {
      const status = row.original.selfSubmissionStatus

      return (
        <Badge className={status ? SELF_REVIEW_BADGE[status] : MUTED_BADGE}>
          {status === 'SUBMITTED' ? '已提交' : status === 'DRAFT' ? '草稿' : '未开始'}
        </Badge>
      )
    }
  },
  {
    id: 'peerReview',
    header: '360° 评估',
    size: 220,

    // 按提交比例排序；未指派评审人的排在最后
    accessorFn: row => (row.reviewProgress.total > 0 ? row.reviewProgress.submitted / row.reviewProgress.total : -1),
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
    id: 'managerSubmission',
    header: '上级评估',
    enableSorting: false,
    cell: ({ row }) => {
      const state = row.original.managerEvaluationState

      return (
        <Badge
          className={
            state === 'EFFECTIVE'
              ? 'bg-green-500/10 text-green-600 dark:text-green-400'
              : state === 'DRAFT'
                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : state === 'PENDING_RESUBMIT'
                  ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
                  : MUTED_BADGE
          }
        >
          {state === 'EFFECTIVE'
            ? '已提交'
            : state === 'DRAFT'
              ? '草稿'
              : state === 'PENDING_RESUBMIT'
                ? '待重新提交'
                : '未开始'}
        </Badge>
      )
    }
  },
  {
    id: 'managerInitialLevel',
    header: '初评等级',
    enableSorting: false,
    cell: ({ row }) =>
      row.original.managerInitialLevel ? (
        <Badge variant='outline'>{row.original.managerInitialLevel}</Badge>
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
      const { participantId, managerEvaluationState } = row.original

      const actionLabel =
        managerEvaluationState === 'EFFECTIVE'
          ? '查看评估'
          : managerEvaluationState === 'DRAFT' || managerEvaluationState === 'PENDING_RESUBMIT'
            ? '继续评估'
            : '去评估'

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
          <Button
            variant={managerEvaluationState === 'EFFECTIVE' ? 'ghost' : 'default'}
            size='sm'
            render={<Link href={managerReviewHref(participantId)} />}
            nativeButton={false}
          >
            {actionLabel}
          </Button>
        </div>
      )
    }
  }
]
