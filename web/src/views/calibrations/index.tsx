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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

// Util Imports
import { ApiError, apiFetch } from '@/lib/api'
import type { ListResponse, PerfCycle } from '@/lib/perf-api'
import { CYCLE_STATUS_LABEL } from '@/lib/perf-api'

import { buildCalibrationTableColumns } from './calibration-table-columns'
import type { CalibrationRow } from './calibration-table-columns'

// ===== 后端数据类型（NestJS /calibrations 模块） =====

/** GET /cycles/:cycleId/calibrations 响应 */
type CalibrationData = {
  items: CalibrationRow[]
  total: number

  /** 当前等级人数分布，如 { S: 4, A: 15 } */
  distribution: Record<string, number>

  /** 评分规则里的建议分布（可能为空） */
  suggestedDistribution: { level: string; minRatio?: number; maxRatio?: number }[] | null

  /** 本周期的等级序列（低 → 高由后端保证顺序） */
  levels: { level: string; description?: string }[]
}

const gradeChartConfig = {
  count: {
    label: '人数',
    color: 'var(--primary)'
  }
} satisfies ChartConfig

// 建议占比展示：后端 ratio 为 0-1 小数，统一转百分比
const formatRatio = (ratio?: number) => (ratio === undefined ? '-' : `${Math.round(ratio * 100)}%`)

// 「已校准及之后」的参与者状态：用于统计卡
const CALIBRATED_STATUSES = new Set(['CALIBRATED', 'RESULT_PUSHED', 'CONFIRMED', 'APPEALING', 'RE_CONFIRMING', 'ARCHIVED'])

/**
 * 校准工作台（HR 视角）：周期选择 + 员工校准 Data Table（filters + 行选择变体）+ 等级分布柱状图。
 * 支持行内等级调整（弹窗）、勾选多行后批量确认校准、以及向全部已校准者推送结果。
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

  // 调整弹窗：目标行 + 表单（等级下拉 + 调整原因）
  const [adjustTarget, setAdjustTarget] = useState<CalibrationRow | null>(null)
  const [afterLevel, setAfterLevel] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjusting, setAdjusting] = useState(false)

  // 批量确认 / 推送结果进行中状态
  const [confirming, setConfirming] = useState(false)
  const [pushing, setPushing] = useState(false)

  // 拉取周期列表：默认选中第一个非草稿周期
  const fetchCycles = useCallback(async () => {
    try {
      const result = await apiFetch<ListResponse<PerfCycle>>('/cycles')
      const items = result.items ?? []

      setCycles(items)

      const defaultCycle = items.find(cycle => cycle.status !== 'DRAFT') ?? items[0]

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

  // 等级序列（memo 保证 distributionData 的依赖稳定）
  const levels = useMemo(() => data?.levels ?? [], [data])

  // 等级筛选候选值（来自周期评分规则的等级序列）
  const levelOptions = levels.map(item => item.level)

  // 分布柱状图数据：按等级序列排序，缺失等级补 0
  const distributionData = useMemo(() => {
    const distribution = data?.distribution ?? {}

    if (levels.length > 0) {
      return levels.map(item => ({ level: item.level, count: distribution[item.level] ?? 0 }))
    }

    // 后端未返回等级序列时按 distribution 自身键值兜底
    return Object.entries(distribution).map(([level, count]) => ({ level, count }))
  }, [data, levels])

  // 顶部统计卡：从校准列表推导
  const calibratedCount = items.filter(item => CALIBRATED_STATUSES.has(item.status)).length

  const stats = [
    { label: '参与人数', value: `${data?.total ?? 0} 人` },
    { label: '已校准', value: `${calibratedCount} 人` },
    { label: '待校准', value: `${items.length - calibratedCount} 人` },
    { label: '等级调整', value: `${items.filter(item => item.adjusted).length} 人` }
  ]

  // 打开调整弹窗：等级默认取当前等级
  const handleOpenAdjust = useCallback((row: CalibrationRow) => {
    setAdjustTarget(row)
    setAfterLevel(row.currentLevel ?? '')
    setAdjustReason('')
  }, [])

  // 列定义：行内「调整」按钮回调走工厂注入
  const columns = useMemo(() => buildCalibrationTableColumns({ onAdjust: handleOpenAdjust }), [handleOpenAdjust])

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
    enableRowSelection: true,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableSortingRemoval: false
  })

  const selectedRows = table.getSelectedRowModel().rows
  const selectedCount = selectedRows.length

  // 提交等级调整：原因必填
  const handleAdjust = async () => {
    if (!adjustTarget) return

    if (!afterLevel) {
      toast.error('请选择调整后的等级')

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
      toast.success(`已将「${adjustTarget.employee?.name ?? '该员工'}」的等级调整为 ${afterLevel}`)
      setAdjustTarget(null)
      if (selectedCycleId) await fetchCalibrations(selectedCycleId)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '等级调整失败')
    } finally {
      setAdjusting(false)
    }
  }

  // 批量确认校准（选中行的 participantId）
  const handleBulkConfirm = async () => {
    if (!selectedCycleId || selectedCount === 0) return

    setConfirming(true)

    try {
      const participantIds = selectedRows.map(row => row.original.id)

      await apiFetch(`/cycles/${selectedCycleId}/calibrations/confirm`, {
        method: 'POST',
        body: JSON.stringify({ participantIds })
      })
      toast.success(`已确认 ${participantIds.length} 人的校准结果`)
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
      const result = await apiFetch<{ pushed: number }>(`/cycles/${selectedCycleId}/results/push`, {
        method: 'POST',
        body: JSON.stringify({})
      })

      toast.success(`已向 ${result.pushed ?? 0} 人推送绩效结果`)
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
        <PageHeader title='绩效校准' description='校准会议工作台：对齐评分尺度，按分布建议调整绩效等级' />
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
        description='校准会议工作台：对齐评分尺度，按分布建议调整绩效等级'
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
                <CardDescription>初评等级 vs 校准后当前等级</CardDescription>
              </CardHeader>
              <CardContent>
                {/* 工具栏：当前等级筛选 + 推送结果 */}
                <DataTableToolbar table={table}>
                  <DataTableColumnFilter
                    column={table.getColumn('currentLevel')}
                    label='等级'
                    options={levelOptions}
                  />
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

            {/* 等级分布柱状图 */}
            <Card>
              <CardHeader>
                <CardTitle>等级分布</CardTitle>
                <CardDescription>当前等级人数分布（低 → 高）</CardDescription>
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

                {/* 建议分布（评分规则配置了强制分布时展示） */}
                {data?.suggestedDistribution && data.suggestedDistribution.length > 0 && (
                  <div className='flex flex-col gap-1 text-sm'>
                    <span className='text-muted-foreground'>建议占比</span>
                    {data.suggestedDistribution.map(item => (
                      <div key={item.level} className='text-muted-foreground flex justify-between'>
                        <span>{item.level}</span>
                        <span>
                          {formatRatio(item.minRatio)} ~ {formatRatio(item.maxRatio)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* 等级调整弹窗：等级下拉（选项来自评分规则等级序列）+ 调整原因（必填） */}
      <Dialog open={!!adjustTarget} onOpenChange={open => !open && setAdjustTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>调整绩效等级</DialogTitle>
            <DialogDescription>
              {adjustTarget?.employee?.name ?? '-'} 当前等级 {adjustTarget?.currentLevel ?? '-'}
              ，调整将记录到审计日志
            </DialogDescription>
          </DialogHeader>

          <div className='flex flex-col gap-4'>
            <div className='flex flex-col gap-2'>
              <Label>调整后等级</Label>
              <Select
                items={levels.map(item => ({
                  label: item.description ? `${item.level}（${item.description}）` : item.level,
                  value: item.level
                }))}
                value={afterLevel || null}
                onValueChange={(value: string | null) => {
                  if (value) setAfterLevel(value)
                }}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue placeholder='选择等级' />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {levels.map(item => (
                      <SelectItem key={item.level} value={item.level}>
                        {item.description ? `${item.level}（${item.description}）` : item.level}
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
                placeholder='请说明本次等级调整的依据'
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
    </div>
  )
}

export default Calibrations
