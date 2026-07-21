'use client'

/**
 * 处理申诉侧栏（方案 B）：右侧 Sheet，分区滚动 + 底栏结案。
 */

import Link from 'next/link'
import { ArrowRightIcon, Loader2Icon } from 'lucide-react'

import FeishuCalendarLinkButton from '@/components/shared/FeishuCalendarLinkButton'
import { PerformanceLevelBadge } from '@/components/shared/PerformanceLevelBadge'
import { UserAvatar } from '@/components/shared/lark'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible'
import { Field, FieldLabel } from '@/components/ui/field'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import {
  appealDisplayLabel,
  avatarUrlOf,
  feishuCalendarEventUrl,
  formatDateTime,
  interviewDisplayLabel,
  isInterviewScheduleStarted,
  type PerfInterviewStatus,
  type PerfPerformanceLevel
} from '@/lib/perf-api'
import { cn } from '@/lib/utils'

import type { AppealRow } from './appeal-table-columns'

export type AppealLinkedInterview = {
  id: number
  status: PerfInterviewStatus
  scheduledStartAt?: string | null
  scheduledEndAt?: string | null
  calendarId?: string | null
  calendarEventId?: string | null
  createdAt: string
  resultNotes?: string | null
}

export type AppealCalibrationItem = {
  id: number
  beforeLevel: string | null
  afterLevel: string
  reason: string | null
  createdAt: string
}

export type AppealDetailSheetProps = {
  appeal: AppealRow
  interviews: AppealLinkedInterview[]
  calibrations: AppealCalibrationItem[]
  detailLoading: boolean

  /** 详情接口返回的结论文案（已处理时优先） */
  detailConclusion?: string | null
  conclusion: string
  onConclusionChange: (value: string) => void
  resolving: boolean
  latestCalibrationId: number | null
  interviewViewHref: string
  interviewWorkspaceHref: string
  onClose: () => void
  onResolve: () => void
}

const statusBadgeClass = (row: AppealRow) => {
  if (row.status === 'RESOLVED') return 'bg-green-500/10 text-green-600 dark:text-green-400'
  if (row.inInterview) return 'bg-blue-500/10 text-blue-600 dark:text-blue-400'

  return 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
}

const LEVELS: PerfPerformanceLevel[] = ['S', 'A', 'B', 'C']

/** 与面谈工作台状态列一致 */
const interviewStatusBadgeClass: Record<PerfInterviewStatus, string> = {
  SCHEDULED: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  COMPLETED: 'bg-green-500/10 text-green-600 dark:text-green-400',
  CANCELLED: 'bg-muted text-muted-foreground'
}

const interviewInProgressBadgeClass = 'bg-violet-500/10 text-violet-600 dark:text-violet-400'

const sortedInterviewsNewestFirst = (items: AppealLinkedInterview[]) =>
  [...items].sort((a, b) => b.id - a.id)

const AppealDetailSheet = (props: AppealDetailSheetProps) => {
  const { appeal } = props
  const level = appeal.participant.resultVersions[0]?.finalLevel
  const interviews = sortedInterviewsNewestFirst(props.interviews)
  const canSchedule = appeal.status !== 'RESOLVED'

  return (
    <Sheet open onOpenChange={open => !open && props.onClose()}>
      <SheetContent side='right' className='w-full gap-0 p-0 sm:max-w-md'>
        <SheetHeader className='border-b'>
          <SheetTitle className='sr-only'>
            {appeal.status === 'RESOLVED' ? '申诉记录' : '处理申诉'}
          </SheetTitle>
          <SheetDescription className='sr-only'>{appeal.employee?.name}</SheetDescription>

          <div className='flex items-start gap-3'>
            <UserAvatar
              openId={appeal.employee?.open_id}
              name={appeal.employee?.name}
              avatarUrl={avatarUrlOf(appeal.employee)}
            />
            <div className='min-w-0 flex-1'>
              <div className='flex flex-wrap items-center gap-2'>
                <p className='truncate font-medium'>{appeal.employee?.name ?? '-'}</p>
                <Badge variant='secondary' className={statusBadgeClass(appeal)}>
                  {appealDisplayLabel(appeal)}
                </Badge>
              </div>
              <p className='text-muted-foreground truncate text-xs'>{appeal.participant.cycle.name}</p>
              {level ? (
                <div className='mt-1.5 flex items-center gap-1.5'>
                  <span className='text-muted-foreground text-xs'>当前等级</span>
                  {LEVELS.includes(level as PerfPerformanceLevel) ? (
                    <PerformanceLevelBadge level={level as PerfPerformanceLevel} size='sm' />
                  ) : (
                    <Badge variant='outline'>{level}</Badge>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </SheetHeader>

        <div className='flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4'>
          {props.detailLoading ? (
            <div className='text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm'>
              <Loader2Icon className='size-4 animate-spin' />
              加载详情…
            </div>
          ) : (
            <>
              <section className='grid gap-2'>
                <h3 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>理由</h3>
                <div className='bg-muted/50 grid gap-1 rounded-lg border px-3 py-2.5'>
                  <span className='sr-only'>申诉理由</span>
                  <p className='text-sm whitespace-pre-wrap'>{appeal.reason || '-'}</p>
                </div>
              </section>

              {/* 紧凑表格式：色点状态；最新已取消时行内「重新预约」 */}
              <section className='grid gap-2'>
                <h3 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>面谈</h3>
                {interviews.length === 0 ? (
                  <div className='text-muted-foreground flex items-center justify-between text-xs'>
                    <span>无记录</span>
                    {canSchedule ? (
                      <Link
                        href={props.interviewWorkspaceHref}
                        className='text-primary font-medium underline-offset-4 hover:underline'
                      >
                        预约
                      </Link>
                    ) : null}
                  </div>
                ) : (
                  <div className='overflow-hidden rounded-md border'>
                    <table className='w-full text-sm'>
                      <tbody>
                        {interviews.map((interview, index) => {
                          const isLatest = index === 0
                          const calendarHref =
                            interview.calendarId && interview.calendarEventId
                              ? feishuCalendarEventUrl(interview.calendarId, interview.calendarEventId)
                              : null
                          const showRebook =
                            isLatest && interview.status === 'CANCELLED' && canSchedule

                          return (
                            <tr key={interview.id} className='border-b last:border-0'>
                              <td className='px-2 py-2'>
                                <div className='flex items-center gap-2'>
                                  <span
                                    className={cn(
                                      'size-2 shrink-0 rounded-full',
                                      interview.status === 'SCHEDULED' && 'bg-blue-500',
                                      interview.status === 'COMPLETED' && 'bg-green-500',
                                      interview.status === 'CANCELLED' && 'bg-muted-foreground/40'
                                    )}
                                  />
                                  <Link
                                    href={props.interviewViewHref}
                                    className='text-primary font-medium underline-offset-4 hover:underline'
                                  >
                                    #{interview.id}
                                  </Link>
                                </div>
                              </td>
                              <td className='px-2 py-2 whitespace-nowrap'>
                                <Badge
                                  variant='secondary'
                                  className={cn(
                                    'font-normal',
                                    interview.status === 'SCHEDULED' &&
                                      isInterviewScheduleStarted(interview.scheduledStartAt)
                                      ? interviewInProgressBadgeClass
                                      : interviewStatusBadgeClass[interview.status]
                                  )}
                                >
                                  {interviewDisplayLabel(interview)}
                                </Badge>
                              </td>
                              <td className='text-muted-foreground px-2 py-2 text-xs whitespace-nowrap'>
                                {interview.scheduledStartAt
                                  ? formatDateTime(interview.scheduledStartAt)
                                  : formatDateTime(interview.createdAt)}
                              </td>
                              <td className='px-2 py-2 text-right'>
                                <div className='flex items-center justify-end gap-1'>
                                  {calendarHref ? (
                                    <FeishuCalendarLinkButton
                                      href={calendarHref}
                                      sizeClassName='h-7'
                                      logoSize={14}
                                    />
                                  ) : null}
                                  {showRebook ? (
                                    <Button
                                      size='sm'
                                      variant='outline'
                                      className='h-7'
                                      render={<Link href={props.interviewWorkspaceHref} />}
                                      nativeButton={false}
                                    >
                                      重新预约
                                    </Button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className='grid gap-2'>
                <h3 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>校准</h3>
                {appeal.status === 'RESOLVED' ? (
                  <div className='grid gap-1'>
                    <span className='text-muted-foreground text-xs'>
                      处理结论
                      {appeal.resolvedAt ? ` · ${formatDateTime(appeal.resolvedAt)}` : ''}
                    </span>
                    <p className='text-sm whitespace-pre-wrap'>
                      {props.detailConclusion ?? appeal.conclusion ?? '-'}
                    </p>
                    {appeal.resultAdjusted ? (
                      <Badge variant='outline' className='w-fit text-yellow-600 dark:text-yellow-400'>
                        结果已调整
                      </Badge>
                    ) : null}
                  </div>
                ) : props.latestCalibrationId == null ? (
                  <p className='text-muted-foreground rounded-lg border border-dashed px-3 py-2 text-xs'>
                    尚无校准决定。请先到{' '}
                    <Link
                      href='/calibrations'
                      className='text-primary font-medium underline-offset-4 hover:underline'
                    >
                      校准工作台
                    </Link>{' '}
                    完成校准后再结案。
                  </p>
                ) : (
                  <>
                    {(() => {
                      const latest = props.calibrations.find(item => item.id === props.latestCalibrationId)

                      if (!latest) return null

                      return (
                        <div className='bg-muted/40 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm'>
                          <span className='text-muted-foreground text-xs'>结案锁定</span>
                          <Badge variant='outline'>{latest.beforeLevel ?? '-'}</Badge>
                          <ArrowRightIcon className='text-muted-foreground size-3.5' />
                          <Badge className='bg-primary/10 text-primary'>{latest.afterLevel}</Badge>
                          <span className='text-muted-foreground ml-auto text-xs'>rev #{latest.id}</span>
                        </div>
                      )
                    })()}
                    {props.calibrations.length > 1 ? (
                      <Collapsible>
                        <CollapsibleTrigger
                          render={<Button variant='ghost' size='sm' className='h-7 px-0 text-xs' />}
                        >
                          查看全部 {props.calibrations.length} 条
                        </CollapsibleTrigger>
                        <CollapsibleContent className='mt-2 grid gap-2'>
                          {props.calibrations.map(item => (
                            <div key={item.id} className='flex items-center gap-2 text-xs'>
                              <Badge variant='outline'>{item.beforeLevel ?? '-'}</Badge>
                              <ArrowRightIcon className='size-3' />
                              <Badge variant='secondary'>{item.afterLevel}</Badge>
                              <span className='text-muted-foreground ml-auto'>
                                {formatDateTime(item.createdAt)}
                              </span>
                            </div>
                          ))}
                        </CollapsibleContent>
                      </Collapsible>
                    ) : null}
                  </>
                )}
              </section>
            </>
          )}
        </div>

        {appeal.status !== 'RESOLVED' && !props.detailLoading ? (
          <SheetFooter className='border-t'>
            <div className='grid w-full gap-3'>
              <Field>
                <FieldLabel>处理结论</FieldLabel>
                <Textarea
                  value={props.conclusion}
                  onChange={e => props.onConclusionChange(e.target.value)}
                  placeholder='给出申诉处理结论，将同步至员工'
                  rows={6}
                  className='min-h-32'
                />
              </Field>
              <div className='flex justify-end gap-2'>
                <Button variant='outline' onClick={props.onClose}>
                  取消
                </Button>
                <Button
                  onClick={props.onResolve}
                  disabled={props.resolving || props.latestCalibrationId == null}
                >
                  {props.resolving ? <Loader2Icon className='size-4 animate-spin' /> : null}
                  提交结案
                </Button>
              </div>
            </div>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

export default AppealDetailSheet
