'use client'

// React Imports
import { useCallback, useEffect, useMemo, useState } from 'react'

// Third-party Imports
import type { ColumnFiltersState, PaginationState, RowSelectionState, SortingState } from '@tanstack/react-table'
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable
} from '@tanstack/react-table'
import { CheckIcon, Loader2Icon, SendIcon, ShieldAlertIcon } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'

// Component Imports
import {
  DataTable,
  DataTableBulkActionBar,
  DataTableColumnFilter,
  DataTablePagination,
  DataTableToolbar
} from '@/components/datatable'
import PageHeader from '@/components/shared/PageHeader'
import { StatsCards } from '@/components/shared/StatsCards'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

// Util Imports
import { ApiError, apiFetch } from '@/lib/api'
import type { EvaluationRating, ListResponse, PerfCycle } from '@/lib/perf-api'
import { CYCLE_STATUS_LABEL } from '@/lib/perf-api'

import { buildCalibrationTableColumns } from './calibration-table-columns'
import type { CalibrationRow } from './calibration-table-columns'

// ===== 后端数据类型（NestJS /calibrations 模块） =====

/** GET /cycles/:cycleId/calibrations 响应 */
type CalibrationData = {
  items: CalibrationRow[]
  total: number

  /** 当前评级人数分布，如 { S: 4, A: 15 } */
  distribution: Record<string, number>

  /** 本周期的评级序列（低 → 高由后端保证顺序） */
  levels: EvaluationRating[]
}

const gradeChartConfig = {
  count: {
    label: '人数',
    color: 'var(--primary)'
  }
} satisfies ChartConfig

// 「已校准及之后」的参与者状态：用于统计卡
const CALIBRATED_STATUSES = new Set([
  'CALIBRATED',
  'RESULT_PUBLISHED',
  'CONFIRMED',
  'APPEALING',
  'RE_CONFIRMING'
])

/**
 * 校准工作台（HR 视角）：周期选择 + 员工校准 Data Table（filters + 行选择变体）+ 评级分布柱状图。
 * 支持行内评级调整（弹窗）、勾选多行后批量确认校准、以及向全部已校准者推送结果。
 */
const Calibrations = () => {
  // 周期列表与当前选中周期
  const [cycles, setCycles] = useState<PerfCycle[]>([])
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null)

  // 校准数据
  const [data, setData] = useState<CalibrationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 403：需要 HR 权限
  const [forbidden, setForbidden] = useState(false)

  // 行选择、列筛选、排序与分页状态
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })

  // 调整弹窗：目标行 + 表单（评级下拉 + 调整原因）
  const [adjustTarget, setAdjustTarget] = useState<CalibrationRow | null>(null)
  const [afterLevel, setAfterLevel] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjusting, setAdjusting] = useState(false)

  // 当前周期无绩效结果：只有缺失 SELF 时可标记，归档前可带原因撤销。
  const [noResultTarget, setNoResultTarget] = useState<CalibrationRow | null>(null)
  const [noResultReason, setNoResultReason] = useState('')
  const [noResultSubmitting, setNoResultSubmitting] = useState(false)

  // 批量确认 / 推送结果进行中状态
  const [confirming, setConfirming] = useState(false)
  const [pushing, setPushing] = useState(false)

  // 拉取周期列表：默认选中第一个非草稿周期
  const fetchCycles = useCallback(async () => {
    try {
      const result = await apiFetch<ListResponse<PerfCycle>>('/cycles')
      const items = (result.items ?? []).filter(cycle => cycle.status === 'ACTIVE')

      setCycles(items)

      // 待启动周期尚未生成评估任务，不能成为校准页默认周期。
      const defaultCycle = items[0]

      setSelectedCycleId(defaultCycle ? String(defaultCycle.id) : null)

      // 没有任何周期时直接结束加载态
      if (!defaultCycle) setLoading(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setForbidden(true)
      } else {
        setError(err instanceof Error ? err.message : '无法加载周期列表，请确认后端服务已启动。')
      }

      setLoading(false)
    }
  }, [])

  // 拉取选中周期的校准数据
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
        setError(err instanceof Error ? err.message : '无法加载校准数据，请确认后端服务已启动。')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchCycles()
  }, [fetchCycles])

  // 切换周期时重新拉取校准数据并清空行选择
  useEffect(() => {
    if (!selectedCycleId) return

    setRowSelection({})
    void fetchCalibrations(selectedCycleId)
  }, [selectedCycleId, fetchCalibrations])

  const items = data?.items ?? []

  // 评级序列（memo 保证 distributionData 的依赖稳定）
  const levels = useMemo(() => data?.levels ?? [], [data])

  // 评级筛选候选值（来自周期评估规则的评级序列）
  const levelOptions = levels.map(item => item.symbol)

  // 分布柱状图数据：按评级序列排序，缺失评级补 0
  const distributionData = useMemo(() => {
    const distribution = data?.distribution ?? {}

    if (levels.length > 0) {
      return levels.map(item => ({ level: item.symbol, count: distribution[item.symbol] ?? 0 }))
    }

    // 后端未返回评级序列时按 distribution 自身键值兜底
    return Object.entries(distribution).map(([level, count]) => ({ level, count }))
  }, [data, levels])

  // 顶部统计卡：从校准列表推导
  const calibratedCount = items.filter(item => CALIBRATED_STATUSES.has(item.status)).length

  const stats = [
    { label: '参与人数', value: `${data?.total ?? 0} 人` },
    { label: '已校准', value: `${calibratedCount} 人` },
    { label: '待校准', value: `${items.length - calibratedCount} 人` },
    { label: '评级调整', value: `${items.filter(item => item.adjusted).length} 人` }
  ]

  // 打开调整弹窗：评级默认取当前评级
  const handleOpenAdjust = useCallback((row: CalibrationRow) => {
    setAdjustTarget(row)
    setAfterLevel(row.currentLevel ?? '')
    setAdjustReason('')
  }, [])

  const handleOpenNoResult = useCallback((row: CalibrationRow) => {
    setNoResultTarget(row)
    setNoResultReason('')
  }, [])

  // 列定义：行内「调整」按钮回调走工厂注入
  const columns = useMemo(
    () => buildCalibrationTableColumns({ onAdjust: handleOpenAdjust, onNoResult: handleOpenNoResult }),
    [handleOpenAdjust, handleOpenNoResult]
  )

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: items,
    columns,
    state: { rowSelection, columnFilters, sorting, pagination },
    onRowSelectionChange: setRowSelection,
    onColumnFiltersChange: setColumnFilters,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getRowId: row => String(row.id),

    // 只有必交 SELF/MANAGER 均已有当前有效提交的行才允许进入批量校准。
    enableRowSelection: row => row.original.requiredEvaluations.ready && row.original.status !== 'NO_RESULT',
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableSortingRemoval: false
  })

  const selectedRows = table.getSelectedRowModel().rows
  const selectedCount = selectedRows.length

  // 提交评级调整：原因必填
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
      toast.error(err instanceof ApiError ? err.message : '评级调整失败')
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
      toast.error(err instanceof ApiError ? err.message : revoking ? '撤销失败' : '标记失败')
    } finally {
      setNoResultSubmitting(false)
    }
  }

  // 批量确认校准（选中行的 participantId）
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
      toast.error(err instanceof ApiError ? err.message : '批量确认失败')
    } finally {
      setConfirming(false)
    }
  }

  // 推送结果：对全部已校准者生效
  const handlePush = async () => {
    if (!selectedCycleId) return

    setPushing(true)

    try {
      const result = await apiFetch<{ published: number; unchanged: number }>(`/cycles/${selectedCycleId}/results/push`, {
        method: 'POST',
        body: JSON.stringify({})
      })

      toast.success(
        result.unchanged > 0
          ? `已向 ${result.published} 人推送绩效结果，${result.unchanged} 人结果未变化`
          : `已向 ${result.published} 人推送绩效结果`
      )
      await fetchCalibrations(selectedCycleId)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '推送结果失败')
    } finally {
      setPushing(false)
    }
  }

  // 403：需要 HR 权限
  if (forbidden) {
    return (
      <div className='flex flex-col gap-6'>
        <PageHeader title='绩效校准' description='校准会议工作台：对齐评估尺度，确认绩效评级' />
        <Card>
          <CardContent>
            <div className='text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-sm'>
              <ShieldAlertIcon className='size-6' />
              <span>需要 HR 权限，当前账号无权访问校准工作台</span>
            </div>
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

          // 周期选择：默认选中第一个非草稿周期
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
        <div className='text-destructive flex flex-col items-center gap-3 py-24 text-sm'>
          {error}
          <Button
            variant='outline'
            size='sm'
            onClick={() => (selectedCycleId ? void fetchCalibrations(selectedCycleId) : void fetchCycles())}
          >
            重试
          </Button>
        </div>
      ) : !selectedCycleId ? (
        <Card>
          <CardContent>
            <div className='text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-sm'>
              <span>暂无绩效周期，请先到「绩效周期」页面创建并启动周期</span>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 顶部统计卡 */}
          <StatsCards items={stats} />

          <div className='grid gap-6 lg:grid-cols-3'>
            {/* 员工校准列表 */}
            <Card className='lg:col-span-2'>
              <CardHeader>
                <CardTitle>员工校准列表</CardTitle>
                <CardDescription>初评评级 vs 校准后当前评级</CardDescription>
              </CardHeader>
              <CardContent>
                {/* 工具栏：当前评级筛选 + 推送结果 */}
                <DataTableToolbar table={table}>
                  <DataTableColumnFilter column={table.getColumn('currentLevel')} label='评级' options={levelOptions} />
                  <Button variant='outline' size='sm' onClick={handlePush} disabled={pushing}>
                    {pushing ? <Loader2Icon className='animate-spin' /> : <SendIcon />}
                    推送结果
                  </Button>
                </DataTableToolbar>

                {/* 批量操作条：勾选后展示已选数量与批量操作 */}
                {selectedCount > 0 && (
                  <div className='pb-4'>
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

                <DataTable table={table} emptyText='当前周期暂无校准对象' />

                <DataTablePagination table={table} />
              </CardContent>
            </Card>

            {/* 评级分布柱状图 */}
            <Card>
              <CardHeader>
                <CardTitle>评级分布</CardTitle>
                <CardDescription>当前评级人数分布（低 → 高）</CardDescription>
              </CardHeader>
              <CardContent className='flex flex-col gap-4'>
                <ChartContainer config={gradeChartConfig} className='h-64 w-full'>
                  <BarChart accessibilityLayer data={distributionData}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey='level' tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                    <Bar dataKey='count' fill='var(--color-count)' radius={6} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* 评级调整弹窗：评级下拉（选项来自评估规则评级序列）+ 调整原因（必填） */}
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
