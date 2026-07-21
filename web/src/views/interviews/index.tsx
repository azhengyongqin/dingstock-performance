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
import { Loader2Icon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'

// Component Imports
import { DataTable, DataTableColumnFilter, DataTablePagination, DataTableToolbar } from '@/components/datatable'
import { DateTimePicker } from '@/components/shared/DatePicker'
import PageHeader from '@/components/shared/PageHeader'
import { LarkMemberSelector } from '@/components/shared/lark'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

// Util Imports
import { ApiError, apiFetch } from '@/lib/api'
import type { ListResponse, PerfParticipantStatus } from '@/lib/perf-api'
import { INTERVIEW_STATUS_LABEL, formatDateTime } from '@/lib/perf-api'

import {
  INTERVIEW_STATUS_OPTIONS,
  buildInterviewTableColumns,
  type InterviewRow
} from './interview-table-columns'

const SCHEDULABLE: PerfParticipantStatus[] = [
  'RESULT_PUBLISHED',
  'APPEALING',
  'RE_CONFIRMING',
  'CONFIRMED'
]

type Candidate = {
  participantId: number
  name: string
  status: PerfParticipantStatus
}

type TeamDashboardData = {
  items: Array<{
    participantId: number
    status: PerfParticipantStatus
    employee: { name?: string } | null
  }>
}

/**
 * 绩效面谈工作台：预约（飞书日程）、改期/取消、填写/修改结果纪要。
 */
const Interviews = () => {
  const [rows, setRows] = useState<InterviewRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })

  const [active, setActive] = useState<InterviewRow | null>(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [participantId, setParticipantId] = useState<string>('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [extraOpenIds, setExtraOpenIds] = useState<string[]>([])
  const [rescheduleStart, setRescheduleStart] = useState('')
  const [rescheduleEnd, setRescheduleEnd] = useState('')

  const fetchList = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const data = await apiFetch<ListResponse<InterviewRow>>('/interviews')

      setRows(data.items ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法加载面谈列表')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  const loadCandidates = useCallback(async () => {
    const map = new Map<number, Candidate>()

    try {
      const team = await apiFetch<TeamDashboardData>('/dashboard/team')

      for (const item of team.items ?? []) {
        if (!SCHEDULABLE.includes(item.status)) continue
        map.set(item.participantId, {
          participantId: item.participantId,
          name: item.employee?.name ?? `参与者 #${item.participantId}`,
          status: item.status
        })
      }
    } catch {
      // Leader 看板不可用时继续尝试周期参与者列表（HR/Admin）
    }

    try {
      const cycles = await apiFetch<ListResponse<{ id: number; status: string }>>('/cycles')
      const active = (cycles.items ?? []).find(cycle => cycle.status === 'ACTIVE')

      if (active) {
        const participants = await apiFetch<
          ListResponse<{
            id: number
            status: PerfParticipantStatus
            employee: { name?: string } | null
          }>
        >(`/cycles/${active.id}/participants`)

        for (const item of participants.items ?? []) {
          if (!SCHEDULABLE.includes(item.status)) continue
          map.set(item.id, {
            participantId: item.id,
            name: item.employee?.name ?? `参与者 #${item.id}`,
            status: item.status
          })
        }
      }
    } catch {
      // 忽略：至少保留团队看板结果
    }

    setCandidates([...map.values()])
  }, [])

  const openSchedule = () => {
    setParticipantId('')
    setStartAt('')
    setEndAt('')
    setExtraOpenIds([])
    setScheduleOpen(true)
    void loadCandidates()
  }

  const handleOpen = useCallback((row: InterviewRow) => {
    setActive(row)
    setNotes(row.resultNotes ?? '')
    setRescheduleStart(row.scheduledStartAt ? row.scheduledStartAt.slice(0, 16) : '')
    setRescheduleEnd(row.scheduledEndAt ? row.scheduledEndAt.slice(0, 16) : '')
  }, [])

  const columns = useMemo(() => buildInterviewTableColumns({ onOpen: handleOpen }), [handleOpen])

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    state: { columnFilters, sorting, pagination },
    onColumnFiltersChange: setColumnFilters,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getRowId: row => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel()
  })

  const handleSchedule = async () => {
    if (!participantId || !startAt || !endAt) {
      toast.error('请选择员工并填写起止时间')

      return
    }

    setSaving(true)

    try {
      await apiFetch('/interviews', {
        method: 'POST',
        body: JSON.stringify({
          participantId: Number(participantId),
          scheduledStartAt: new Date(startAt).toISOString(),
          scheduledEndAt: new Date(endAt).toISOString(),
          extraAttendeeOpenIds: extraOpenIds
        })
      })
      toast.success('已预约面谈并创建飞书日程')
      setScheduleOpen(false)
      await fetchList()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '预约失败')
    } finally {
      setSaving(false)
    }
  }

  const handleReschedule = async () => {
    if (!active || !rescheduleStart || !rescheduleEnd) return
    setSaving(true)

    try {
      await apiFetch(`/interviews/${active.id}/schedule`, {
        method: 'PATCH',
        body: JSON.stringify({
          scheduledStartAt: new Date(rescheduleStart).toISOString(),
          scheduledEndAt: new Date(rescheduleEnd).toISOString()
        })
      })
      toast.success('已改期并同步飞书日程')
      setActive(null)
      await fetchList()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '改期失败')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = async () => {
    if (!active) return
    setSaving(true)

    try {
      await apiFetch(`/interviews/${active.id}/cancel`, { method: 'POST' })
      toast.success('已取消面谈与飞书日程')
      setActive(null)
      await fetchList()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '取消失败')
    } finally {
      setSaving(false)
    }
  }

  const handleCompleteOrUpdate = async () => {
    if (!active) return

    if (!notes.trim()) {
      toast.error('请填写结果纪要')

      return
    }

    setSaving(true)

    try {
      if (active.status === 'SCHEDULED') {
        await apiFetch(`/interviews/${active.id}/complete`, {
          method: 'POST',
          body: JSON.stringify({ resultNotes: notes.trim() })
        })
        toast.success('面谈已完成')
      } else {
        await apiFetch(`/interviews/${active.id}/notes`, {
          method: 'PATCH',
          body: JSON.stringify({ resultNotes: notes.trim() })
        })
        toast.success('纪要已更新')
      }

      setActive(null)
      await fetchList()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='绩效面谈'
        description='预约飞书日程、记录面谈结果纪要。纪要对员工不可见。'
        actions={
          <Button onClick={openSchedule}>
            <PlusIcon className='size-4' />
            预约面谈
          </Button>
        }
      />

      <Card>
        <CardContent className='pt-6'>
          {loading ? (
            <div className='text-muted-foreground flex items-center gap-2 text-sm'>
              <Loader2Icon className='size-4 animate-spin' />
              加载中…
            </div>
          ) : error ? (
            <p className='text-destructive text-sm'>{error}</p>
          ) : (
            <>
              <DataTableToolbar table={table} searchColumn='employee' searchPlaceholder='搜索员工…'>
                <DataTableColumnFilter column={table.getColumn('status')} label='状态' options={INTERVIEW_STATUS_OPTIONS} />
              </DataTableToolbar>
              <DataTable table={table} emptyText='暂无面谈记录' />
              <DataTablePagination table={table} />
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className='max-w-lg'>
          <DialogHeader>
            <DialogTitle>预约面谈</DialogTitle>
            <DialogDescription>将以你的身份创建飞书日程，并邀请员工与可选参与人。</DialogDescription>
          </DialogHeader>
          <div className='grid gap-4 py-2'>
            <div className='grid gap-2'>
              <Label>员工（结果已推送及之后）</Label>
              <Select
                value={participantId || undefined}
                onValueChange={value => setParticipantId(value ?? '')}
              >
                <SelectTrigger>
                  <SelectValue placeholder={candidates.length ? '选择员工' : '暂无可预约成员'} />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map(c => (
                    <SelectItem key={c.participantId} value={String(c.participantId)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='interview-start'>开始时间</Label>
              <DateTimePicker id='interview-start' value={startAt} onChange={setStartAt} />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='interview-end'>结束时间</Label>
              <DateTimePicker id='interview-end' value={endAt} onChange={setEndAt} />
            </div>
            <div className='grid gap-2'>
              <Label>追加参与人（可选）</Label>
              <LarkMemberSelector
                fluid
                placeholder='搜索并添加参与人'
                onSelect={option => {
                  const openId = option.entity?.id ?? option.id

                  if (!openId) return
                  setExtraOpenIds(prev => (prev.includes(openId) ? prev : [...prev, openId]))
                }}
              />
              {extraOpenIds.length > 0 ? (
                <p className='text-muted-foreground text-xs'>已追加 {extraOpenIds.length} 人</p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setScheduleOpen(false)}>
              取消
            </Button>
            <Button disabled={saving} onClick={() => void handleSchedule()}>
              {saving ? <Loader2Icon className='size-4 animate-spin' /> : null}
              确认预约
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!active} onOpenChange={open => !open && setActive(null)}>
        <DialogContent className='max-w-lg'>
          <DialogHeader>
            <DialogTitle>面谈详情</DialogTitle>
            <DialogDescription>
              {active?.employee?.name ?? '员工'} · {active ? INTERVIEW_STATUS_LABEL[active.status] : ''}
            </DialogDescription>
          </DialogHeader>
          {active ? (
            <div className='grid gap-4 py-2'>
              <div className='flex items-center gap-2'>
                <Badge variant='secondary'>{INTERVIEW_STATUS_LABEL[active.status]}</Badge>
                {active.calendarEventId ? (
                  <span className='text-muted-foreground text-xs'>
                    飞书日程 {active.calendarId}/{active.calendarEventId}
                  </span>
                ) : null}
              </div>
              <p className='text-sm'>
                预约时间：
                {active.scheduledStartAt ? formatDateTime(active.scheduledStartAt) : '-'}
                {' ~ '}
                {active.scheduledEndAt ? formatDateTime(active.scheduledEndAt) : '-'}
              </p>

              {active.status === 'SCHEDULED' ? (
                <>
                  <div className='grid gap-2'>
                    <Label htmlFor='reschedule-start'>改期开始</Label>
                    <DateTimePicker id='reschedule-start' value={rescheduleStart} onChange={setRescheduleStart} />
                  </div>
                  <div className='grid gap-2'>
                    <Label htmlFor='reschedule-end'>改期结束</Label>
                    <DateTimePicker id='reschedule-end' value={rescheduleEnd} onChange={setRescheduleEnd} />
                  </div>
                  <div className='flex flex-wrap gap-2'>
                    <Button variant='outline' disabled={saving} onClick={() => void handleReschedule()}>
                      改期
                    </Button>
                    <Button variant='destructive' disabled={saving} onClick={() => void handleCancel()}>
                      取消面谈
                    </Button>
                  </div>
                  <div className='grid gap-2'>
                    <Label htmlFor='complete-notes'>结果纪要（完成后必填）</Label>
                    <Textarea
                      id='complete-notes'
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      rows={4}
                      placeholder='面谈沟通要点与结论…'
                    />
                  </div>
                  <Button disabled={saving} onClick={() => void handleCompleteOrUpdate()}>
                    完成并保存纪要
                  </Button>
                </>
              ) : null}

              {active.status === 'COMPLETED' ? (
                <>
                  <div className='grid gap-2'>
                    <Label htmlFor='update-notes'>结果纪要</Label>
                    <Textarea id='update-notes' value={notes} onChange={e => setNotes(e.target.value)} rows={4} />
                  </div>
                  <Button disabled={saving} onClick={() => void handleCompleteOrUpdate()}>
                    更新纪要
                  </Button>
                </>
              ) : null}

              {active.status === 'CANCELLED' ? (
                <p className='text-muted-foreground text-sm'>该面谈已取消，可重新预约一条新的面谈。</p>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default Interviews
