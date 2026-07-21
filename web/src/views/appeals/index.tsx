'use client'

// React Imports
import { useCallback, useEffect, useMemo, useState } from 'react'

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
import { ExternalLinkIcon, Loader2Icon, ShieldAlertIcon } from 'lucide-react'
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
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'

// Util Imports
import { ApiError, apiFetch } from '@/lib/api'
import type { ListResponse, PerfInterviewStatus } from '@/lib/perf-api'
import {
  INTERVIEW_STATUS_LABEL,
  appealDisplayLabel,
  feishuCalendarEventUrl,
  formatDateTime
} from '@/lib/perf-api'

import { APPEAL_STATUS_OPTIONS, buildAppealTableColumns } from './appeal-table-columns'
import type { AppealRow } from './appeal-table-columns'

type LinkedInterview = {
  id: number
  status: PerfInterviewStatus
  scheduledStartAt?: string | null
  scheduledEndAt?: string | null
  calendarId?: string | null
  calendarEventId?: string | null
  createdAt: string
  resultNotes?: string | null
}

/** GET /appeals/:id：列表字段 + 关联面谈预约事实 + 校准历史（含 revision id） */
type AppealDetail = AppealRow & {
  interviews: LinkedInterview[]
  calibrations: Array<{
    id: number
    beforeLevel: string | null
    afterLevel: string
    reason: string | null
    createdAt: string
  }>
}

/**
 * 申诉处理（HR 视角）：队列指派与结案；面谈表单深链到 /interviews。
 * 结案契约：expectedCalibrationRevision；改判须先在校准工作台追加决定。
 */
const Appeals = () => {
  const [appeals, setAppeals] = useState<AppealRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)

  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })

  const [activeAppeal, setActiveAppeal] = useState<AppealRow | null>(null)
  const [detail, setDetail] = useState<AppealDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [conclusion, setConclusion] = useState('')
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

  const handleOpen = useCallback(
    (row: AppealRow) => {
      setActiveAppeal(row)
      setDetail(null)
      setConclusion('')
      void fetchDetail(row.id)
    },
    [fetchDetail]
  )

  const handleClose = () => {
    setActiveAppeal(null)
    setDetail(null)
  }

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

  const latestCalibrationId = useMemo(() => {
    const items = detail?.calibrations ?? []

    if (items.length === 0) return null

    return items[items.length - 1]!.id
  }, [detail?.calibrations])

  const interviewWorkspaceHref = activeAppeal
    ? `/interviews?appealId=${activeAppeal.id}&participantId=${activeAppeal.participant.id}&intent=schedule`
    : '/interviews'

  const interviewViewHref = activeAppeal
    ? `/interviews?appealId=${activeAppeal.id}&participantId=${activeAppeal.participant.id}`
    : '/interviews'

  const handleResolve = async () => {
    if (!activeAppeal) return

    if (!conclusion.trim()) {
      toast.error('请填写处理结论')

      return
    }

    if (latestCalibrationId == null) {
      toast.error('缺少校准决定，请先在校准工作台完成校准后再结案')

      return
    }

    setResolving(true)

    try {
      await apiFetch(`/appeals/${activeAppeal.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          conclusion: conclusion.trim(),
          expectedCalibrationRevision: latestCalibrationId
        })
      })
      toast.success('申诉已处理完成')
      handleClose()
      await fetchAppeals()
    } catch (err) {
      if (err instanceof ApiError) {
        // Nest ConflictException 对象体可能在根上，也可能嵌在 message 内
        const body = err.body as
          | { code?: string; message?: string | { code?: string } }
          | undefined

        const nested =
          body?.message && typeof body.message === 'object' ? body.message.code : undefined

        const code = body?.code ?? nested

        if (code === 'APPEAL_ADJUSTMENT_REQUIRES_NEW_CALIBRATION') {
          toast.error('改判须先在校准工作台追加校准决定，再回到此页结案')
        } else if (code === 'CALIBRATION_REVISION_STALE') {
          toast.error('校准决定已变化，请刷新后重试')
          await fetchDetail(activeAppeal.id)
        } else {
          toast.error(err.message)
        }
      } else {
        toast.error('处理申诉失败')
      }
    } finally {
      setResolving(false)
    }
  }

  if (forbidden) {
    return (
      <div className='flex flex-col gap-6'>
        <PageHeader title='申诉处理' description='员工对绩效结果的申诉记录：指派处理人、关联面谈并结案' />
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
      <PageHeader title='申诉处理' description='员工对绩效结果的申诉记录：指派处理人、关联面谈并结案' />

      <Card>
        <CardContent>
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

      <Dialog open={!!activeAppeal} onOpenChange={open => !open && handleClose()}>
        <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>{activeAppeal?.status === 'RESOLVED' ? '申诉记录' : '处理申诉'}</DialogTitle>
            <DialogDescription>
              {activeAppeal?.employee?.name ?? '-'} · {activeAppeal?.participant.cycle.name ?? '-'} · 当前等级{' '}
              {activeAppeal?.participant.resultVersions[0]?.finalLevel ?? '-'}
              {activeAppeal ? ` · ${appealDisplayLabel(activeAppeal)}` : ''}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className='text-muted-foreground flex items-center justify-center gap-2 py-10'>
              <Loader2Icon className='size-4 animate-spin' />
              正在加载申诉详情…
            </div>
          ) : (
            <div className='flex flex-col gap-4'>
              <div className='flex flex-col gap-1'>
                <span className='text-muted-foreground text-xs'>申诉理由</span>
                <p className='text-sm whitespace-pre-wrap'>{activeAppeal?.reason ?? '-'}</p>
              </div>

              <div className='flex flex-col gap-2'>
                <div className='flex items-center justify-between gap-2'>
                  <span className='text-muted-foreground text-xs'>
                    关联面谈（{detail?.interviews.length ?? 0} 条）
                  </span>
                  <div className='flex flex-wrap gap-2'>
                    <Button
                      variant='outline'
                      size='sm'
                      render={<Link href={interviewViewHref} />}
                      nativeButton={false}
                    >
                      <ExternalLinkIcon className='size-3.5' />
                      查看关联面谈
                    </Button>
                    {activeAppeal?.status !== 'RESOLVED' && (
                      <Button
                        variant='outline'
                        size='sm'
                        render={<Link href={interviewWorkspaceHref} />}
                        nativeButton={false}
                      >
                        <ExternalLinkIcon className='size-3.5' />
                        预约关联面谈
                      </Button>
                    )}
                  </div>
                </div>
                {detail?.interviews.length ? (
                  <div className='flex flex-col gap-2'>
                    {detail.interviews.map(interview => {
                      const calendarHref =
                        interview.calendarId && interview.calendarEventId
                          ? feishuCalendarEventUrl(interview.calendarId, interview.calendarEventId)
                          : null

                      return (
                        <div key={interview.id} className='bg-muted/50 flex flex-col gap-1 rounded-md border p-3'>
                          <div className='flex items-center gap-2'>
                            <Badge variant='outline'>
                              {INTERVIEW_STATUS_LABEL[interview.status] ?? interview.status}
                            </Badge>
                            <span className='text-muted-foreground text-xs'>
                              {interview.scheduledStartAt
                                ? formatDateTime(interview.scheduledStartAt)
                                : formatDateTime(interview.createdAt)}
                            </span>
                          </div>
                          {calendarHref ? (
                            <a
                              href={calendarHref}
                              target='_blank'
                              rel='noreferrer'
                              className='text-primary text-xs underline-offset-2 hover:underline'
                            >
                              打开飞书日程
                            </a>
                          ) : null}
                          {interview.resultNotes ? (
                            <p className='text-muted-foreground text-xs line-clamp-2'>
                              纪要摘要：{interview.resultNotes}
                            </p>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <span className='text-muted-foreground text-sm'>暂无关联面谈；可前往面谈工作台预约并关联本申诉</span>
                )}
              </div>

              {detail?.calibrations && detail.calibrations.length > 0 && (
                <div className='flex flex-col gap-2'>
                  <span className='text-muted-foreground text-xs'>校准决定（结案将锁定最新一条）</span>
                  {detail.calibrations.map(item => (
                    <div key={item.id} className='bg-muted/50 flex flex-col gap-1 rounded-md border p-3'>
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

                  <div className='bg-muted/40 rounded-md border p-3 text-xs leading-relaxed'>
                    结案将提交最新校准决定（revision{' '}
                    {latestCalibrationId ?? '无'}
                    ）。若需改判，请先到
                    <Link
                      href='/calibrations'
                      className='text-primary mx-1 underline-offset-2 hover:underline'
                    >
                      校准工作台
                    </Link>
                    追加校准决定，再回到此页结案；不可在此直接填写目标等级。
                  </div>

                  <div className='flex flex-col gap-2'>
                    <Label>处理结论（必填）</Label>
                    <Textarea
                      value={conclusion}
                      onChange={event => setConclusion(event.target.value)}
                      placeholder='给出申诉处理结论，将同步至员工'
                    />
                  </div>

                  <div className='flex justify-end gap-2'>
                    <Button variant='outline' onClick={handleClose}>
                      取消
                    </Button>
                    <Button onClick={() => void handleResolve()} disabled={resolving || latestCalibrationId == null}>
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
