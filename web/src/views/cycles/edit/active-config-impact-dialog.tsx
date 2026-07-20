'use client'

import { useState } from 'react'

import { getCoreRowModel, useReactTable } from '@tanstack/react-table'

import { DataTable } from '@/components/datatable'
import { StatsCards } from '@/components/shared/StatsCards'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import type { ActivePerfCycleConfigImpact } from '@/lib/perf-api'

import { activeConfigCalculationDimensionColumns, activeConfigImpactColumns } from './active-config-impact-columns'

const ActiveConfigImpactDialog = ({
  open,
  impact,
  applying,
  onCancel,
  onConfirm
}: {
  open: boolean
  impact: ActivePerfCycleConfigImpact | null
  applying: boolean
  onCancel: () => void
  onConfirm: (reason: string) => Promise<void>
}) => {
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  // TanStack Table 返回不可安全记忆化的函数，交由其内部状态模型管理。
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: impact?.stageChanges ?? [],
    columns: activeConfigImpactColumns,
    getCoreRowModel: getCoreRowModel(),
    enableSorting: false
  })

  const calculationDimensionTable = useReactTable({
    data: impact?.calculationDimensionChanges ?? [],
    columns: activeConfigCalculationDimensionColumns,
    getCoreRowModel: getCoreRowModel(),
    enableSorting: false
  })

  if (!impact) return null
  const summary = impact.summary

  return (
    <Dialog open={open} onOpenChange={next => !next && onCancel()}>
      <DialogContent className='sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>确认活动周期配置影响</DialogTitle>
          <DialogDescription>
            当前配置 v{impact.currentVersion} 将追加为 v{impact.nextVersion}；原配置和原阶段结果会永久保留。
          </DialogDescription>
        </DialogHeader>

        <StatsCards
          className='sm:grid-cols-3 xl:grid-cols-3'
          items={[
            { label: '受影响参与人', value: summary.affectedParticipantCount },
            { label: '重算阶段结果', value: summary.affectedStageResultCount },
            { label: '预计发生变化', value: summary.changedStageResultCount },
            { label: '已有校准', value: summary.calibratedParticipantCount },
            { label: '已有发布', value: summary.publishedParticipantCount },
            { label: '已经确认', value: summary.confirmedParticipantCount },
            { label: '重算评估维度', value: summary.affectedCalculationDimensionCount },
            { label: '维度映射分变化', value: summary.changedCalculationDimensionCount }
          ]}
        />

        <Alert>
          <AlertTitle>人工结论受保护</AlertTitle>
          <AlertDescription>
            本次操作只更新评估阶段参考结果，不会自动覆盖校准决定、结果版本或员工确认。最终等级如需变化，必须显式重新校准。
          </AlertDescription>
        </Alert>

        <div className='max-h-64 overflow-auto'>
          <DataTable table={table} emptyText='当前没有需要重算的阶段结果' />
        </div>

        <div className='max-h-48 overflow-auto'>
          <DataTable table={calculationDimensionTable} emptyText='当前没有需要重放映射分的评估维度' />
        </div>

        <div className='space-y-2'>
          <label htmlFor='active-config-reason' className='text-sm font-medium'>
            修改原因
          </label>
          <Textarea
            id='active-config-reason'
            value={reason}
            maxLength={500}
            placeholder='说明为什么需要调整计算配置'
            onChange={event => setReason(event.target.value)}
          />
        </div>

        <label className='flex items-start gap-3 text-sm'>
          <Checkbox
            aria-label='我已确认影响范围和人工结果保护规则'
            checked={confirmed}
            onCheckedChange={value => setConfirmed(value === true)}
          />
          <span>我已确认影响范围，并理解已校准或已发布结果不会被自动改写。</span>
        </label>

        <DialogFooter>
          <Button variant='outline' disabled={applying} onClick={onCancel}>
            取消
          </Button>
          <Button disabled={applying || !reason.trim() || !confirmed} onClick={() => void onConfirm(reason.trim())}>
            确认创建新版本并重算
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ActiveConfigImpactDialog
