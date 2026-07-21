'use client'

// Next Imports
import Link from 'next/link'

// Third-party Imports
import type { ColumnDef } from '@tanstack/react-table'
import { Loader2Icon } from 'lucide-react'

// Component Imports
import FeishuCalendarLinkButton from '@/components/shared/FeishuCalendarLinkButton'
import { UserAvatar } from '@/components/shared/lark'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

// Util Imports
import type { LarkUserBrief, PerfInterviewStatus } from '@/lib/perf-api'
import {
  INTERVIEW_IN_PROGRESS_LABEL,
  INTERVIEW_STATUS_LABEL,
  avatarUrlOf,
  feishuCalendarEventUrl,
  formatDateTime,
  interviewDisplayLabel,
  isInterviewScheduleStarted
} from '@/lib/perf-api'
import { matchesPinyinSearch } from '@/lib/pinyin-search'

/** 面谈行 = 后端 GET /interviews 的 item */
export type InterviewRow = {
  id: number
  status: PerfInterviewStatus
  appealId: number | null
  scheduledStartAt: string | null
  scheduledEndAt: string | null
  calendarId: string | null
  calendarEventId: string | null
  resultNotes: string | null
  organizerOpenId: string
  participantOpenIds: string[]
  createdAt: string
  employee: LarkUserBrief | null
  organizer: LarkUserBrief | null
  participant: {
    id: number
    employeeOpenId: string
    status: string
    cycle: { id: number; name: string }
  }
}

export const INTERVIEW_STATUS_OPTIONS: string[] = [
  INTERVIEW_STATUS_LABEL.SCHEDULED,
  INTERVIEW_IN_PROGRESS_LABEL,
  INTERVIEW_STATUS_LABEL.COMPLETED,
  INTERVIEW_STATUS_LABEL.CANCELLED
]

const statusBadgeClass: Record<PerfInterviewStatus, string> = {
  SCHEDULED: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  COMPLETED: 'bg-green-500/10 text-green-600 dark:text-green-400',
  CANCELLED: 'bg-muted text-muted-foreground'
}

const inProgressBadgeClass = 'bg-violet-500/10 text-violet-600 dark:text-violet-400'

/** 已预约（含未开始 / 面谈中）：可取消与打开飞书日程 */
export const isInterviewScheduledActive = (row: InterviewRow) => row.status === 'SCHEDULED'

/** 已预约且尚未到开始时间 */
export const isInterviewNotStarted = (row: InterviewRow) => {
  if (row.status !== 'SCHEDULED') return false
  if (!row.scheduledStartAt) return true

  return !isInterviewScheduleStarted(row.scheduledStartAt)
}

export type InterviewColumnsContext = {
  actionRowId: number | null
  onCancel: (row: InterviewRow) => void
  onBookAgain: (row: InterviewRow) => void
}

export const buildInterviewTableColumns = ({
  actionRowId,
  onCancel,
  onBookAgain
}: InterviewColumnsContext): ColumnDef<InterviewRow>[] => [
  {
    id: 'employee',
    accessorFn: row => row.employee?.name ?? '',
    header: '员工',
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
    header: '周期',
    cell: ({ row }) => (
      <span className='text-muted-foreground whitespace-nowrap'>{row.original.participant.cycle.name}</span>
    )
  },
  {
    id: 'status',
    accessorFn: row => interviewDisplayLabel(row),
    header: '状态',
    cell: ({ row }) => {
      const label = interviewDisplayLabel(row.original)
      const inProgress =
        row.original.status === 'SCHEDULED' && isInterviewScheduleStarted(row.original.scheduledStartAt)

      return (
        <Badge
          variant='secondary'
          className={inProgress ? inProgressBadgeClass : statusBadgeClass[row.original.status]}
        >
          {label}
        </Badge>
      )
    },
    filterFn: 'equalsString'
  },
  {
    id: 'scheduledStartAt',
    accessorFn: row => row.scheduledStartAt ?? '',
    header: '预约时间',
    cell: ({ row }) => (
      <span className='whitespace-nowrap text-sm'>
        {row.original.scheduledStartAt ? formatDateTime(row.original.scheduledStartAt) : '-'}
      </span>
    )
  },
  {
    id: 'organizer',
    accessorFn: row => row.organizer?.name ?? '',
    header: '预约人',
    cell: ({ row }) => <span className='whitespace-nowrap'>{row.original.organizer?.name ?? '-'}</span>
  },
  {
    id: 'appealLink',
    accessorFn: row => (row.appealId ? '申诉面谈' : '普通面谈'),
    header: '申诉关联',
    filterFn: 'equalsString',
    enableSorting: false,
    cell: ({ row }) =>
      row.original.appealId ? (
        <Link
          href={`/appeals?appealId=${row.original.appealId}`}
          className='text-primary text-sm font-medium underline-offset-4 hover:underline'
        >
          申诉 #{row.original.appealId}
        </Link>
      ) : (
        <span className='text-muted-foreground text-sm'>普通面谈</span>
      )
  },
  {
    id: 'actions',
    header: '操作',
    enableSorting: false,
    meta: { headClassName: 'text-right', cellClassName: 'text-right' },
    cell: ({ row }) => {
      const interview = row.original
      const busy = actionRowId === interview.id

      const calendarHref =
        interview.calendarId && interview.calendarEventId
          ? feishuCalendarEventUrl(interview.calendarId, interview.calendarEventId)
          : null

      if (interview.status === 'CANCELLED') {
        return (
          <div className='flex justify-end gap-1'>
            <Button size='sm' variant='outline' disabled={busy} onClick={() => onBookAgain(interview)}>
              重新预约
            </Button>
          </div>
        )
      }

      // 已预约（未开始 / 面谈中）均可取消与打开日程
      if (isInterviewScheduledActive(interview)) {
        return (
          <div className='flex justify-end gap-1'>
            {calendarHref ? <FeishuCalendarLinkButton href={calendarHref} /> : null}
            <Button
              size='sm'
              variant='outline'
              disabled={busy}
              onClick={() => onCancel(interview)}
            >
              {busy ? <Loader2Icon className='size-3.5 animate-spin' /> : null}
              取消预约
            </Button>
          </div>
        )
      }

      return <span className='text-muted-foreground text-sm'>—</span>
    }
  }
]
