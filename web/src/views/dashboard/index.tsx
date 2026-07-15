'use client'

// React Imports
import { useCallback, useEffect, useMemo, useState } from 'react'

// Third-party Imports
import { ShieldAlertIcon } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'

// Component Imports
import PageHeader from '@/components/shared/PageHeader'
import { StatsCards } from '@/components/shared/StatsCards'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'

// Util Imports
import { ApiError, apiFetch } from '@/lib/api'
import type { PerfCycleStatus } from '@/lib/perf-api'
import { CYCLE_STATUS_BADGE, CYCLE_STATUS_LABEL } from '@/lib/perf-api'

// ===== 后端数据类型（GET /dashboard/hr） =====

/** HR 看板统计 */
type DashboardStats = {
  total: number
  selfSubmissionRate: number
  reviewRate: number
  calibrationRate: number
  confirmRate: number
  appealCount: number
  appealRate: number
  levelDistribution: Record<string, number>
  statusDistribution: Record<string, number>
}

/** HR 看板响应 */
type HrDashboard = {
  cycle: { id: number; name: string; status: PerfCycleStatus } | null
  stats: DashboardStats | null
}

// 等级分布展示顺序：S 到 D，后端未返回的等级跳过
const LEVEL_ORDER = ['S', 'A', 'B', 'C', 'D']

// 比率归一化：兼容后端返回 0-1 小数或 0-100 百分数，统一为 0-100
const toPercent = (rate: number): number => {
  const percent = rate <= 1 ? rate * 100 : rate

  return Math.round(percent * 10) / 10
}

const formatRate = (rate: number): string => `${toPercent(rate)}%`

const levelChartConfig = {
  count: { label: '人数', color: 'var(--primary)' }
} satisfies ChartConfig

const completionChartConfig = {
  rate: { label: '完成率', color: 'var(--primary)' }
} satisfies ChartConfig

/**
 * HR 绩效看板（真实后端 /dashboard/hr）：
 * 统计卡片行 + 等级分布图 + 各环节完成率图（Recharts）。
 * 非 HR（403）显示权限提示态；无进行中周期显示空态。
 */
const PerformanceDashboard = () => {
  // 看板数据
  const [data, setData] = useState<HrDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 403：当前登录人不是 HR
  const [forbidden, setForbidden] = useState(false)

  // 拉取 HR 看板
  const fetchDashboard = useCallback(async () => {
    setLoading(true)
    setError(null)
    setForbidden(false)

    try {
      const result = await apiFetch<HrDashboard>('/dashboard/hr')

      setData(result)
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setForbidden(true)
      } else {
        setError(err instanceof Error ? err.message : '无法加载看板数据，请确认后端服务已启动。')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // 首次加载（放入宏任务，避免在 effect 中同步 setState）
  useEffect(() => {
    const initialLoad = setTimeout(() => void fetchDashboard(), 0)

    return () => clearTimeout(initialLoad)
  }, [fetchDashboard])

  const cycle = data?.cycle ?? null
  const stats = data?.stats ?? null

  // 顶部统计卡：参评人数 + 三个关键比率
  const statCards = useMemo(() => {
    if (!stats) return []

    return [
      { label: '参评总人数', value: String(stats.total), sub: cycle?.name ?? '' },
      { label: '自评提交率', value: formatRate(stats.selfSubmissionRate), sub: '员工自评环节' },
      { label: '评审完成率', value: formatRate(stats.reviewRate), sub: '360° + 上级评估' },
      {
        label: '确认率',
        value: formatRate(stats.confirmRate),
        sub: `申诉 ${stats.appealCount} 起（${formatRate(stats.appealRate)}）`
      }
    ]
  }, [stats, cycle])

  // 等级分布：按 S,A,B,C,D 顺序排，后端未返回的等级跳过
  const levelData = useMemo(() => {
    if (!stats) return []

    return LEVEL_ORDER.filter(level => stats.levelDistribution[level] != null).map(level => ({
      level,
      count: stats.levelDistribution[level]
    }))
  }, [stats])

  // 各环节完成率：自评 / 评审 / 校准 / 确认
  const completionData = useMemo(() => {
    if (!stats) return []

    return [
      { stage: '自评提交', rate: toPercent(stats.selfSubmissionRate) },
      { stage: '评审完成', rate: toPercent(stats.reviewRate) },
      { stage: '校准完成', rate: toPercent(stats.calibrationRate) },
      { stage: '结果确认', rate: toPercent(stats.confirmRate) }
    ]
  }, [stats])

  // ===== 提示态：加载 / 403 / 错误 / 无进行中周期 =====

  if (loading) {
    return (
      <div className='flex flex-col gap-6'>
        <PageHeader title='绩效看板' description='正在加载看板数据…' />
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className='h-24 w-full' />
          ))}
        </div>
        <div className='grid gap-6 lg:grid-cols-2'>
          <Skeleton className='h-80 w-full' />
          <Skeleton className='h-80 w-full' />
        </div>
      </div>
    )
  }

  if (forbidden) {
    return (
      <div className='flex flex-col gap-6'>
        <PageHeader title='绩效看板' description='当前周期的整体数据概览' />
        <Card>
          <CardContent className='text-muted-foreground flex flex-col items-center gap-2 py-16 text-sm'>
            <ShieldAlertIcon className='size-8' />
            <span className='text-foreground font-medium'>需要 HR 权限</span>
            <span>绩效看板仅对 HR 角色开放，请联系管理员开通权限</span>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className='flex flex-col gap-6'>
        <PageHeader title='绩效看板' description='当前周期的整体数据概览' />
        <Card>
          <CardContent className='text-muted-foreground flex flex-col items-center gap-3 py-16 text-sm'>
            <span>{error}</span>
            <Button variant='outline' size='sm' onClick={() => void fetchDashboard()}>
              重试
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!cycle || !stats) {
    return (
      <div className='flex flex-col gap-6'>
        <PageHeader title='绩效看板' description='当前周期的整体数据概览' />
        <Card>
          <CardContent className='text-muted-foreground flex flex-col items-center gap-2 py-16 text-sm'>
            <span>暂无进行中的周期</span>
            <span>周期启动后，看板将展示各环节的实时数据</span>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='绩效看板'
        description={`${cycle.name} 的整体数据概览`}
        actions={
          <Badge className={CYCLE_STATUS_BADGE[cycle.status]}>{CYCLE_STATUS_LABEL[cycle.status] ?? cycle.status}</Badge>
        }
      />

      {/* 统计卡片行（模板 user-stats-cards 布局） */}
      <StatsCards items={statCards.map(stat => ({ label: stat.label, value: stat.value, description: stat.sub }))} />

      <div className='grid gap-6 lg:grid-cols-2'>
        {/* 等级分布 */}
        <Card>
          <CardHeader>
            <CardTitle>等级分布</CardTitle>
            <CardDescription>全员绩效等级人数分布（按 S → D 排序）</CardDescription>
          </CardHeader>
          <CardContent>
            {levelData.length === 0 ? (
              <p className='text-muted-foreground py-16 text-center text-sm'>暂无等级分布数据（校准完成后生成）</p>
            ) : (
              <ChartContainer config={levelChartConfig} className='h-72 w-full'>
                <BarChart accessibilityLayer data={levelData}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey='level' tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                  <Bar dataKey='count' fill='var(--color-count)' radius={6} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        {/* 各环节完成率 */}
        <Card>
          <CardHeader>
            <CardTitle>各环节完成率</CardTitle>
            <CardDescription>自评 / 评审 / 校准 / 确认四个环节的完成率（%）</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={completionChartConfig} className='h-72 w-full'>
              <BarChart accessibilityLayer data={completionData}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey='stage' tickLine={false} axisLine={false} />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <Bar dataKey='rate' fill='var(--color-rate)' radius={6} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default PerformanceDashboard
