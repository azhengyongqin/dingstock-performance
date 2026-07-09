'use client'

// React Imports
import { useCallback, useEffect, useState } from 'react'

// Next Imports
import Link from 'next/link'

// Third-party Imports
import type { ColumnFiltersState, PaginationState, SortingState } from '@tanstack/react-table'
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable
} from '@tanstack/react-table'
import { Loader2Icon, PlusIcon } from 'lucide-react'

// Component Imports
import { DataTable, DataTableColumnFilter, DataTablePagination, DataTableToolbar } from '@/components/datatable'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

// Util Imports
import { apiFetch } from '@/lib/api'
import type { ListResponse, PerfCycle } from '@/lib/perf-api'

import { CYCLE_STATUS_OPTIONS, cycleTableColumns } from './cycle-table-columns'
import type { CycleRow } from './cycle-table-columns'

/**
 * 周期列表（HR 视角）：Data Table「filters + 分页」变体。
 * 数据来自 GET /cycles；支持周期名搜索、状态列筛选与客户端分页。
 */
const CycleList = () => {
  const [cycles, setCycles] = useState<CycleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 列筛选（周期名搜索 + 状态下拉共用）、排序与分页状态
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })

  const fetchCycles = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const data = await apiFetch<ListResponse<PerfCycle>>('/cycles')

      setCycles(data.items ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法加载周期列表，请确认后端服务已启动。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // 延迟到宏任务，避免在 effect 内同步 setState 触发级联渲染
    const initialLoad = setTimeout(() => void fetchCycles(), 0)

    return () => clearTimeout(initialLoad)
  }, [fetchCycles])

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: cycles,
    columns: cycleTableColumns,
    state: { columnFilters, sorting, pagination },
    onColumnFiltersChange: setColumnFilters,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableSortingRemoval: false
  })

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='绩效周期'
        description='创建并管理绩效考核周期：考核人员、评估维度、时间窗口与通知规则'
        actions={
          <Button render={<Link href='/cycles/new/edit' />} nativeButton={false}>
            <PlusIcon />
            新建周期
          </Button>
        }
      />

      <Card>
        <CardContent>
          {/* 工具栏：周期名搜索 + 状态筛选 */}
          <DataTableToolbar table={table} searchColumn='name' searchPlaceholder='搜索周期名称'>
            <DataTableColumnFilter column={table.getColumn('status')} label='状态' options={CYCLE_STATUS_OPTIONS} />
          </DataTableToolbar>

          {loading ? (
            <div className='text-muted-foreground flex items-center justify-center gap-2 py-16'>
              <Loader2Icon className='size-4 animate-spin' />
              正在加载周期列表…
            </div>
          ) : error ? (
            <div className='text-destructive flex flex-col items-center gap-3 py-16 text-sm'>
              {error}
              <Button variant='outline' size='sm' onClick={() => void fetchCycles()}>
                重试
              </Button>
            </div>
          ) : (
            <DataTable table={table} emptyText='还没有绩效周期，点击右上角「新建周期」开始' />
          )}

          <DataTablePagination table={table} />
        </CardContent>
      </Card>
    </div>
  )
}

export default CycleList
