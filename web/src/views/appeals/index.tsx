'use client'

// React Imports
import { useCallback, useEffect, useMemo, useState } from 'react'

// Third-party Imports
import type { ColumnFiltersState, PaginationState, SortingState } from '@tanstack/react-table'
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable
} from '@tanstack/react-table'
import { Loader2Icon, ShieldAlertIcon } from 'lucide-react'
import { toast } from 'sonner'

// Component Imports
import { DataTable, DataTableColumnFilter, DataTablePagination, DataTableToolbar } from '@/components/datatable'
import PageHeader from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'

// Util Imports
import { ApiError, apiFetch } from '@/lib/api'
import type { ListResponse } from '@/lib/perf-api'
import { formatDateTime } from '@/lib/perf-api'

import { APPEAL_STATUS_OPTIONS, buildAppealTableColumns } from './appeal-table-columns'
import type { AppealRow } from './appeal-table-columns'

// ===== 后端数据类型（NestJS /appeals 模块） =====

/** GET /appeals/:id 响应：列表字段 + 面谈记录 + 等级调整记录 */
type AppealDetail = AppealRow & {
  interviews: { id: number; content: string; conclusion?: string | null; createdAt: string }[]
  calibrations: { beforeLevel: string | null; afterLevel: string; reason: string | null; createdAt: string }[]
}

/**
 * 申诉处理（HR 视角）：申诉 Data Table（filters 变体：状态筛选）。
 * 数据来自 GET /appeals；「处理」弹窗内可添加面谈记录并录入处理结论（可选调整等级）。
 */
const Appeals = () => {
  const [appeals, setAppeals] = useState<AppealRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 403：需要 HR 权限
  const [forbidden, setForbidden] = useState(false)

  // 列筛选、排序与分页状态
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })

  // 处理弹窗：目标申诉 + 详情（含面谈/调整记录）
  const [activeAppeal, setActiveAppeal] = useState<AppealRow | null>(null)
  const [detail, setDetail] = useState<AppealDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // 表单：面谈记录内容 / 处理结论 / 可选等级调整
  const [interviewContent, setInterviewContent] = useState('')
  const [conclusion, setConclusion] = useState('')
  const [adjustedLevel, setAdjustedLevel] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [savingInterview, setSavingInterview] = useState(false)
  const [resolving, setResolving] = useState(false)

  const fetchAppeals = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const data = await apiFetch<ListResponse<AppealRow>>('/appeals')

      setAppeals(data.items ?? [])
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setForbidden(true)
      } else {
        setError(err instanceof Error ? err.message : '无法加载申诉列表，请确认后端服务已启动。')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchAppeals()
  }, [fetchAppeals])

  // 拉取申诉详情（面谈记录 + 等级调整记录）
  const fetchDetail = useCallback(async (appealId: number) => {
    setDetailLoading(true)

    try {
      const data = await apiFetch<AppealDetail>(`/appeals/${appealId}`)

      setDetail(data)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '无法加载申诉详情')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  // 打开处理弹窗：重置表单并拉取详情
  const handleOpen = useCallback(
    (row: AppealRow) => {
      setActiveAppeal(row)
      setDetail(null)
      setInterviewContent('')
      setConclusion('')
      setAdjustedLevel('')
      setAdjustReason('')
      void fetchDetail(row.id)
    },
    [fetchDetail]
  )

  const handleClose = () => {
    setActiveAppeal(null)
    setDetail(null)
  }

  // 列定义：行内「处理」按钮回调走工厂注入
  const columns = useMemo(() => buildAppealTableColumns({ onHandle: handleOpen }), [handleOpen])

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: appeals,
    columns,
    state: { columnFilters, sorting, pagination },
    onColumnFiltersChange: setColumnFilters,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getRowId: row => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableSortingRemoval: false
  })

  // 添加面谈记录
  const handleAddInterview = async () => {
    if (!activeAppeal) return

    if (!interviewContent.trim()) {
      toast.error('请填写面谈记录内容')

      return
    }

    setSavingInterview(true)

    try {
      await apiFetch(`/appeals/${activeAppeal.id}/interviews`, {
        method: 'POST',
        body: JSON.stringify({ content: interviewContent.trim() })
      })
      toast.success('面谈记录已添加')
      setInterviewContent('')

      // 刷新详情与列表（状态可能推进为「面谈处理中」）
      await Promise.all([fetchDetail(activeAppeal.id), fetchAppeals()])
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '添加面谈记录失败')
    } finally {
      setSavingInterview(false)
    }
  }

  // 录入处理结论（可选调整等级）
  const handleResolve = async () => {
    if (!activeAppeal) return

    if (!conclusion.trim()) {
      toast.error('请填写处理结论')

      return
    }

    setResolving(true)

    try {
      await apiFetch(`/appeals/${activeAppeal.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          conclusion: conclusion.trim(),
          ...(adjustedLevel.trim()
            ? { adjustedLevel: adjustedLevel.trim(), reason: adjustReason.trim() || undefined }
            : {})
        })
      })
      toast.success('申诉已处理完成')
      handleClose()
      await fetchAppeals()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '处理申诉失败')
    } finally {
      setResolving(false)
    }
  }

  // 403：需要 HR 权限
  if (forbidden) {
    return (
      <div className='flex flex-col gap-6'>
        <PageHeader title='申诉处理' description='员工对绩效结果的申诉记录：安排面谈、记录结论并闭环' />
        <Card>
          <CardContent>
            <div className='text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-sm'>
              <ShieldAlertIcon className='size-6' />
              <span>需要 HR 权限，当前账号无权访问申诉处理</span>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader title='申诉处理' description='员工对绩效结果的申诉记录：安排面谈、记录结论并闭环' />

      <Card>
        <CardContent>
          {/* 工具栏：状态筛选（待处理 / 面谈处理中 / 已处理） */}
          <DataTableToolbar table={table}>
            <DataTableColumnFilter column={table.getColumn('status')} label='状态' options={APPEAL_STATUS_OPTIONS} />
          </DataTableToolbar>

          {loading ? (
            <div className='text-muted-foreground flex items-center justify-center gap-2 py-16'>
              <Loader2Icon className='size-4 animate-spin' />
              正在加载申诉列表…
            </div>
          ) : error ? (
            <div className='text-destructive flex flex-col items-center gap-3 py-16 text-sm'>
              {error}
              <Button variant='outline' size='sm' onClick={() => void fetchAppeals()}>
                重试
              </Button>
            </div>
          ) : (
            <DataTable table={table} emptyText='暂无申诉记录' />
          )}

          <DataTablePagination table={table} />
        </CardContent>
      </Card>

      {/* 处理弹窗：申诉详情（面谈记录 / 等级调整记录）+ 添加面谈记录 + 处理结论 */}
      <Dialog open={!!activeAppeal} onOpenChange={open => !open && handleClose()}>
        <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>{activeAppeal?.status === 'RESOLVED' ? '申诉记录' : '处理申诉'}</DialogTitle>
            <DialogDescription>
              {activeAppeal?.employee?.name ?? '-'} · {activeAppeal?.participant.cycle.name ?? '-'} · 当前等级{' '}
              {activeAppeal?.participant.resultVersions[0]?.finalLevel ?? '-'}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className='text-muted-foreground flex items-center justify-center gap-2 py-10'>
              <Loader2Icon className='size-4 animate-spin' />
              正在加载申诉详情…
            </div>
          ) : (
            <div className='flex flex-col gap-4'>
              {/* 申诉理由 */}
              <div className='flex flex-col gap-1'>
                <span className='text-muted-foreground text-xs'>申诉理由</span>
                <p className='text-sm whitespace-pre-wrap'>{activeAppeal?.reason ?? '-'}</p>
              </div>

              {/* 面谈记录 */}
              <div className='flex flex-col gap-2'>
                <span className='text-muted-foreground text-xs'>面谈记录（{detail?.interviews.length ?? 0} 条）</span>
                {detail?.interviews.length ? (
                  <div className='flex flex-col gap-2'>
                    {detail.interviews.map(interview => (
                      <div key={interview.id} className='bg-muted/50 flex flex-col gap-1 rounded-md border p-3'>
                        <span className='text-muted-foreground text-xs'>{formatDateTime(interview.createdAt)}</span>
                        <p className='text-sm whitespace-pre-wrap'>{interview.content}</p>
                        {interview.conclusion && (
                          <p className='text-muted-foreground text-xs'>结论：{interview.conclusion}</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className='text-muted-foreground text-sm'>暂无面谈记录</span>
                )}
              </div>

              {/* 等级调整记录 */}
              {detail?.calibrations && detail.calibrations.length > 0 && (
                <div className='flex flex-col gap-2'>
                  <span className='text-muted-foreground text-xs'>等级调整记录</span>
                  {detail.calibrations.map((item, index) => (
                    <div key={index} className='bg-muted/50 flex flex-col gap-1 rounded-md border p-3'>
                      <div className='flex items-center gap-2 text-sm'>
                        <Badge variant='outline'>{item.beforeLevel ?? '-'}</Badge>
                        <span className='text-muted-foreground'>→</span>
                        <Badge className='bg-primary/10 text-primary'>{item.afterLevel}</Badge>
                        <span className='text-muted-foreground ml-auto text-xs'>{formatDateTime(item.createdAt)}</span>
                      </div>
                      {item.reason && <p className='text-muted-foreground text-xs'>{item.reason}</p>}
                    </div>
                  ))}
                </div>
              )}

              {activeAppeal?.status === 'RESOLVED' ? (

                // 已处理：只读展示结论
                <div className='flex flex-col gap-1'>
                  <span className='text-muted-foreground text-xs'>处理结论（{formatDateTime(detail?.resolvedAt)}）</span>
                  <p className='text-sm whitespace-pre-wrap'>{detail?.conclusion ?? activeAppeal.conclusion ?? '-'}</p>
                  {detail?.resultAdjusted && (
                    <Badge variant='outline' className='w-fit text-yellow-600 dark:text-yellow-400'>
                      结果已调整
                    </Badge>
                  )}
                </div>
              ) : (
                <>
                  <Separator />

                  {/* a. 添加面谈记录 */}
                  <div className='flex flex-col gap-2'>
                    <Label>添加面谈记录</Label>
                    <Textarea
                      value={interviewContent}
                      onChange={event => setInterviewContent(event.target.value)}
                      placeholder='记录本次面谈沟通的要点'
                    />
                    <Button
                      variant='outline'
                      size='sm'
                      className='self-end'
                      onClick={handleAddInterview}
                      disabled={savingInterview}
                    >
                      {savingInterview && <Loader2Icon className='animate-spin' />}
                      添加面谈记录
                    </Button>
                  </div>

                  <Separator />

                  {/* b. 处理结论（必填），可选同步调整等级 */}
                  <div className='flex flex-col gap-2'>
                    <Label>处理结论（必填）</Label>
                    <Textarea
                      value={conclusion}
                      onChange={event => setConclusion(event.target.value)}
                      placeholder='给出申诉处理结论，将同步至员工'
                    />
                  </div>

                  <div className='grid gap-4 sm:grid-cols-2'>
                    <div className='flex flex-col gap-2'>
                      <Label>调整等级（可选）</Label>
                      <Input
                        value={adjustedLevel}
                        onChange={event => setAdjustedLevel(event.target.value)}
                        placeholder='如 A'
                      />
                    </div>
                    <div className='flex flex-col gap-2'>
                      <Label>调整原因</Label>
                      <Input
                        value={adjustReason}
                        onChange={event => setAdjustReason(event.target.value)}
                        placeholder='填写调整等级时的依据'
                      />
                    </div>
                  </div>

                  <div className='flex justify-end gap-2'>
                    <Button variant='outline' onClick={handleClose}>
                      取消
                    </Button>
                    <Button onClick={handleResolve} disabled={resolving}>
                      {resolving && <Loader2Icon className='animate-spin' />}
                      提交处理结论
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default Appeals
