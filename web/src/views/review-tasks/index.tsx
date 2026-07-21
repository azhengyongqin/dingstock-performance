'use client'

// React Imports
import { useCallback, useEffect, useState } from 'react'

// Third-party Imports
import type { PaginationState } from '@tanstack/react-table'
import { getCoreRowModel, getPaginationRowModel, useReactTable } from '@tanstack/react-table'
import { Loader2Icon } from 'lucide-react'

// Component Imports
import { DataTable, DataTablePagination } from '@/components/datatable'
import PageHeader from '@/components/shared/PageHeader'
import { RequestErrorState } from '@/components/shared/RequestErrorState'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

// Util Imports
import { apiFetch } from '@/lib/api'
import type { ListResponse, ReviewTaskItem } from '@/lib/perf-api'

import { reviewTaskColumns } from './review-task-columns'
import type { ReviewTask } from './review-task-columns'

/** 单个 Tab 内的任务表格：basic + 分页变体，两个 Tab 共用同一份 columns */
const TaskTable = ({ data, emptyText }: { data: ReviewTask[]; emptyText: string }) => {
  // 分页状态
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns: reviewTaskColumns,
    state: { pagination },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableSorting: false
  })

  return (
    <Card>
      <CardContent>
        <DataTable table={table} emptyText={emptyText} />

        <DataTablePagination table={table} />
      </CardContent>
    </Card>
  )
}

/**
 * 评审任务（评审员/Leader 视角）：待办 / 已完成 Tabs。
 * 数据来自 GET /review-tasks（360° 指派任务 + 上级评估任务统一模型）。
 */
const ReviewTasks = () => {
  const [tasks, setTasks] = useState<ReviewTaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const data = await apiFetch<ListResponse<ReviewTaskItem>>('/review-tasks')

      setTasks(data.items ?? [])
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // 延迟到宏任务，避免在 effect 内同步 setState 触发级联渲染
    const initialLoad = setTimeout(() => void fetchTasks(), 0)

    return () => clearTimeout(initialLoad)
  }, [fetchTasks])

  const pendingTasks = tasks.filter(task => task.status === 'PENDING')
  const doneTasks = tasks.filter(task => task.status === 'SUBMITTED')

  if (loading) {
    return (
      <div className='text-muted-foreground flex items-center justify-center gap-2 py-24'>
        <Loader2Icon className='size-4 animate-spin' />
        正在加载评审任务…
      </div>
    )
  }

  if (error) {
    return (
      <div className='flex flex-col gap-6'>
        <PageHeader title='评审任务' description='分配给我的 360° 评估与上级评估任务' />
        <RequestErrorState error={error} size='page' onRetry={() => void fetchTasks()} />
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader title='评审任务' description='分配给我的 360° 评估与上级评估任务' />

      <Tabs defaultValue='pending'>
        <TabsList>
          <TabsTrigger value='pending'>
            待办
            <Badge className='bg-primary/10 text-primary ml-1.5'>{pendingTasks.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value='done'>
            已完成
            <Badge className='bg-primary/10 text-primary ml-1.5'>{doneTasks.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {/* 待办任务 */}
        <TabsContent value='pending' className='mt-4'>
          <TaskTable data={pendingTasks} emptyText='暂无待办任务' />
        </TabsContent>

        {/* 已完成任务 */}
        <TabsContent value='done' className='mt-4'>
          <TaskTable data={doneTasks} emptyText='暂无已完成任务' />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default ReviewTasks
