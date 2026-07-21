'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { LogOutIcon, Trash2Icon } from 'lucide-react'

import { UserAvatar } from '@/components/shared/lark'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  action,
  onRemove
}: {
  prefixChecks: PerfParticipantPrefixCheck[]
  action: 'REMOVE' | 'WITHDRAW' | 'NONE'
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
    id: 'actions',
    header: '操作',
    enableSorting: false,
    meta: { headClassName: 'text-right', cellClassName: 'text-right' },
    cell: ({ row }) => {
      // 进行中的周期只能让仍在参与的员工中途退出，历史终态仅供查看。
      const canAct = action === 'REMOVE' || (action === 'WITHDRAW' && row.original.status === 'ACTIVE')

      return canAct ? (
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label={`${action === 'WITHDRAW' ? '中途退出' : '移除'} ${row.original.employee?.name ?? row.original.employeeOpenId}`}
          onClick={() => onRemove(row.original.id)}
        >
          {action === 'WITHDRAW' ? (
            <LogOutIcon className='text-destructive size-4' />
          ) : (
            <Trash2Icon className='text-destructive size-4' />
          )}
        </Button>
      ) : null
    }
  }
]
