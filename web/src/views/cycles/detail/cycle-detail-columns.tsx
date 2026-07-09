'use client'

// Third-party Imports
import type { ColumnDef } from '@tanstack/react-table'

// Component Imports
import { UserAvatar } from '@/components/shared/lark'
import { Badge } from '@/components/ui/badge'

// Util Imports
import type { PerfDimension, PerfParticipantItem } from '@/lib/perf-api'
import {
  DIMENSION_TYPE_LABEL,
  PARTICIPANT_STATUS_LABEL,
  SCORING_METHOD_LABEL,
  SELF_REVIEW_STATUS_LABEL,
  avatarUrlOf,
  formatDate
} from '@/lib/perf-api'

// ===== 考核人员（真实参与者行） =====

export type ParticipantRow = PerfParticipantItem

export const participantColumns: ColumnDef<ParticipantRow>[] = [
  {
    id: 'employee',
    header: '员工',
    cell: ({ row }) => (
      <div className='flex items-center gap-2'>
        <UserAvatar
          openId={row.original.employeeOpenId}
          name={row.original.employee?.name}
          avatarUrl={avatarUrlOf(row.original.employee)}
          size='sm'
        />
        <div className='flex flex-col'>
          <span className='font-medium'>{row.original.employee?.name ?? row.original.employeeOpenId}</span>
          <span className='text-muted-foreground text-xs'>{row.original.employee?.job_title ?? ''}</span>
        </div>
      </div>
    )
  },
  {
    id: 'department',
    accessorFn: row => row.departmentName ?? '-',
    header: '部门'
  },
  {
    id: 'leader',
    header: '直属 Leader',
    cell: ({ row }) =>
      row.original.leader ? (
        <div className='flex items-center gap-2'>
          <UserAvatar
            openId={row.original.leader.open_id}
            name={row.original.leader.name}
            avatarUrl={avatarUrlOf(row.original.leader)}
            size='sm'
          />
          <span>{row.original.leader.name ?? row.original.leader.open_id}</span>
        </div>
      ) : (
        <span className='text-muted-foreground'>-</span>
      )
  },
  {
    id: 'promotion',
    header: '晋升评估',
    cell: ({ row }) =>
      row.original.isPromotionEnabled ? (
        <Badge className='bg-purple-500/10 text-purple-600 dark:text-purple-400'>已启用</Badge>
      ) : (
        <span className='text-muted-foreground'>-</span>
      )
  },
  {
    id: 'selfReview',
    header: '自评',
    cell: ({ row }) => {
      const status = row.original.selfReview?.status

      return status ? SELF_REVIEW_STATUS_LABEL[status] : <span className='text-muted-foreground'>未填写</span>
    }
  },
  {
    id: 'status',
    header: '当前状态',
    cell: ({ row }) => (
      <Badge variant='outline'>{PARTICIPANT_STATUS_LABEL[row.original.status] ?? row.original.status}</Badge>
    )
  }
]

// ===== 评估维度 =====

export type DimensionRow = PerfDimension

const ROLE_LABEL: Record<string, string> = {
  EMPLOYEE: '员工',
  REVIEWER: '评审员',
  LEADER: '上级',
  HR: 'HR',
  ADMIN: '管理员'
}

export const dimensionColumns: ColumnDef<DimensionRow>[] = [
  { accessorKey: 'name', header: '维度名称' },
  {
    id: 'type',
    accessorFn: row => DIMENSION_TYPE_LABEL[row.type] ?? row.type,
    header: '类型'
  },
  {
    id: 'scoringMethod',
    accessorFn: row => SCORING_METHOD_LABEL[row.scoringMethod] ?? row.scoringMethod,
    header: '计分方式'
  },
  {
    id: 'weight',
    header: '权重',
    meta: { headClassName: 'text-right', cellClassName: 'text-right' },
    cell: ({ row }) => (row.original.weight != null ? `${Number(row.original.weight)}%` : '-')
  },
  {
    id: 'editableRoles',
    header: '填写角色',
    cell: ({ row }) => row.original.editableRoles.map(role => ROLE_LABEL[role] ?? role).join(' / ') || '-'
  },
  {
    id: 'required',
    header: '必填',
    cell: ({ row }) => (row.original.required ? '是' : '否')
  }
]

// ===== 时间窗口（cycle.windows JSON → 行） =====

export type StageWindowRow = { stage: string; startAt?: string; endAt?: string }

export const WINDOW_STAGE_LABEL: Record<string, string> = {
  selfReview: '员工自评',
  review: '评审打分',
  calibration: 'AI 分析 & 校准',
  confirm: '结果确认',
  appeal: '申诉处理'
}

export const stageWindowColumns: ColumnDef<StageWindowRow>[] = [
  { accessorKey: 'stage', header: '阶段' },
  {
    id: 'window',
    header: '时间窗口',
    cell: ({ row }) => (
      <span className='text-muted-foreground'>
        {formatDate(row.original.startAt)} ~ {formatDate(row.original.endAt)}
      </span>
    )
  }
]
