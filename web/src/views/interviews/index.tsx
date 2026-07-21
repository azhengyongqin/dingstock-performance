'use client'

// React Imports
import { useCallback, useEffect, useMemo, useState } from 'react'

// Next Imports
import Link from 'next/link'
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
import { Loader2Icon, PlusIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

// Component Imports
import { DataTable, DataTableColumnFilter, DataTablePagination, DataTableToolbar } from '@/components/datatable'
import {
  DateTimeRangePicker,
  createDefaultDateTimeRange,
  type DateTimeRangeValue
} from '@/components/shared/DatePicker'
import EmployeeSelect from '@/components/shared/EmployeeSelect'
import PageHeader from '@/components/shared/PageHeader'
import {
  LarkMemberPickerDialog,
  UserAvatar,
  type LarkPickerMember
} from '@/components/shared/lark'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

// Util Imports
import { ApiError, apiFetch } from '@/lib/api'
import type { LarkUserBrief, ListResponse, PerfParticipantStatus } from '@/lib/perf-api'
import { avatarUrlOf } from '@/lib/perf-api'

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
  openId?: string
  avatarUrl?: string
  jobTitle?: string | null
}

type TeamDashboardData = {
  items: Array<{
    participantId: number
    status: PerfParticipantStatus
    employee: LarkUserBrief | null
  }>
}

/** 可移除的追加参与人胶囊（交互对齐 360 环评 MemberPill） */
const AttendeePill = ({
  member,
  onRemove
}: {
  member: LarkPickerMember
  onRemove: (openId: string) => void
}) => (
  <div className='bg-muted/60 flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-0.5'>
    <UserAvatar openId={member.openId} name={member.name} avatarUrl={member.avatarUrl} size='sm' />
    <span className='text-sm'>{member.name ?? member.openId}</span>
    <button
      type='button'
      aria-label={`移除 ${member.name ?? member.openId}`}
      className='text-muted-foreground hover:text-destructive'
      onClick={() => onRemove(member.openId)}
    >
      <XIcon className='size-3.5' />
    </button>
  </div>
)

/**
 * 绩效面谈工作台：列表内取消/重约/飞书日程；预约弹窗创建新日程。
 */
const Interviews = () => {
  const searchParams = useSearchParams()
  const deepLinkAppealId = searchParams.get('appealId')
  const deepLinkParticipantId = searchParams.get('participantId')

  const [rows, setRows] = useState<InterviewRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 默认落在「普通面谈」；申诉深链时切到「申诉面谈」
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([
    { id: 'appealLink', value: '普通面谈' }
  ])
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })

  const [actionRowId, setActionRowId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [participantId, setParticipantId] = useState<string>('')
  const [appealId, setAppealId] = useState<string>('')

  /** 深链 / 重新预约时锁定员工，避免误换人 */
  const [employeeLocked, setEmployeeLocked] = useState(false)
  const [scheduleRange, setScheduleRange] = useState<DateTimeRangeValue>(() => createDefaultDateTimeRange())
  const [extraAttendees, setExtraAttendees] = useState<LarkPickerMember[]>([])
  const [attendeesPickerOpen, setAttendeesPickerOpen] = useState(false)

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

    const upsert = (
      participantId: number,
      status: PerfParticipantStatus,
      employee: LarkUserBrief | null | undefined
    ) => {
      map.set(participantId, {
        participantId,
        name: employee?.name ?? `参与者 #${participantId}`,
        status,
        openId: employee?.open_id,
        avatarUrl: avatarUrlOf(employee),
        jobTitle: employee?.job_title
      })
    }

    try {
      const team = await apiFetch<TeamDashboardData>('/dashboard/team')

      for (const item of team.items ?? []) {
        if (!SCHEDULABLE.includes(item.status)) continue
        upsert(item.participantId, item.status, item.employee)
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
            employee: LarkUserBrief | null
          }>
        >(`/cycles/${active.id}/participants`)

        for (const item of participants.items ?? []) {
          if (!SCHEDULABLE.includes(item.status)) continue
          upsert(item.id, item.status, item.employee)
        }
      }
    } catch {
      // 忽略：至少保留团队看板结果
    }

    setCandidates([...map.values()])
  }, [])

  // 从申诉队列深链：预填关联；仅 intent=schedule 时打开预约弹窗（查看路径只落列表）
  useEffect(() => {
    if (!deepLinkAppealId && !deepLinkParticipantId) return
    setAppealId(deepLinkAppealId ?? '')
    setParticipantId(deepLinkParticipantId ?? '')
    setEmployeeLocked(Boolean(deepLinkParticipantId))

    if (deepLinkAppealId) {
      setColumnFilters(prev => {
        const rest = prev.filter(item => item.id !== 'appealLink')

        return [...rest, { id: 'appealLink', value: '申诉面谈' }]
      })
    }

    if (searchParams.get('intent') === 'schedule') {
      setScheduleRange(createDefaultDateTimeRange())
      setScheduleOpen(true)
      void loadCandidates()
    }
  }, [deepLinkAppealId, deepLinkParticipantId, loadCandidates, searchParams])

  const tableRows = useMemo(() => {
    if (!deepLinkAppealId) return rows

    return rows.filter(row => String(row.appealId ?? '') === deepLinkAppealId)
  }, [rows, deepLinkAppealId])

  const regularCount = useMemo(() => tableRows.filter(row => !row.appealId).length, [tableRows])
  const appealCount = useMemo(() => tableRows.filter(row => row.appealId != null).length, [tableRows])

  const openSchedule = () => {
    setParticipantId(deepLinkParticipantId ?? '')
    setAppealId(deepLinkAppealId ?? '')
    setEmployeeLocked(Boolean(deepLinkParticipantId))
    setScheduleRange(createDefaultDateTimeRange())
    setExtraAttendees([])
    setScheduleOpen(true)
    void loadCandidates()
  }

  const selectedCandidate = useMemo(
    () => candidates.find(c => String(c.participantId) === participantId) ?? null,
    [candidates, participantId]
  )

  const handleCancel = useCallback(
    async (row: InterviewRow) => {
      setActionRowId(row.id)

      try {
        await apiFetch(`/interviews/${row.id}/cancel`, { method: 'POST' })
        toast.success('已取消面谈与飞书日程')
        await fetchList()
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : '取消失败')
      } finally {
        setActionRowId(null)
      }
    },
    [fetchList]
  )

  /** 取消态「重新预约」：预填并锁定员工后打开预约弹窗 */
  const handleBookAgain = useCallback(
    (row: InterviewRow) => {
      setParticipantId(String(row.participant.id))
      setAppealId(row.appealId != null ? String(row.appealId) : '')
      setEmployeeLocked(true)
      setScheduleRange(createDefaultDateTimeRange())
      setExtraAttendees([])
      setScheduleOpen(true)
      void loadCandidates()
    },
    [loadCandidates]
  )

  const columns = useMemo(
    () =>
      buildInterviewTableColumns({
        actionRowId,
        onCancel: row => void handleCancel(row),
        onBookAgain: handleBookAgain
      }),
    [actionRowId, handleBookAgain, handleCancel]
  )

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: tableRows,
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
    if (!participantId || !scheduleRange.from || !scheduleRange.to) {
      toast.error('请选择员工并填写起止时间')

      return
    }

    if (new Date(scheduleRange.to).getTime() <= new Date(scheduleRange.from).getTime()) {
      toast.error('结束时间必须晚于开始时间')

      return
    }

    setSaving(true)

    try {
      await apiFetch('/interviews', {
        method: 'POST',
        body: JSON.stringify({
          participantId: Number(participantId),
          scheduledStartAt: new Date(scheduleRange.from).toISOString(),
          scheduledEndAt: new Date(scheduleRange.to).toISOString(),
          extraAttendeeOpenIds: extraAttendees.map(member => member.openId),
          ...(appealId.trim() ? { appealId: Number(appealId.trim()) } : {})
        })
      })
      toast.success(
        appealId.trim() ? '已预约面谈并关联申诉（申诉状态不变）' : '已预约面谈并创建飞书日程'
      )
      setScheduleOpen(false)
      await fetchList()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '预约失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='绩效面谈'
        description='预约飞书日程；列表内可取消未开始的预约或重新预约。'
        actions={
          <Button onClick={openSchedule}>
            <PlusIcon className='size-4' />
            预约面谈
          </Button>
        }
      />

      {loading ? (
        <div className='text-muted-foreground flex items-center gap-2 text-sm'>
          <Loader2Icon className='size-4 animate-spin' />
          加载中…
        </div>
      ) : error ? (
        <p className='text-destructive text-sm'>{error}</p>
      ) : (
        <Tabs
          value={(table.getColumn('appealLink')?.getFilterValue() as string | undefined) ?? '普通面谈'}
          onValueChange={value => {
            if (value == null) return
            table.getColumn('appealLink')?.setFilterValue(value)
          }}
        >
          <TabsList aria-label='面谈类型'>
            <TabsTrigger value='普通面谈'>
              普通面谈
              <Badge className='bg-primary/10 text-primary ml-1.5'>{regularCount}</Badge>
            </TabsTrigger>
            <TabsTrigger value='申诉面谈'>
              申诉面谈
              <Badge className='bg-primary/10 text-primary ml-1.5'>{appealCount}</Badge>
            </TabsTrigger>
          </TabsList>

          <div className='mt-4'>
            <Card>
              <CardContent className='pt-6'>
                {deepLinkAppealId ? (
                  <p className='bg-muted/40 mb-4 rounded-md border px-3 py-2 text-xs'>
                    已按申诉 #{deepLinkAppealId} 筛选关联面谈；可点「预约面谈」继续创建关联预约。
                  </p>
                ) : null}
                <DataTableToolbar table={table} searchColumn='employee'>
                  <DataTableColumnFilter
                    column={table.getColumn('status')}
                    label='状态'
                    options={INTERVIEW_STATUS_OPTIONS}
                  />
                </DataTableToolbar>
                <DataTable table={table} emptyText='暂无面谈记录' />
                <DataTablePagination table={table} />
              </CardContent>
            </Card>
          </div>
        </Tabs>
      )}

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className='max-w-lg'>
          <DialogHeader>
            <DialogTitle>预约面谈</DialogTitle>
            <DialogDescription>将以你的身份创建飞书日程，并邀请员工与可选参与人。</DialogDescription>
          </DialogHeader>
          <div className='grid gap-4 py-2'>
            {appealId ? (
              <p className='bg-muted/40 rounded-md border px-3 py-2 text-xs'>
                将关联{' '}
                <Link
                  href={`/appeals?appealId=${appealId}`}
                  className='text-primary font-medium underline-offset-4 hover:underline'
                >
                  申诉 #{appealId}
                </Link>
                （弱关联，不会自动改申诉状态）
              </p>
            ) : null}

            <div className='grid gap-2'>
              <Label>员工</Label>
              <EmployeeSelect
                options={candidates.map(c => ({
                  id: String(c.participantId),
                  name: c.name,
                  openId: c.openId,
                  avatarUrl: c.avatarUrl,
                  jobTitle: c.jobTitle
                }))}
                value={participantId || null}
                onValueChange={next => setParticipantId(next ?? '')}
                locked={employeeLocked}
                placeholder='选择要预约的员工'
                emptyText='暂无可预约成员'
                lockedHint='结果已推送及之后可预约'
                selectedFallback={
                  participantId
                    ? {
                        name: selectedCandidate?.name ?? `参与者 #${participantId}`,
                        openId: selectedCandidate?.openId,
                        avatarUrl: selectedCandidate?.avatarUrl,
                        jobTitle: selectedCandidate?.jobTitle
                      }
                    : undefined
                }
              />
            </div>

            <div className='grid gap-2'>
              <Label htmlFor='interview-range'>面谈时间</Label>
              <DateTimeRangePicker
                id='interview-range'
                value={scheduleRange}
                onChange={setScheduleRange}
                placeholder='选择面谈起止时间'
                numberOfMonths={1}
              />
            </div>

            <div className='grid gap-2'>
              <Label>追加参与人（可选）</Label>
              {/* 对齐 360 环评：成员 pills + 行尾「+」打开选人弹窗 */}
              <div className='overflow-hidden rounded-lg border'>
                <div className='grid grid-cols-[1fr_auto]'>
                  <div className='flex flex-wrap items-center gap-1.5 px-3 py-2'>
                    {extraAttendees.length === 0 ? (
                      <span className='text-muted-foreground/60 text-sm'>暂无追加参与人</span>
                    ) : (
                      extraAttendees.map(member => (
                        <AttendeePill
                          key={member.openId}
                          member={member}
                          onRemove={openId =>
                            setExtraAttendees(prev => prev.filter(item => item.openId !== openId))
                          }
                        />
                      ))
                    )}
                  </div>
                  <div className='flex items-start px-2 py-1.5'>
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      aria-label='添加参与人'
                      onClick={() => setAttendeesPickerOpen(true)}
                    >
                      <PlusIcon className='size-4' />
                    </Button>
                  </div>
                </div>
              </div>
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

      <LarkMemberPickerDialog
        open={attendeesPickerOpen}
        onOpenChange={setAttendeesPickerOpen}
        title='添加面谈参与人'
        searchPlaceholder='搜索并添加参与人'
        members={extraAttendees}
        membersLabel='已添加的参与人'
        onConfirm={added => {
          setExtraAttendees(prev => {
            const next = [...prev]

            for (const member of added) {
              if (!next.some(item => item.openId === member.openId)) next.push(member)
            }

            return next
          })
          setAttendeesPickerOpen(false)
        }}
        onRemoveMember={member =>
          setExtraAttendees(prev => prev.filter(item => item.openId !== member.openId))
        }
      />
    </div>
  )
}

export default Interviews
