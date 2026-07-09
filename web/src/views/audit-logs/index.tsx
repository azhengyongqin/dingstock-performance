'use client'

// React Imports
import { useCallback, useEffect, useState } from 'react'

// Third-party Imports
import type { PaginationState } from '@tanstack/react-table'
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { Loader2Icon, ShieldAlertIcon } from 'lucide-react'

// Component Imports
import { DataTable, DataTableExportButton, DataTablePagination, DataTableToolbar } from '@/components/datatable'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

// Util Imports
import { ApiError, apiFetch } from '@/lib/api'
import type { ListResponse } from '@/lib/perf-api'
import { formatDateTime } from '@/lib/perf-api'

import { auditLogColumns, formatTarget } from './audit-log-columns'
import type { AuditLogRow } from './audit-log-columns'

/**
 * 操作日志（HR 视角）：Data Table「每页条数选择 + CSV 导出」变体。
 * 日志量大，采用后端分页（manualPagination）：翻页 / 调整每页条数时重新请求 GET /audit-logs。
 */
const AuditLogs = () => {
  const [logs, setLogs] = useState<AuditLogRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 403：需要 HR 权限
  const [forbidden, setForbidden] = useState(false)

  // 分页状态（后端分页：page = pageIndex + 1）
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 })

  const fetchLogs = useCallback(async (page: number, pageSize: number) => {
    setLoading(true)
    setError(null)

    try {
      const data = await apiFetch<ListResponse<AuditLogRow>>(`/audit-logs?page=${page}&page_size=${pageSize}`)

      setLogs(data.items ?? [])
      setTotal(data.total ?? 0)
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setForbidden(true)
      } else {
        setError(err instanceof Error ? err.message : '无法加载操作日志，请确认后端服务已启动。')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // 分页状态变化时重新请求
  useEffect(() => {
    void fetchLogs(pagination.pageIndex + 1, pagination.pageSize)
  }, [fetchLogs, pagination])

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: logs,
    columns: auditLogColumns,
    state: { pagination },
    onPaginationChange: setPagination,
    getRowId: row => String(row.id),

    // 后端分页：总条数来自接口，客户端不做切片
    manualPagination: true,
    rowCount: total,
    getCoreRowModel: getCoreRowModel(),
    enableSorting: false
  })

  // 403：需要 HR 权限
  if (forbidden) {
    return (
      <div className='flex flex-col gap-6'>
        <PageHeader title='操作日志' description='系统关键操作的审计记录（配置变更、评估提交、结果推送等）' />
        <Card>
          <CardContent>
            <div className='text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-sm'>
              <ShieldAlertIcon className='size-6' />
              <span>需要 HR 权限，当前账号无权查看操作日志</span>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader title='操作日志' description='系统关键操作的审计记录（配置变更、评估提交、结果推送等）' />

      <Card>
        <CardContent>
          {/* 工具栏：CSV 导出（后端分页场景导出当前页日志） */}
          <DataTableToolbar table={table}>
            <DataTableExportButton
              table={table}
              filename='操作日志'
              getExportRow={log => ({
                时间: formatDateTime(log.createdAt),
                操作人: log.operator?.name ?? log.operatorOpenId ?? '-',
                操作类型: log.action,
                对象: formatTarget(log),
                原因: log.reason ?? '-'
              })}
            />
          </DataTableToolbar>

          {loading ? (
            <div className='text-muted-foreground flex items-center justify-center gap-2 py-16'>
              <Loader2Icon className='size-4 animate-spin' />
              正在加载操作日志…
            </div>
          ) : error ? (
            <div className='text-destructive flex flex-col items-center gap-3 py-16 text-sm'>
              {error}
              <Button
                variant='outline'
                size='sm'
                onClick={() => void fetchLogs(pagination.pageIndex + 1, pagination.pageSize)}
              >
                重试
              </Button>
            </div>
          ) : (
            <DataTable table={table} emptyText='暂无操作日志' />
          )}

          {/* 分页：含每页条数选择器（后端分页） */}
          <DataTablePagination table={table} pageSizeOptions={[10, 20, 50, 100]} />
        </CardContent>
      </Card>
    </div>
  )
}

export default AuditLogs
