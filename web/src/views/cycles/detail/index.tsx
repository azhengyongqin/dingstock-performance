'use client'

import { useCallback, useEffect, useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import type { ColumnDef, PaginationState, VisibilityState } from '@tanstack/react-table'
import { getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import { Loader2Icon, PencilIcon } from 'lucide-react'

import { DataTable, DataTablePagination, DataTableToolbar, DataTableViewOptions } from '@/components/datatable'
import PageHeader from '@/components/shared/PageHeader'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
  PerfCycleProgress,
  PerfParticipantItem
} from '@/lib/perf-api'
import {
  CYCLE_STATUS_BADGE,
  CYCLE_STATUS_LABEL,
  formatDateTime,
  getPerfCycleConfigSnapshot,
  getPerfCyclePlan,
  getPerfCycleProgress
} from '@/lib/perf-api'

import { participantColumns, stageWindowColumns } from './cycle-detail-columns'
import CycleProgressDashboard from './cycle-progress-dashboard'
import SnapshotProvenanceCard from './snapshot-provenance-card'

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
  const router = useRouter()
  const [cycle, setCycle] = useState<PerfCycle | null>(null)
  const [participants, setParticipants] = useState<PerfParticipantItem[]>([])
  const [snapshot, setSnapshot] = useState<PerfCycleConfigSnapshot | null>(null)
  const [plan, setPlan] = useState<PerfCyclePlan | null>(null)
  const [progress, setProgress] = useState<PerfCycleProgress | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'members' | 'snapshot' | 'plan'>('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // 进度接口异常时保留详情骨架，但绝不回退用旧参与者状态猜测任务进度。
      const [cycleData, participantData, snapshotData, planData, progressData] = await Promise.all([
        apiFetch<PerfCycle>(`/cycles/${cycleId}`),
        apiFetch<ListResponse<PerfParticipantItem>>(`/cycles/${cycleId}/participants`),
        getPerfCycleConfigSnapshot(Number(cycleId)).catch(() => null),
        getPerfCyclePlan(Number(cycleId)).catch(() => null),
        getPerfCycleProgress(Number(cycleId)).catch(() => null)
      ])

      setCycle(cycleData)
      setParticipants(participantData.items ?? [])
      setSnapshot(snapshotData)
      setPlan(planData)
      setProgress(progressData)
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

  const canEdit = cycle.status !== 'ARCHIVED'

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

      <Tabs value={activeTab} onValueChange={value => setActiveTab(value as typeof activeTab)}>
        <TabsList>
          <TabsTrigger value='overview'>概览</TabsTrigger>
          <TabsTrigger value='members'>参与者</TabsTrigger>
          <TabsTrigger value='snapshot'>配置快照</TabsTrigger>
          <TabsTrigger value='plan'>实际计划</TabsTrigger>
        </TabsList>

        <TabsContent value='overview' className='mt-4'>
          {progress ? (
            <CycleProgressDashboard
              progress={progress}
              onNavigate={target => {
                if (progress.cycle.status !== 'ARCHIVED') {
                  router.push(`/cycles/${cycleId}/edit`)

                  return
                }

                if (target === 'participants') setActiveTab('members')
                if (target === 'plan') setActiveTab('plan')
                if (target === 'basic' || target === 'advanced') setActiveTab('snapshot')
              }}
            />
          ) : (
            <Alert variant='destructive'>
              <AlertTitle>无法读取任务事实</AlertTitle>
              <AlertDescription>请刷新后重试；周期看板不会回退使用细粒度周期状态猜测进度。</AlertDescription>
            </Alert>
          )}
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
          <SnapshotProvenanceCard snapshot={snapshot} />
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
