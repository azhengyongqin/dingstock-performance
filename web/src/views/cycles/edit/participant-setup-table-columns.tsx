'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { Trash2Icon } from 'lucide-react'

import { UserAvatar } from '@/components/shared/lark'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type { PerfCycleSetupParticipant, PerfParticipantPrefixCheck } from '@/lib/perf-api'
import { avatarUrlOf } from '@/lib/perf-api'

const MATCH_STATUS_LABEL: Record<PerfParticipantPrefixCheck['status'], string> = {
  MATCHED: '已匹配',
  MISSING_JOB_LEVEL: '缺少职级',
  UNSUPPORTED_PREFIX: '不支持的前缀',
  NO_FORM: '无匹配表单',
  AMBIGUOUS_FORM: '重复匹配'
}

export const getParticipantSetupColumns = ({
  prefixChecks,
  editable,
  onTogglePromotion,
  onRemove
}: {
  prefixChecks: PerfParticipantPrefixCheck[]
  editable: boolean
  onTogglePromotion: (participant: PerfCycleSetupParticipant) => void
  onRemove: (participantId: number) => void
}): ColumnDef<PerfCycleSetupParticipant>[] => [
  {
    id: 'employee',
    header: '参与者',
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
          <span className='text-muted-foreground text-xs'>{row.original.departmentName ?? '-'}</span>
        </div>
      </div>
    )
  },
  {
    id: 'jobLevel',
    header: '职级',
    cell: ({ row }) => {
      const check = prefixChecks.find(item => item.participantId === row.original.id)

      return (
        <div className='flex items-center gap-2'>
          <span>{check?.jobLevelCode ?? row.original.jobLevelCodeSnapshot ?? '-'}</span>
          {(check?.jobLevelPrefix ?? row.original.jobLevelPrefixSnapshot) && (
            <Badge variant='outline'>{check?.jobLevelPrefix ?? row.original.jobLevelPrefixSnapshot}</Badge>
          )}
        </div>
      )
    }
  },
  {
    id: 'formMatch',
    header: '表单匹配',
    cell: ({ row }) => {
      const check = prefixChecks.find(item => item.participantId === row.original.id)

      if (!check) return <span className='text-muted-foreground'>等待检查</span>

      return (
        <div className='flex max-w-72 flex-col gap-1'>
          <Badge className='w-fit' variant={check.status === 'MATCHED' ? 'default' : 'destructive'}>
            {MATCH_STATUS_LABEL[check.status]}
          </Badge>
          <span className={check.status === 'MATCHED' ? 'text-muted-foreground text-xs' : 'text-destructive text-xs'}>
            {check.message}
          </span>
        </div>
      )
    }
  },
  {
    id: 'promotion',
    header: '晋升评估',
    cell: ({ row }) => (
      <label className='flex items-center gap-2 text-sm'>
        <Checkbox
          checked={row.original.isPromotionEnabled}
          disabled={!editable}
          onCheckedChange={() => onTogglePromotion(row.original)}
        />
        启用
      </label>
    )
  },
  {
    id: 'actions',
    header: '操作',
    enableSorting: false,
    meta: { headClassName: 'text-right', cellClassName: 'text-right' },
    cell: ({ row }) =>
      editable ? (
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label={`移除 ${row.original.employee?.name ?? row.original.employeeOpenId}`}
          onClick={() => onRemove(row.original.id)}
        >
          <Trash2Icon className='text-destructive size-4' />
        </Button>
      ) : null
  }
]
