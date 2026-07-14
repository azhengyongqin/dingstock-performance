'use client'

import { useCallback, useEffect, useState } from 'react'

import Link from 'next/link'

import type { ColumnDef, PaginationState, VisibilityState } from '@tanstack/react-table'
import { getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import { Loader2Icon, PencilIcon } from 'lucide-react'

import { DataTable, DataTablePagination, DataTableToolbar, DataTableViewOptions } from '@/components/datatable'
import PageHeader from '@/components/shared/PageHeader'
import { StatsCards } from '@/components/shared/StatsCards'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { apiFetch } from '@/lib/api'
import type {
  ListResponse,
  PerfCycle,
  PerfCycleConfigSnapshot,
  PerfCyclePlan,
  PerfParticipantItem
} from '@/lib/perf-api'
import {
  CYCLE_STATUS_BADGE,
  CYCLE_STATUS_LABEL,
  formatDateTime,
  getPerfCycleConfigSnapshot,
  getPerfCyclePlan
} from '@/lib/perf-api'

import { participantColumns, stageWindowColumns } from './cycle-detail-columns'

function BasicDataTable<TData>({
  data,
  columns,
  emptyText
}: {
  data: TData[]
  columns: ColumnDef<TData>[]
  emptyText?: string
}) {
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel(), enableSorting: false })

  return <DataTable table={table} emptyText={emptyText} />
}

const MemberTable = ({ participants }: { participants: PerfParticipantItem[] }) => {
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: participants,
    columns: participantColumns,
    state: { columnVisibility, pagination },
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableSortingRemoval: false
  })

  return (
    <>
      <DataTableToolbar table={table}>
        <DataTableViewOptions table={table} />
      </DataTableToolbar>
      <DataTable table={table} emptyText='尚未添加参与者，请到“编辑周期”中圈人' />
      <DataTablePagination table={table} />
    </>
  )
}

const CycleDetail = ({ cycleId }: { cycleId: string }) => {
  const [cycle, setCycle] = useState<PerfCycle | null>(null)
  const [participants, setParticipants] = useState<PerfParticipantItem[]>([])
  const [snapshot, setSnapshot] = useState<PerfCycleConfigSnapshot | null>(null)
  const [plan, setPlan] = useState<PerfCyclePlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [cycleData, participantData, snapshotData, planData] = await Promise.all([
        apiFetch<PerfCycle>(`/cycles/${cycleId}`),
        apiFetch<ListResponse<PerfParticipantItem>>(`/cycles/${cycleId}/participants`),
        getPerfCycleConfigSnapshot(Number(cycleId)).catch(() => null),
        getPerfCyclePlan(Number(cycleId)).catch(() => null)
      ])

      setCycle(cycleData)
      setParticipants(participantData.items ?? [])
      setSnapshot(snapshotData)
      setPlan(planData)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : '无法加载周期详情')
    } finally {
      setLoading(false)
    }
  }, [cycleId])

  useEffect(() => {
    const initialLoad = setTimeout(() => void fetchAll(), 0)

    return () => clearTimeout(initialLoad)
  }, [fetchAll])

  if (loading) {
    return (
      <div className='text-muted-foreground flex items-center justify-center gap-2 py-24'>
        <Loader2Icon className='size-4 animate-spin' />
        正在加载周期详情…
      </div>
    )
  }

  if (error || !cycle) {
    return (
      <div className='text-destructive flex flex-col items-center gap-3 py-24 text-sm'>
        {error ?? '周期不存在'}
        <Button variant='outline' size='sm' onClick={() => void fetchAll()}>
          重试
        </Button>
      </div>
    )
  }

  const total = participants.length
  const selfDone = participants.filter(participant => participant.selfReview?.status === 'SUBMITTED').length
  const managerDone = participants.filter(participant => participant.managerReview?.status === 'SUBMITTED').length
  const rate = (count: number) => (total > 0 ? `${Math.round((count / total) * 100)}%` : '-')
  const canEdit = cycle.status === 'DRAFT' || cycle.status === 'SCHEDULED'

  const overviewStats = [
    { label: '参与者', value: `${total} 人` },
    { label: '自评提交率', value: rate(selfDone) },
    { label: '上级评估完成率', value: rate(managerDone) },
    { label: '周期状态', value: CYCLE_STATUS_LABEL[cycle.status] }
  ]

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title={cycle.name}
        description={`计划启动时间：${formatDateTime(cycle.plannedStartAt)}`}
        actions={
          <div className='flex items-center gap-2'>
            <Badge className={CYCLE_STATUS_BADGE[cycle.status]}>{CYCLE_STATUS_LABEL[cycle.status]}</Badge>
            {canEdit && (
              <Button variant='outline' render={<Link href={`/cycles/${cycleId}/edit`} />} nativeButton={false}>
                <PencilIcon />
                编辑周期
              </Button>
            )}
          </div>
        }
      />

      <Tabs defaultValue='overview'>
        <TabsList>
          <TabsTrigger value='overview'>概览</TabsTrigger>
          <TabsTrigger value='members'>参与者</TabsTrigger>
          <TabsTrigger value='snapshot'>配置快照</TabsTrigger>
          <TabsTrigger value='plan'>实际计划</TabsTrigger>
        </TabsList>

        <TabsContent value='overview' className='mt-4'>
          <div className='flex flex-col gap-4'>
            <StatsCards items={overviewStats} />
            <Card>
              <CardHeader>
                <CardTitle>启动说明</CardTitle>
                <CardDescription>
                  {cycle.status === 'SCHEDULED'
                    ? '周期已通过启动检查，等待计划启动时间。当前不会提前生成可填写任务。'
                    : '任务开放读取实际计划；填写提醒时间仅触发通知，不关闭任务。'}
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value='members' className='mt-4'>
          <Card>
            <CardHeader>
              <CardTitle>参与者</CardTitle>
              <CardDescription>职级前缀与晋升评估标记均为周期快照。</CardDescription>
            </CardHeader>
            <CardContent>
              <MemberTable participants={participants} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='snapshot' className='mt-4'>
          <Card>
            <CardHeader>
              <CardTitle>独立配置快照</CardTitle>
              <CardDescription>
                {snapshot?.source
                  ? `来源：${snapshot.source.name} · v${snapshot.source.version}；后续模板更新不会影响本周期。`
                  : '未记录来源配置模板版本。'}
              </CardDescription>
            </CardHeader>
            <CardContent className='flex flex-wrap gap-2'>
              {snapshot?.forms.map(form => (
                <Badge key={form.id} variant='outline'>
                  {form.jobLevelPrefix} ·{' '}
                  {form.name ?? form.content?.name ?? `表单版本 #${form.sourceFormTemplateVersionId}`}
                </Badge>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='plan' className='mt-4'>
          <Card>
            <CardHeader>
              <CardTitle>三类任务实际计划</CardTitle>
              <CardDescription>填写提醒时间是软截止，不会关闭填写入口。</CardDescription>
            </CardHeader>
            <CardContent>
              <BasicDataTable data={plan?.stages ?? []} columns={stageWindowColumns} emptyText='尚未生成任务计划' />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default CycleDetail
