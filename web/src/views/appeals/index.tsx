'use client'

// React Imports
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Next Imports
import { useSearchParams } from 'next/navigation'

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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

// Util Imports
import { ApiError, apiFetch } from '@/lib/api'
import type { ListResponse, PerfInterviewStatus } from '@/lib/perf-api'

import AppealDetailSheet from './appeal-detail-sheet'
import { APPEAL_STATUS_OPTIONS, buildAppealTableColumns } from './appeal-table-columns'
import type { AppealRow } from './appeal-table-columns'

/** 与 interviewLink 列 accessor 一致：含已取消的关联也算「已关联」 */
const isAppealLinkedInterview = (row: AppealRow) =>
  (row.linkedInterviewCount ?? 0) > 0 || Boolean(row.inInterview)

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
  const searchParams = useSearchParams()
  const deepLinkAppealId = searchParams.get('appealId')
  const openedDeepLinkRef = useRef<string | null>(null)

  const [appeals, setAppeals] = useState<AppealRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)

  // 默认「已关联面谈」，与面谈页 Tab 筛选同一交互
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([
    { id: 'interviewLink', value: '已关联面谈' }
  ])
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

  // 面谈详情等深链：/appeals?appealId= 自动打开对应申诉
  useEffect(() => {
    if (!deepLinkAppealId || loading || forbidden) return
    if (openedDeepLinkRef.current === deepLinkAppealId) return

    const row = appeals.find(item => String(item.id) === deepLinkAppealId)

    if (!row) return

    openedDeepLinkRef.current = deepLinkAppealId
    handleOpen(row)
  }, [appeals, deepLinkAppealId, forbidden, handleOpen, loading])

  const columns = useMemo(() => buildAppealTableColumns({ onHandle: handleOpen }), [handleOpen])

  const linkedCount = useMemo(() => appeals.filter(isAppealLinkedInterview).length, [appeals])
  const unlinkedCount = useMemo(() => appeals.filter(row => !isAppealLinkedInterview(row)).length, [appeals])

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

      {loading ? (
        <div className='text-muted-foreground flex items-center gap-2 text-sm'>
          <Loader2Icon className='size-4 animate-spin' />
          正在加载申诉列表…
        </div>
      ) : error ? (
        <div className='text-destructive flex flex-col items-start gap-3 text-sm'>
          {error}
          <Button variant='outline' size='sm' onClick={() => void fetchAppeals()}>
            重试
          </Button>
        </div>
      ) : (
        <Tabs
          value={
            (table.getColumn('interviewLink')?.getFilterValue() as string | undefined) ?? '已关联面谈'
          }
          onValueChange={value => {
            if (value == null) return
            table.getColumn('interviewLink')?.setFilterValue(value)
          }}
        >
          <TabsList aria-label='面谈关联'>
            <TabsTrigger value='已关联面谈'>
              已关联面谈
              <Badge className='bg-primary/10 text-primary ml-1.5'>{linkedCount}</Badge>
            </TabsTrigger>
            <TabsTrigger value='无关联面谈'>
              无关联面谈
              <Badge className='bg-primary/10 text-primary ml-1.5'>{unlinkedCount}</Badge>
            </TabsTrigger>
          </TabsList>

          <div className='mt-4'>
            <Card>
              <CardContent className='pt-6'>
                <DataTableToolbar table={table} searchColumn='employee'>
                  <DataTableColumnFilter
                    column={table.getColumn('status')}
                    label='状态'
                    options={APPEAL_STATUS_OPTIONS}
                  />
                </DataTableToolbar>
                <DataTable table={table} emptyText='暂无申诉记录' />
                <DataTablePagination table={table} />
              </CardContent>
            </Card>
          </div>
        </Tabs>
      )}

      {activeAppeal ? (
        <AppealDetailSheet
          appeal={activeAppeal}
          interviews={detail?.interviews ?? []}
          calibrations={detail?.calibrations ?? []}
          detailLoading={detailLoading}
          detailConclusion={detail?.conclusion}
          conclusion={conclusion}
          onConclusionChange={setConclusion}
          resolving={resolving}
          latestCalibrationId={latestCalibrationId}
          interviewViewHref={interviewViewHref}
          interviewWorkspaceHref={interviewWorkspaceHref}
          onClose={handleClose}
          onResolve={() => void handleResolve()}
        />
      ) : null}
    </div>
  )
}

export default Appeals
