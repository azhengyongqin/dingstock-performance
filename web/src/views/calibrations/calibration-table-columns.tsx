'use client'

// Third-party Imports
import type { ColumnDef } from '@tanstack/react-table'

// Component Imports
import { UserAvatar } from '@/components/shared/lark'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'

// Util Imports
import type { LarkUserBrief, PerfParticipantStatus } from '@/lib/perf-api'
import { PARTICIPANT_STATUS_LABEL, avatarUrlOf } from '@/lib/perf-api'

/** 校准行 = 后端 GET /cycles/:cycleId/calibrations 的 item（id 即 participantId） */
export type CalibrationRow = {
  id: number
  employee: LarkUserBrief | null
  status: PerfParticipantStatus
  initialLevel: string | null
  currentLevel: string | null
  promotionConclusion: string | null
  adjusted: boolean
  riskFlags?: string[] | null
  requiredEvaluations: {
    ready: boolean
    self: 'EFFECTIVE' | 'MISSING'
    manager: 'EFFECTIVE' | 'MISSING'
    blockers: Array<{
      stage: 'SELF' | 'MANAGER'
      message: string
      action: 'MARK_NO_RESULT_OR_REMIND' | 'REMIND_OR_TRANSFER_LEADER'
    }>
  }
}

// 参与者状态 Badge 色彩语义：已校准及之后绿、申诉中黄、其余灰
const STATUS_BADGE: Partial<Record<PerfParticipantStatus, string>> = {
  CALIBRATED: 'bg-green-500/10 text-green-600 dark:text-green-400',
  RESULT_PUSHED: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  CONFIRMED: 'bg-green-500/10 text-green-600 dark:text-green-400',
  APPEALING: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  NO_RESULT: 'bg-muted text-muted-foreground'
}

/** 校准门槛提示只描述必交人工输入；PEER 与 AI 不进入阻塞文案。 */
export const calibrationBlockerText = (row: CalibrationRow) => {
  if (row.status === 'NO_RESULT') return '已收口，不生成绩效结果'
  if (row.requiredEvaluations.ready) return '必交评估已完成'
  if (row.requiredEvaluations.self === 'MISSING') return '员工自评缺失'

  return '上级评估缺失：请催办或更换考核 Leader'
}

export const participantNoResultActionLabel = (row: CalibrationRow) => {
  if (row.status === 'NO_RESULT') return '撤销无绩效结果'
  if (row.requiredEvaluations.self === 'MISSING') return '设为无绩效结果'

  return null
}

/** 列定义工厂的上下文：行内「调整」按钮回调由页面侧提供（打开调整弹窗） */
export type CalibrationColumnsContext = {
  onAdjust: (row: CalibrationRow) => void
  onNoResult: (row: CalibrationRow) => void
}

/** 员工校准列定义：行选择 + 当前评级筛选（filters + 行选择变体） */
export const buildCalibrationTableColumns = ({
  onAdjust,
  onNoResult
}: CalibrationColumnsContext): ColumnDef<CalibrationRow>[] => [
  {
    id: 'select',
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={table.getIsSomePageRowsSelected()}
        onCheckedChange={value => table.toggleAllPageRowsSelected(!!value)}
        aria-label='全选本页'
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        disabled={!row.getCanSelect()}
        onCheckedChange={value => row.toggleSelected(!!value)}
        aria-label='选择该行'
      />
    ),
    size: 40,
    enableSorting: false,
    enableHiding: false
  },
  {
    id: 'requiredEvaluations',
    header: '校准条件',
    enableSorting: false,
    cell: ({ row }) => (
      <span
        className={
          row.original.requiredEvaluations.ready ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'
        }
      >
        {calibrationBlockerText(row.original)}
      </span>
    )
  },
  {
    id: 'name',
    accessorFn: row => row.employee?.name ?? '',
    header: '员工',
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
    id: 'initialLevel',
    header: '初评评级',
    enableSorting: false,
    cell: ({ row }) =>
      row.original.initialLevel ? (
        <Badge variant='outline'>{row.original.initialLevel}</Badge>
      ) : (
        <span className='text-muted-foreground'>-</span>
      )
  },
  {
    id: 'currentLevel',
    accessorFn: row => row.currentLevel ?? '',
    header: '当前评级',
    filterFn: 'equalsString',
    enableSorting: false,
    cell: ({ row }) =>
      row.original.currentLevel ? (
        <Badge className='bg-primary/10 text-primary'>{row.original.currentLevel}</Badge>
      ) : (
        <span className='text-muted-foreground'>-</span>
      )
  },
  {
    id: 'promotionConclusion',
    header: '晋升结论',
    enableSorting: false,
    cell: ({ row }) => <span className='text-muted-foreground'>{row.original.promotionConclusion ?? '-'}</span>
  },
  {
    id: 'status',
    header: '状态',
    enableSorting: false,
    cell: ({ row }) => (
      <div className='flex items-center gap-1.5'>
        <Badge className={STATUS_BADGE[row.original.status] ?? 'bg-muted text-muted-foreground'}>
          {PARTICIPANT_STATUS_LABEL[row.original.status]}
        </Badge>
        {/* 校准中发生过评级调整的行加小徽标提示 */}
        {row.original.adjusted && (
          <Badge variant='outline' className='text-yellow-600 dark:text-yellow-400'>
            已调整
          </Badge>
        )}
      </div>
    )
  },
  {
    id: 'actions',
    header: '操作',
    enableSorting: false,
    meta: { headClassName: 'text-right', cellClassName: 'text-right' },
    cell: ({ row }) => {
      const noResultAction = participantNoResultActionLabel(row.original)

      return (
        <div className='flex justify-end gap-1'>
          {noResultAction && (
            <Button variant='ghost' size='sm' onClick={() => onNoResult(row.original)}>
              {noResultAction}
            </Button>
          )}
          <Button
            variant='ghost'
            size='sm'
            disabled={!row.original.requiredEvaluations.ready || row.original.status === 'NO_RESULT'}
            onClick={() => onAdjust(row.original)}
          >
            调整
          </Button>
        </div>
      )
    }
  }
]
