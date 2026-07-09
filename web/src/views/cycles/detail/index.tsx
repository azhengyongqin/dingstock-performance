'use client'

// React Imports
import { useCallback, useEffect, useState } from 'react'

// Next Imports
import Link from 'next/link'

// Third-party Imports
import type { ColumnDef, PaginationState, VisibilityState } from '@tanstack/react-table'
import { getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import { ArchiveIcon, CheckCircle2Icon, Loader2Icon, PencilIcon, PlayIcon, XCircleIcon } from 'lucide-react'
import { toast } from 'sonner'

// Component Imports
import { DataTable, DataTablePagination, DataTableToolbar, DataTableViewOptions } from '@/components/datatable'
import PageHeader from '@/components/shared/PageHeader'
import { StatsCards } from '@/components/shared/StatsCards'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

// Util Imports
import { ApiError, apiFetch } from '@/lib/api'
import type { ListResponse, PerfCycle, PerfParticipantItem, StartCheckItem } from '@/lib/perf-api'
import { CYCLE_STATUS_BADGE, CYCLE_STATUS_LABEL, CYCLE_TYPE_LABEL, formatDate } from '@/lib/perf-api'

import { WINDOW_STAGE_LABEL, dimensionColumns, participantColumns, stageWindowColumns } from './cycle-detail-columns'
import type { StageWindowRow } from './cycle-detail-columns'

/** 基础 Data Table（basic 变体）：只做 useReactTable 渲染，无分页/筛选 */
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
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    enableSorting: false
  })

  return <DataTable table={table} emptyText={emptyText} />
}

/** 考核人员表格：「列显隐 + 分页」变体 */
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

      <DataTable table={table} emptyText='尚未添加考核人员，请到「编辑周期」中圈人' />

      <DataTablePagination table={table} />
    </>
  )
}

/**
 * 周期详情：Tabs 组织「概览 / 考核人员 / 评估维度 / 时间窗口」。
 * 数据来自 GET /cycles/:id 与 GET /cycles/:id/participants；
 * 支持启动前检查（弹窗展示检查项）、启动、归档等生命周期操作。
 */
const CycleDetail = ({ cycleId }: { cycleId: string }) => {
  const [cycle, setCycle] = useState<PerfCycle | null>(null)
  const [participants, setParticipants] = useState<PerfParticipantItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 启动前检查弹窗
  const [checkOpen, setCheckOpen] = useState(false)
  const [checkItems, setCheckItems] = useState<StartCheckItem[]>([])
  const [checkOk, setCheckOk] = useState(false)
  const [starting, setStarting] = useState(false)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [cycleData, participantData] = await Promise.all([
        apiFetch<PerfCycle>(`/cycles/${cycleId}`),
        apiFetch<ListResponse<PerfParticipantItem>>(`/cycles/${cycleId}/participants`)
      ])

      setCycle(cycleData)
      setParticipants(participantData.items ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法加载周期详情')
    } finally {
      setLoading(false)
    }
  }, [cycleId])

  useEffect(() => {
    // 延迟到宏任务，避免在 effect 内同步 setState 触发级联渲染
    const initialLoad = setTimeout(() => void fetchAll(), 0)

    return () => clearTimeout(initialLoad)
  }, [fetchAll])

  // 启动前检查
  const handleStartCheck = async () => {
    try {
      const data = await apiFetch<{ items: StartCheckItem[]; ok: boolean }>(`/cycles/${cycleId}/start-check`)

      setCheckItems(data.items)
      setCheckOk(data.ok)
      setCheckOpen(true)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '启动检查失败')
    }
  }

  // 确认启动
  const handleStart = async () => {
    setStarting(true)

    try {
      await apiFetch(`/cycles/${cycleId}/start`, { method: 'POST' })
      toast.success('周期已启动，进入员工自评阶段')
      setCheckOpen(false)
      await fetchAll()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '启动失败')
    } finally {
      setStarting(false)
    }
  }

  // 归档
  const handleClose = async () => {
    try {
      await apiFetch(`/cycles/${cycleId}/close`, { method: 'POST' })
      toast.success('周期已归档')
      await fetchAll()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '归档失败')
    }
  }

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

  // 概览统计（自评/评审完成率按参与者状态推导）
  const total = participants.length
  const selfDone = participants.filter(p => p.selfReview?.status === 'SUBMITTED').length
  const reviewDone = participants.filter(p => p.managerReview?.status === 'SUBMITTED').length
  const rate = (count: number) => (total > 0 ? `${Math.round((count / total) * 100)}%` : '-')

  const overviewStats = [
    { label: '参评人数', value: `${total} 人` },
    { label: '自评提交率', value: rate(selfDone) },
    { label: '上级评估完成率', value: rate(reviewDone) },
    { label: '当前阶段', value: CYCLE_STATUS_LABEL[cycle.status] }
  ]

  // 时间窗口 JSON → 行
  const windowRows: StageWindowRow[] = Object.entries(cycle.windows ?? {}).map(([key, value]) => ({
    stage: WINDOW_STAGE_LABEL[key] ?? key,
    startAt: value?.startAt,
    endAt: value?.endAt
  }))

  const canStart = cycle.status === 'DRAFT' || cycle.status === 'PENDING'
  const canClose = cycle.status === 'CONFIRMING'

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title={cycle.name}
        description={`${CYCLE_TYPE_LABEL[cycle.type]}考核 · ${formatDate(cycle.startDate)} ~ ${formatDate(cycle.endDate)}`}
        actions={
          <div className='flex items-center gap-2'>
            <Badge className={CYCLE_STATUS_BADGE[cycle.status]}>{CYCLE_STATUS_LABEL[cycle.status]}</Badge>
            {canStart && (
              <Button onClick={() => void handleStartCheck()}>
                <PlayIcon />
                启动周期
              </Button>
            )}
            {canClose && (
              <Button variant='outline' onClick={() => void handleClose()}>
                <ArchiveIcon />
                归档周期
              </Button>
            )}
            <Button variant='outline' render={<Link href={`/cycles/${cycleId}/edit`} />} nativeButton={false}>
              <PencilIcon />
              编辑周期
            </Button>
          </div>
        }
      />

      <Tabs defaultValue='overview'>
        <TabsList>
          <TabsTrigger value='overview'>概览</TabsTrigger>
          <TabsTrigger value='members'>考核人员</TabsTrigger>
          <TabsTrigger value='dimensions'>评估维度</TabsTrigger>
          <TabsTrigger value='windows'>时间窗口</TabsTrigger>
        </TabsList>

        {/* 概览 */}
        <TabsContent value='overview' className='mt-4'>
          <div className='flex flex-col gap-4'>
            <StatsCards items={overviewStats} />
            <Card>
              <CardHeader>
                <CardTitle>来源模板</CardTitle>
                <CardDescription>
                  {cycle.template?.name ?? '未记录来源模板'} ·
                  创建时或最近套用时复制；当前评分规则与评估维度是周期配置快照，可能已被手动修改。
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </TabsContent>

        {/* 考核人员：列显隐 + 分页 */}
        <TabsContent value='members' className='mt-4'>
          <Card>
            <CardHeader>
              <CardTitle>考核人员</CardTitle>
              <CardDescription>参评人员及各环节进度（人员圈定在「编辑周期」中操作）</CardDescription>
            </CardHeader>
            <CardContent>
              <MemberTable participants={participants} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* 评估维度 */}
        <TabsContent value='dimensions' className='mt-4'>
          <Card>
            <CardHeader>
              <CardTitle>评估维度与权重</CardTitle>
              <CardDescription>维度权重仅用于展示重要性；按适用分组分别合计 100%</CardDescription>
            </CardHeader>
            <CardContent>
              <BasicDataTable data={cycle.dimensions ?? []} columns={dimensionColumns} emptyText='尚未配置评估维度' />
            </CardContent>
          </Card>
        </TabsContent>

        {/* 时间窗口 */}
        <TabsContent value='windows' className='mt-4'>
          <Card>
            <CardHeader>
              <CardTitle>各阶段时间窗口</CardTitle>
              <CardDescription>用于调度提醒与催办；启动后调整视为延长窗口并记录审计</CardDescription>
            </CardHeader>
            <CardContent>
              <BasicDataTable data={windowRows} columns={stageWindowColumns} emptyText='尚未配置时间窗口' />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 启动前检查弹窗 */}
      <Dialog open={checkOpen} onOpenChange={setCheckOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>启动前检查</DialogTitle>
            <DialogDescription>启动后人员名单与维度配置将锁定，请确认以下检查项</DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-2'>
            {checkItems.map(item => (
              <div key={item.key} className='flex items-start gap-2 text-sm'>
                {item.ok ? (
                  <CheckCircle2Icon className='mt-0.5 size-4 shrink-0 text-green-600' />
                ) : (
                  <XCircleIcon className='text-destructive mt-0.5 size-4 shrink-0' />
                )}
                <span className={item.ok ? '' : 'text-destructive'}>{item.message}</span>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setCheckOpen(false)}>
              取消
            </Button>
            <Button disabled={!checkOk || starting} onClick={() => void handleStart()}>
              {starting && <Loader2Icon className='size-4 animate-spin' />}
              确认启动
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default CycleDetail
