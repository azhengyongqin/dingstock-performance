'use client'

// Third-party Imports
import type { ColumnDef } from '@tanstack/react-table'

// Component Imports
import { UserAvatar } from '@/components/shared/lark'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

// Util Imports
import type { LarkUserBrief, PerfInterviewStatus } from '@/lib/perf-api'
import { INTERVIEW_STATUS_LABEL, avatarUrlOf, formatDateTime } from '@/lib/perf-api'

/** 面谈行 = 后端 GET /interviews 的 item */
export type InterviewRow = {
  id: number
  status: PerfInterviewStatus
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
  INTERVIEW_STATUS_LABEL.COMPLETED,
  INTERVIEW_STATUS_LABEL.CANCELLED
]

const statusBadgeClass: Record<PerfInterviewStatus, string> = {
  SCHEDULED: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  COMPLETED: 'bg-green-500/10 text-green-600 dark:text-green-400',
  CANCELLED: 'bg-muted text-muted-foreground'
}

export type InterviewColumnsContext = {
  onOpen: (row: InterviewRow) => void
}

export const buildInterviewTableColumns = ({
  onOpen
}: InterviewColumnsContext): ColumnDef<InterviewRow>[] => [
  {
    id: 'employee',
    accessorFn: row => row.employee?.name ?? '',
    header: '员工',
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
    accessorFn: row => INTERVIEW_STATUS_LABEL[row.status],
    header: '状态',
    cell: ({ row }) => (
      <Badge variant='secondary' className={statusBadgeClass[row.original.status]}>
        {INTERVIEW_STATUS_LABEL[row.original.status]}
      </Badge>
    ),
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
    id: 'actions',
    header: '操作',
    enableSorting: false,
    cell: ({ row }) => (
      <Button size='sm' variant='outline' onClick={() => onOpen(row.original)}>
        详情
      </Button>
    )
  }
]
