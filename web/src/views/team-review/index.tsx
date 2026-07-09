'use client'

// React Imports
import { useCallback, useEffect, useState } from 'react'

// Third-party Imports
import type { SortingState } from '@tanstack/react-table'
import { getCoreRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import { Loader2Icon } from 'lucide-react'

// Component Imports
import { DataTable } from '@/components/datatable'
import PageHeader from '@/components/shared/PageHeader'
import { StatsCards } from '@/components/shared/StatsCards'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// Util Imports
import { apiFetch } from '@/lib/api'
import type { PerfCycleStatus } from '@/lib/perf-api'

import { memberProgressColumns } from './member-progress-columns'
import type { MemberProgressRow } from './member-progress-columns'

// ===== 后端数据类型（NestJS /dashboard 模块） =====

/** GET /dashboard/team 响应：当前进行中周期 + 名下成员评审进度 */
type TeamDashboardData = {
  cycle: { id: number; name: string; status: PerfCycleStatus } | null
  items: MemberProgressRow[]
  total: number
}

/**
 * 团队看板（Leader 视角）：完成率统计卡片 + 成员评审进度 Data Table（progress 变体）。
 * 数据来自 GET /dashboard/team（当前进行中周期下我名下的团队成员）。
 */
const TeamReview = () => {
  const [data, setData] = useState<TeamDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 排序状态（360° 进度列可排序）
  const [sorting, setSorting] = useState<SortingState>([])

  const fetchDashboard = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const result = await apiFetch<TeamDashboardData>('/dashboard/team')

      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法加载团队看板，请确认后端服务已启动。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchDashboard()
  }, [fetchDashboard])

  const members = data?.items ?? []
  const total = data?.total ?? members.length

  // 完成率统计：自评已提交 / 360° 全部提交 / 上级评估已提交
  const selfDone = members.filter(member => member.selfReviewStatus === 'SUBMITTED').length

  const peerDone = members.filter(
    member => member.reviewProgress.total > 0 && member.reviewProgress.submitted >= member.reviewProgress.total
  ).length

  const managerDone = members.filter(member => member.managerReviewStatus === 'SUBMITTED').length

  const stats = [
    { label: '团队成员', value: `${total} 人` },
    { label: '自评完成', value: `${selfDone} / ${total}` },
    { label: '360° 评估完成', value: `${peerDone} / ${total}` },
    { label: '上级评估完成', value: `${managerDone} / ${total}` }
  ]

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: members,
    columns: memberProgressColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: row => String(row.participantId),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableSortingRemoval: false
  })

  if (loading) {
    return (
      <div className='text-muted-foreground flex items-center justify-center gap-2 py-24'>
        <Loader2Icon className='size-4 animate-spin' />
        正在加载团队看板…
      </div>
    )
  }

  if (error) {
    return (
      <div className='text-destructive flex flex-col items-center gap-3 py-24 text-sm'>
        {error}
        <Button variant='outline' size='sm' onClick={() => void fetchDashboard()}>
          重试
        </Button>
      </div>
    )
  }

  // 没有进行中的周期（或名下没有团队成员）时展示空态
  if (!data?.cycle) {
    return (
      <div className='flex flex-col gap-6'>
        <PageHeader title='团队看板' description='当前周期团队成员的评审进度总览' />
        <Card>
          <CardContent>
            <div className='text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-sm'>
              <span>暂无进行中的周期或你名下没有团队成员</span>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader title='团队看板' description={`当前周期团队成员的评审进度总览（${data.cycle.name}）`} />

      {/* 完成率统计卡片（模板 user-stats-cards 布局） */}
      <StatsCards items={stats} />

      {/* 成员评审进度表格（progress 变体） */}
      <Card>
        <CardHeader>
          <CardTitle>成员评审进度</CardTitle>
          <CardDescription>自评 / 360° 评估 / 上级评估各环节完成情况</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable table={table} emptyText='暂无团队成员' />
        </CardContent>
      </Card>
    </div>
  )
}

export default TeamReview
