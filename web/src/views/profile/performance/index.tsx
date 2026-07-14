'use client'

// React Imports
import { useCallback, useEffect, useMemo, useState } from 'react'

// Third-party Imports
import type { PaginationState } from '@tanstack/react-table'
import { getCoreRowModel, getPaginationRowModel, useReactTable } from '@tanstack/react-table'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'

// Component Imports
import { DataTable, DataTablePagination } from '@/components/datatable'
import PageHeader from '@/components/shared/PageHeader'
import { UserAvatar } from '@/components/shared/lark'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'

// Util Imports
import { apiFetch, getStoredUser } from '@/lib/api'
import type { LarkUserBrief } from '@/lib/perf-api'
import { avatarUrlOf } from '@/lib/perf-api'

import { levelToValue, performanceHistoryColumns } from './performance-history-columns'
import type { PerformanceHistoryRow } from './performance-history-columns'

// ===== 后端数据类型（GET /profiles/{openId}/performance） =====

/** 个人绩效档案 */
type PerformanceProfileData = {
  employee: LarkUserBrief | null
  items: PerformanceHistoryRow[]
  total: number
}

// 等级趋势图配置：单条「绩效等级」曲线
const trendChartConfig = {
  levelValue: { label: '绩效等级', color: 'var(--primary)' }
} satisfies ChartConfig

// 趋势图纵轴刻度 → 等级字母
const LEVEL_TICK_LABEL: Record<number, string> = { 5: 'S', 4: 'A', 3: 'B', 2: 'C', 1: 'D' }

/**
 * 个人绩效档案（真实后端 /profiles/{openId}/performance）：
 * 历史周期表格（basic 变体 + 分页）+ 等级趋势图（recharts LineChart）。
 * openId 取当前登录人（getStoredUser）。
 */
const PerformanceProfile = () => {
  // 当前登录人 open_id（客户端读取 localStorage，需在挂载后取值）
  const [openId, setOpenId] = useState<string | null | undefined>(undefined)

  // 档案数据
  const [data, setData] = useState<PerformanceProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 表格分页状态
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })

  // 拉取个人绩效档案
  const fetchProfile = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)

    try {
      const result = await apiFetch<PerformanceProfileData>(`/profiles/${encodeURIComponent(id)}/performance`)

      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法加载绩效档案，请确认后端服务已启动。')
    } finally {
      setLoading(false)
    }
  }, [])

  // 挂载后读取登录人并加载档案
  useEffect(() => {
    const id = getStoredUser()?.openId ?? null

    setOpenId(id)

    if (id) {
      void fetchProfile(id)
    } else {
      setLoading(false)
    }
  }, [fetchProfile])

  const items = useMemo(() => data?.items ?? [], [data])

  // 周期名称承担业务期间表达；趋势只按归档时间排序，不再读取已移除的考核期间日期。
  const trendData = useMemo(
    () =>
      [...items]
        .sort((a, b) => {
          const aTime = a.archivedAt ? new Date(a.archivedAt).getTime() : a.cycle.id
          const bTime = b.archivedAt ? new Date(b.archivedAt).getTime() : b.cycle.id

          return aTime - bTime
        })
        .map(item => ({
          cycle: item.cycle.name,
          levelValue: levelToValue(item.finalLevel),
          level: item.finalLevel
        })),
    [items]
  )

  // 历史周期表格：basic 变体 + 分页
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: items,
    columns: performanceHistoryColumns,
    state: { pagination },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableSorting: false
  })

  // 未登录（无 openId）空态；openId 为 undefined 表示尚未完成客户端读取
  if (openId === null) {
    return (
      <div className='flex flex-col gap-6'>
        <PageHeader title='个人绩效档案' description='历史绩效周期的结果归档与等级趋势' />
        <Card>
          <CardContent className='text-muted-foreground flex flex-col items-center gap-2 py-16 text-sm'>
            <span>未获取到登录信息</span>
            <span>请先通过飞书登录后再查看个人绩效档案</span>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='个人绩效档案'
        description='历史绩效周期的结果归档与等级趋势'
        actions={
          data?.employee ? (
            <div className='flex items-center gap-2'>
              <UserAvatar
                openId={data.employee.open_id}
                name={data.employee.name}
                avatarUrl={avatarUrlOf(data.employee)}
                size='sm'
              />
              <span className='text-sm font-medium'>{data.employee.name}</span>
            </div>
          ) : undefined
        }
      />

      {loading || openId === undefined ? (

        // 加载态
        <div className='grid gap-6 lg:grid-cols-2'>
          <Skeleton className='h-80 w-full' />
          <Skeleton className='h-80 w-full' />
        </div>
      ) : error ? (

        // 错误态
        <Card>
          <CardContent className='text-muted-foreground flex flex-col items-center gap-3 py-16 text-sm'>
            <span>{error}</span>
            <Button variant='outline' size='sm' onClick={() => void fetchProfile(openId)}>
              重试
            </Button>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (

        // 空态：还没有归档周期
        <Card>
          <CardContent className='text-muted-foreground flex flex-col items-center gap-2 py-16 text-sm'>
            <span>暂无归档的绩效记录</span>
            <span>周期归档后，历史绩效将在此沉淀</span>
          </CardContent>
        </Card>
      ) : (
        <div className='grid gap-6 lg:grid-cols-2'>
          {/* 历史周期表格 */}
          <Card>
            <CardHeader>
              <CardTitle>历史周期</CardTitle>
              <CardDescription>已归档的历史绩效记录（共 {data?.total ?? items.length} 条）</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable table={table} emptyText='暂无归档的绩效记录' />
              <DataTablePagination table={table} />
            </CardContent>
          </Card>

          {/* 等级趋势图 */}
          <Card>
            <CardHeader>
              <CardTitle>等级趋势</CardTitle>
              <CardDescription>已归档周期的最终等级变化（S 最高）</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={trendChartConfig} className='h-72 w-full'>
                <LineChart accessibilityLayer data={trendData}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey='cycle' tickLine={false} axisLine={false} />
                  <YAxis
                    domain={[0, 5]}
                    ticks={[1, 2, 3, 4, 5]}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={value => LEVEL_TICK_LABEL[value as number] ?? ''}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent formatter={(_value, _name, item) => `等级 ${item.payload.level}`} />}
                  />
                  <Line type='monotone' dataKey='levelValue' stroke='var(--color-levelValue)' strokeWidth={2} dot />
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

export default PerformanceProfile
