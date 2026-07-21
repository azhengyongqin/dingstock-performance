'use client'

/**
 * 校准工作台（HR）：全宽精简表 + 顶部评级分布 StatsCards。
 * 布局来自原型方案 A：去掉侧栏柱状图，列精简为员工 / 初评→当前 / 状态。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ColumnFiltersState, PaginationState, RowSelectionState, SortingState } from '@tanstack/react-table'
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable
} from '@tanstack/react-table'
import { CheckIcon, Loader2Icon, SendIcon } from 'lucide-react'
import { toast } from 'sonner'

import {
  DataTable,
  DataTableBulkActionBar,
  DataTableColumnFilter,
  DataTablePagination,
  DataTableToolbar
} from '@/components/datatable'
import PageHeader from '@/components/shared/PageHeader'
import { isPerfPerformanceLevel, RATING_SOFT } from '@/components/shared/PerformanceLevelBadge'
import { EmptyState, RequestErrorState } from '@/components/shared/RequestErrorState'
import SearchInput from '@/components/shared/SearchInput'
import { StatsCards, type StatCardItem } from '@/components/shared/StatsCards'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ApiError, apiFetch } from '@/lib/api'
import type { EvaluationRating, ListResponse, PerfCycle } from '@/lib/perf-api'
import { CYCLE_STATUS_LABEL } from '@/lib/perf-api'
import { requestErrorMessage } from '@/lib/request-error'
import { cn } from '@/lib/utils'

import { buildCalibrationTableColumns, type CalibrationRow } from './calibration-table-columns'

/** GET /cycles/:cycleId/calibrations 响应 */
type CalibrationData = {
  items: CalibrationRow[]
  total: number
  distribution: Record<string, number>
  levels: EvaluationRating[]
}

/** 「已校准及之后」的参与者状态：用于进度统计 */
const CALIBRATED_STATUSES = new Set([
  'CALIBRATED',
  'RESULT_PUBLISHED',
  'CONFIRMED',
  'APPEALING',
  'RE_CONFIRMING'
])

const Calibrations = () => {
  const [cycles, setCycles] = useState<PerfCycle[]>([])
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null)
  const [data, setData] = useState<CalibrationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [forbidden, setForbidden] = useState(false)

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })
  const [search, setSearch] = useState('')

  const [adjustTarget, setAdjustTarget] = useState<CalibrationRow | null>(null)
  const [afterLevel, setAfterLevel] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjusting, setAdjusting] = useState(false)

  const [noResultTarget, setNoResultTarget] = useState<CalibrationRow | null>(null)
  const [noResultReason, setNoResultReason] = useState('')
  const [noResultSubmitting, setNoResultSubmitting] = useState(false)

  const [confirming, setConfirming] = useState(false)
  const [pushing, setPushing] = useState(false)

  const fetchCycles = useCallback(async () => {
    try {
      const result = await apiFetch<ListResponse<PerfCycle>>('/cycles')
      const items = (result.items ?? []).filter(cycle => cycle.status === 'ACTIVE')

      setCycles(items)

      const defaultCycle = items[0]

      setSelectedCycleId(defaultCycle ? String(defaultCycle.id) : null)

      if (!defaultCycle) setLoading(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setForbidden(true)
      } else {
        setError(err)
      }

      setLoading(false)
    }
  }, [])

  const fetchCalibrations = useCallback(async (cycleId: string) => {
    setLoading(true)
    setError(null)

    try {
      const result = await apiFetch<CalibrationData>(`/cycles/${cycleId}/calibrations`)

      setData(result)
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setForbidden(true)
      } else {
        setError(err)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchCycles()
  }, [fetchCycles])

  useEffect(() => {
    if (!selectedCycleId) return

    setRowSelection({})
    void fetchCalibrations(selectedCycleId)
  }, [selectedCycleId, fetchCalibrations])

  const items = useMemo(() => data?.items ?? [], [data])
  const levels = useMemo(() => data?.levels ?? [], [data])
  const levelOptions = levels.map(item => item.symbol)

  const distributionData = useMemo(() => {
    const distribution = data?.distribution ?? {}

    if (levels.length > 0) {
      return levels.map(item => ({
        level: item.symbol,
        name: item.name,
        count: distribution[item.symbol] ?? 0
      }))
    }

    return Object.entries(distribution).map(([level, count]) => ({ level, name: '', count }))
  }, [data, levels])

  const calibratedCount = items.filter(item => CALIBRATED_STATUSES.has(item.status)).length
  const pendingCount = items.length - calibratedCount
  const total = data?.total ?? 0
  const progressPct = total > 0 ? Math.round((calibratedCount / total) * 100) : 0
  const distTotal = distributionData.reduce((sum, item) => sum + item.count, 0) || 1

  // 评级分布：StatsCards 卡片（S/A/B/C）
  const gradeStatCards: StatCardItem[] = distributionData.map(item => {
    const soft = isPerfPerformanceLevel(item.level) ? RATING_SOFT[item.level] : null
    const pct = Math.round((item.count / distTotal) * 100)

    return {
      label: item.name ? `${item.level} · ${item.name}` : item.level,
      value: `${item.count} 人`,
      description: `占比 ${pct}%`,
      icon: <span className='text-sm font-semibold'>{item.level}</span>,
      iconClassName: soft ? cn(soft.bg, soft.text) : 'bg-primary/10 text-primary'
    }
  })

  const handleOpenAdjust = useCallback((row: CalibrationRow) => {
    setAdjustTarget(row)
    setAfterLevel(row.currentLevel ?? '')
    setAdjustReason('')
  }, [])

  const handleOpenNoResult = useCallback((row: CalibrationRow) => {
    setNoResultTarget(row)
    setNoResultReason('')
  }, [])

  const columns = useMemo(
    () => buildCalibrationTableColumns({ onAdjust: handleOpenAdjust, onNoResult: handleOpenNoResult }),
    [handleOpenAdjust, handleOpenNoResult]
  )

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase()

    if (!keyword) return items

    return items.filter(item => {
      const name = item.employee?.name?.toLowerCase() ?? ''
      const title = item.employee?.job_title?.toLowerCase() ?? ''

      return name.includes(keyword) || title.includes(keyword)
    })
  }, [items, search])

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filteredItems,
    columns,
    state: { rowSelection, columnFilters, sorting, pagination },
    onRowSelectionChange: setRowSelection,
    onColumnFiltersChange: setColumnFilters,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getRowId: row => String(row.id),
    enableRowSelection: row =>
      row.original.requiredEvaluations.ready && row.original.status !== 'NO_RESULT',
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableSortingRemoval: false
  })

  const selectedRows = table.getSelectedRowModel().rows
  const selectedCount = selectedRows.length

  const handleAdjust = async () => {
    if (!adjustTarget) return

    if (!afterLevel) {
      toast.error('请选择调整后的评级')

      return
    }

    if (!adjustReason.trim()) {
      toast.error('请填写调整原因')

      return
    }

    setAdjusting(true)

    try {
      await apiFetch(`/calibrations/${adjustTarget.id}/adjust`, {
        method: 'POST',
        body: JSON.stringify({ afterLevel, reason: adjustReason.trim() })
      })
      toast.success(`已将「${adjustTarget.employee?.name ?? '该员工'}」的评级调整为 ${afterLevel}`)
      setAdjustTarget(null)
      if (selectedCycleId) await fetchCalibrations(selectedCycleId)
    } catch (err) {
      toast.error(requestErrorMessage(err, '评级调整失败'))
    } finally {
      setAdjusting(false)
    }
  }

  const handleNoResult = async () => {
    if (!selectedCycleId || !noResultTarget) return

    if (!noResultReason.trim()) {
      toast.error('请填写操作原因')

      return
    }

    const revoking = noResultTarget.status === 'NO_RESULT'

    setNoResultSubmitting(true)

    try {
      const suffix = revoking ? '/no-result/revoke' : '/no-result'

      await apiFetch(`/cycles/${selectedCycleId}/participants/${noResultTarget.id}${suffix}`, {
        method: 'POST',
        body: JSON.stringify({ reason: noResultReason.trim() })
      })
      toast.success(revoking ? '已撤销当前周期无绩效结果' : '已标记为当前周期无绩效结果')
      setNoResultTarget(null)
      await fetchCalibrations(selectedCycleId)
    } catch (err) {
      toast.error(requestErrorMessage(err, revoking ? '撤销失败' : '标记失败'))
    } finally {
      setNoResultSubmitting(false)
    }
  }

  const handleBulkConfirm = async () => {
    if (!selectedCycleId || selectedCount === 0) return

    setConfirming(true)

    try {
      const participantIds = selectedRows.map(row => row.original.id)

      const result = await apiFetch<{ confirmed: number; skipped: number[] }>(
        `/cycles/${selectedCycleId}/calibrations/confirm`,
        {
          method: 'POST',
          body: JSON.stringify({ participantIds })
        }
      )

      toast.success(
        result.skipped.length > 0
          ? `已确认 ${result.confirmed} 人，跳过 ${result.skipped.length} 名已有校准决定的员工`
          : `已确认 ${result.confirmed} 人的校准结果`
      )
      table.resetRowSelection()
      await fetchCalibrations(selectedCycleId)
    } catch (err) {
      toast.error(requestErrorMessage(err, '批量确认失败'))
    } finally {
      setConfirming(false)
    }
  }

  const handlePush = async () => {
    if (!selectedCycleId) return

    setPushing(true)

    try {
      const result = await apiFetch<{ published: number; unchanged: number }>(
        `/cycles/${selectedCycleId}/results/push`,
        {
          method: 'POST',
          body: JSON.stringify({})
        }
      )

      toast.success(
        result.unchanged > 0
          ? `已向 ${result.published} 人推送绩效结果，${result.unchanged} 人结果未变化`
          : `已向 ${result.published} 人推送绩效结果`
      )
      await fetchCalibrations(selectedCycleId)
    } catch (err) {
      toast.error(requestErrorMessage(err, '推送结果失败'))
    } finally {
      setPushing(false)
    }
  }

  if (forbidden) {
    return (
      <div className='flex flex-col gap-6'>
        <PageHeader title='绩效校准' description='校准会议工作台：对齐评估尺度，确认绩效评级' />
        <Card>
          <CardContent>
            <RequestErrorState
              kind='forbidden'
              description='需要 HR 权限，当前账号无权访问校准工作台'
              size='card'
            />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='绩效校准'
        description='校准会议工作台：对齐评估尺度，确认绩效评级'
        actions={
          <Select
            items={cycles.map(cycle => ({
              label: `${cycle.name}（${CYCLE_STATUS_LABEL[cycle.status]}）`,
              value: String(cycle.id)
            }))}
            value={selectedCycleId}
            onValueChange={(value: string | null) => {
              if (value) setSelectedCycleId(value)
            }}
          >
            <SelectTrigger className='min-w-48'>
              <SelectValue placeholder='选择周期' />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {cycles.map(cycle => (
                  <SelectItem key={cycle.id} value={String(cycle.id)}>
                    {cycle.name}（{CYCLE_STATUS_LABEL[cycle.status]}）
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        }
      />

      {loading ? (
        <div className='text-muted-foreground flex items-center justify-center gap-2 py-24'>
          <Loader2Icon className='size-4 animate-spin' />
          正在加载校准数据…
        </div>
      ) : error ? (
        <RequestErrorState
          error={error}
          size='page'
          onRetry={() => (selectedCycleId ? void fetchCalibrations(selectedCycleId) : void fetchCycles())}
        />
      ) : !selectedCycleId ? (
        <Card>
          <CardContent>
            <EmptyState
              title='暂无绩效周期'
              description='请先到「绩效周期」页面创建并启动周期'
              size='card'
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 评级分布：小屏 1 → sm~md 之间 2 → 中屏及以上 4 */}
          {gradeStatCards.length > 0 && (
            <StatsCards items={gradeStatCards} className='grid-cols-1 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-4' />
          )}

          <div className='flex flex-col gap-2'>
            <div className='flex flex-wrap items-baseline justify-between gap-2 text-sm'>
              <span className='font-medium'>校准进度 {progressPct}%</span>
              <span className='text-muted-foreground'>
                已校准 {calibratedCount} · 待校准 {pendingCount} · 共 {total}
              </span>
            </div>
            <Progress value={progressPct} className='w-full gap-0' />
          </div>

          <Card className='gap-0 py-0 shadow-none'>
            <div className='flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3'>
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder='搜索员工姓名或职位…'
                className='max-w-64'
              />
              <DataTableToolbar table={table}>
                <DataTableColumnFilter
                  column={table.getColumn('currentLevel')}
                  label='评级'
                  options={levelOptions}
                />
                <Button variant='outline' size='sm' onClick={handlePush} disabled={pushing}>
                  {pushing ? <Loader2Icon className='animate-spin' /> : <SendIcon />}
                  推送结果
                </Button>
              </DataTableToolbar>
            </div>

            {selectedCount > 0 && (
              <div className='border-b px-4 py-2'>
                <DataTableBulkActionBar
                  selectedCount={selectedCount}
                  onClearSelection={() => table.resetRowSelection()}
                >
                  <Button size='sm' onClick={handleBulkConfirm} disabled={confirming}>
                    {confirming ? <Loader2Icon className='animate-spin' /> : <CheckIcon />}
                    确认校准
                  </Button>
                </DataTableBulkActionBar>
              </div>
            )}

            <div className='px-2'>
              <DataTable table={table} emptyText='当前周期暂无校准对象' />
            </div>
            <div className='border-t px-4 py-2'>
              <DataTablePagination table={table} />
            </div>
          </Card>
        </>
      )}

      <Dialog open={!!adjustTarget} onOpenChange={open => !open && setAdjustTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>调整绩效评级</DialogTitle>
            <DialogDescription>
              {adjustTarget?.employee?.name ?? '-'} 当前评级 {adjustTarget?.currentLevel ?? '-'}
              ，调整将记录到审计日志
            </DialogDescription>
          </DialogHeader>

          <div className='flex flex-col gap-4'>
            <div className='flex flex-col gap-2'>
              <Label>调整后评级</Label>
              <Select
                items={levels.map(item => ({
                  label: item.name ? `${item.symbol}（${item.name}）` : item.symbol,
                  value: item.symbol
                }))}
                value={afterLevel || null}
                onValueChange={(value: string | null) => {
                  if (value) setAfterLevel(value)
                }}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue placeholder='选择评级' />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {levels.map(item => (
                      <SelectItem key={item.symbol} value={item.symbol}>
                        {item.name ? `${item.symbol}（${item.name}）` : item.symbol}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className='flex flex-col gap-2'>
              <Label>调整原因（必填）</Label>
              <Textarea
                value={adjustReason}
                onChange={event => setAdjustReason(event.target.value)}
                placeholder='请说明本次评级调整的依据'
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant='outline' onClick={() => setAdjustTarget(null)}>
              取消
            </Button>
            <Button onClick={handleAdjust} disabled={adjusting}>
              {adjusting && <Loader2Icon className='animate-spin' />}
              确认调整
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!noResultTarget} onOpenChange={open => !open && setNoResultTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {noResultTarget?.status === 'NO_RESULT' ? '撤销当前周期无绩效结果' : '设为当前周期无绩效结果'}
            </DialogTitle>
            <DialogDescription>
              {noResultTarget?.status === 'NO_RESULT'
                ? '撤销后恢复未完成评估任务，并保留原有草稿和有效提交。'
                : '仅适用于员工始终没有正式提交自评；该操作不会生成绩效结果，也不等同于退出周期。'}
            </DialogDescription>
          </DialogHeader>

          <div className='flex flex-col gap-2'>
            <Label>操作原因（必填）</Label>
            <Textarea
              value={noResultReason}
              onChange={event => setNoResultReason(event.target.value)}
              placeholder='请说明标记或撤销的具体原因'
            />
          </div>

          <DialogFooter>
            <Button variant='outline' onClick={() => setNoResultTarget(null)}>
              取消
            </Button>
            <Button onClick={handleNoResult} disabled={noResultSubmitting}>
              {noResultSubmitting && <Loader2Icon className='animate-spin' />}
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default Calibrations
