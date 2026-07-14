'use client'

import type { ColumnDef } from '@tanstack/react-table'

import { DateTimePicker } from '@/components/shared/DatePicker'
import { Button } from '@/components/ui/button'
import type { PerfConfigNotificationRules, PerfCycleSchedule } from '@/lib/perf-api'

import { toDateTimeInputValue, toIsoDateTimeValue } from './cycle-setup-utils'

export const CYCLE_SCHEDULE_STAGE_LABEL: Record<PerfCycleSchedule['stage'], string> = {
  SELF: '员工自评',
  PEER: '360°评估',
  MANAGER: '上级评估'
}

const notificationSummary = (
  stage: PerfCycleSchedule['stage'],
  rules: PerfConfigNotificationRules
): string => {
  const rule = rules.stages.find(item => item.stage === stage)

  if (!rule) return '未配置通知'
  const enabled = [rule.taskOpened.enabled && '开放通知', rule.reminder.enabled && '填写提醒'].filter(Boolean)

  return enabled.length ? enabled.join('、') : '通知已关闭'
}

export const getCycleScheduleColumns = ({
  notificationRules,
  editable,
  onChange,
  onEditNotification
}: {
  notificationRules: PerfConfigNotificationRules
  editable: boolean
  onChange: (schedule: PerfCycleSchedule) => void
  onEditNotification: (stage: PerfCycleSchedule['stage']) => void
}): ColumnDef<PerfCycleSchedule>[] => [
  {
    id: 'stage',
    header: '任务',
    cell: ({ row }) => <span className='font-medium'>{CYCLE_SCHEDULE_STAGE_LABEL[row.original.stage]}</span>
  },
  {
    id: 'startAt',
    header: '任务开始时间',
    cell: ({ row }) => (
      <DateTimePicker
        id={`${row.original.stage.toLowerCase()}-start-at`}
        value={toDateTimeInputValue(row.original.startAt)}
        disabled={!editable}
        onChange={value => onChange({ ...row.original, startAt: toIsoDateTimeValue(value) })}
      />
    )
  },
  {
    id: 'reminderDeadlineAt',
    header: '填写提醒时间',
    cell: ({ row }) => (
      <DateTimePicker
        id={`${row.original.stage.toLowerCase()}-reminder-at`}
        value={toDateTimeInputValue(row.original.reminderDeadlineAt)}
        disabled={!editable}
        onChange={value => onChange({ ...row.original, reminderDeadlineAt: toIsoDateTimeValue(value) })}
      />
    )
  },
  {
    id: 'notification',
    header: '通知',
    cell: ({ row }) => (
      <div className='flex flex-col items-start gap-1'>
        <span className='text-muted-foreground text-xs'>
          {notificationSummary(row.original.stage, notificationRules)}
        </span>
        <Button variant='ghost' size='sm' disabled={!editable} onClick={() => onEditNotification(row.original.stage)}>
          编辑通知
        </Button>
      </div>
    )
  }
]
