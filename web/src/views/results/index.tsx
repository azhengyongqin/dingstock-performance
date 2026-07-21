'use client'

/**
 * 结果确认（员工视角，真实后端 /results/current）：
 * Alert 状态条 + StatsCards 摘要 + Tabs 结果明细（维度 / 上级评语 / 自评 / 申诉）。
 * RESULT_PUBLISHED 可确认或申诉；申诉处理后的 RE_CONFIRMING 仅可再次确认。
 */

// React Imports
import { useCallback, useEffect, useState } from 'react'

// Third-party Imports
import {
  AlertCircleIcon,
  AwardIcon,
  CheckCircle2Icon,
  GaugeIcon,
  HashIcon,
  Loader2Icon
} from 'lucide-react'
import { toast } from 'sonner'

// Component Imports
import FeishuCalendarLinkButton from '@/components/shared/FeishuCalendarLinkButton'
import PageHeader from '@/components/shared/PageHeader'
import { EvaluationAnswerContent } from '@/components/shared/markdown'
import {
  isPerfPerformanceLevel,
  PerformanceLevelBadge,
  RATING_SOFT
} from '@/components/shared/PerformanceLevelBadge'
import { StatsCards } from '@/components/shared/StatsCards'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

// Util Imports
import { apiFetch } from '@/lib/api'
import type { ListResponse, PerfAppealStatus, PerfInterviewStatus, PerfParticipantStatus } from '@/lib/perf-api'
import {
  APPEAL_STATUS_LABEL,
  INTERVIEW_STATUS_LABEL,
  PARTICIPANT_STATUS_LABEL,
  feishuCalendarEventUrl,
  formatDateTime
} from '@/lib/perf-api'
import { cn } from '@/lib/utils'

// ===== 后端数据类型（GET /results/current） =====

type DimensionResult = {
  dimensionKey: string
  name: string
  level: string
  score: string
}

type VisibleFieldAnswer = {
  fieldKey: string
  title: string
  type: string
  value?: unknown
}

type AppealItem = {
  id: number
  status: PerfAppealStatus
  reason: string
  conclusion?: string | null
}

type CurrentResult = {
  participant: { id: number; status: PerfParticipantStatus; cycle: { id: number; name: string } } | null
  result: {
    id: number
    version: number
    finalLevel: string
    previousFinalLevel?: string | null
    employeeExplanation?: string | null
    resultSnapshot: {
      manager: {
        compositeScore?: string | null
        level?: string | null
        dimensions: DimensionResult[]
        fields: VisibleFieldAnswer[]
      }
      self: { level?: string | null; fields: VisibleFieldAnswer[] }
      promotion: null
    }
    publishedAt: string
    confirmedAt?: string | null
  } | null
  appeals?: AppealItem[]
}

const APPEAL_STATUS_BADGE: Record<PerfAppealStatus, string> = {
  PENDING: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  RESOLVED: 'bg-green-500/10 text-green-600 dark:text-green-400'
}

type MyInterview = {
  id: number
  status: PerfInterviewStatus
  scheduledStartAt: string | null
  scheduledEndAt: string | null
  calendarId: string | null
  calendarEventId: string | null
  participant: { cycle: { id: number; name: string } }
}

const FieldAnswers = ({ fields }: { fields: VisibleFieldAnswer[] }) => {
  if (fields.length === 0) {
    return <p className='text-muted-foreground py-4 text-center text-sm'>暂无内容</p>
  }

  return (
    <div className='flex flex-col gap-3'>
      {fields.map(field => (
        <div key={`${field.fieldKey}-${field.title}`} className='space-y-1'>
          <p className='text-sm font-medium'>{field.title}</p>
          <EvaluationAnswerContent
            type={field.type}
            value={String(field.value ?? '')}
            className='text-muted-foreground text-sm'
          />
        </div>
      ))}
    </div>
  )
}

const StatusBadge = ({ confirmedAt }: { confirmedAt?: string | null }) =>
  confirmedAt ? (
    <Badge className='bg-green-500/10 text-green-600 dark:text-green-400'>
      已确认 · {formatDateTime(confirmedAt)}
    </Badge>
  ) : (
    <Badge className='bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'>待确认</Badge>
  )

const Results = () => {
  const [data, setData] = useState<CurrentResult | null>(null)
  const [interviews, setInterviews] = useState<MyInterview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [appealOpen, setAppealOpen] = useState(false)
  const [appealReason, setAppealReason] = useState('')
  const [appealSubmitting, setAppealSubmitting] = useState(false)

  const participant = data?.participant ?? null
  const result = data?.result ?? null
  const appeals = data?.appeals ?? []
  const actionable = participant?.status === 'RESULT_PUBLISHED' || participant?.status === 'RE_CONFIRMING'
  const appealPending = participant?.status === 'APPEALING'

  // 申诉处理后只能再次确认，不能对同一有效结果链发起第二次申诉。
  const canAppeal = participant?.status === 'RESULT_PUBLISHED'

  const cycleInterviews = interviews.filter(
    item => !participant || item.participant.cycle.id === participant.cycle.id
  )

  const fetchCurrent = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [res, mine] = await Promise.all([
        apiFetch<CurrentResult>('/results/current'),
        apiFetch<ListResponse<MyInterview>>('/interviews/mine').catch(() => ({
          items: [] as MyInterview[],
          total: 0
        }))
      ])

      setData(res)
      setInterviews(mine.items ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法加载绩效结果，请确认后端服务已启动。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const initialLoad = setTimeout(() => void fetchCurrent(), 0)

    return () => clearTimeout(initialLoad)
  }, [fetchCurrent])

  const handleConfirm = async () => {
    if (!participant || !result) return

    setConfirming(true)

    try {
      await apiFetch('/results/current/confirm', {
        method: 'POST',
        body: JSON.stringify({ participantId: participant.id, resultVersionId: result.id })
      })
      toast.success('绩效结果已确认')
      setConfirmOpen(false)
      await fetchCurrent()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '确认失败，请稍后重试')
    } finally {
      setConfirming(false)
    }
  }

  const handleAppeal = async () => {
    if (!participant || !result || !canAppeal) return

    if (!appealReason.trim()) {
      toast.error('请填写申诉理由')

      return
    }

    setAppealSubmitting(true)

    try {
      await apiFetch('/appeals', {
        method: 'POST',

        // 申诉必须精确绑定员工当前看到的不可变结果版本，防止刷新前后错绑旧结果。
        body: JSON.stringify({
          participantId: participant.id,
          resultVersionId: result.id,
          reason: appealReason.trim()
        })
      })
      toast.success('申诉已提交，HR 将安排申诉面谈')
      setAppealOpen(false)
      setAppealReason('')
      await fetchCurrent()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '申诉提交失败，请稍后重试')
    } finally {
      setAppealSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className='flex flex-col gap-6'>
        <PageHeader title='结果确认' description='正在加载绩效结果…' />
        <Skeleton className='h-36 w-full' />
        <Skeleton className='h-64 w-full' />
      </div>
    )
  }

  if (error) {
    return (
      <div className='flex flex-col gap-6'>
        <PageHeader title='结果确认' description='当前周期的绩效结果确认' />
        <Card>
          <CardContent className='text-muted-foreground flex flex-col items-center gap-3 py-16 text-sm'>
            <span>{error}</span>
            <Button variant='outline' size='sm' onClick={() => void fetchCurrent()}>
              重试
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!participant || !result) {
    return (
      <div className='flex flex-col gap-6'>
        <PageHeader title='结果确认' description='当前周期的绩效结果确认' />
        <Card>
          <CardContent className='text-muted-foreground flex flex-col items-center gap-2 py-16 text-sm'>
            <span>{participant ? '结果尚未发布' : '当前没有进行中的考核周期'}</span>
            <span>{participant ? '校准完成并推送结果后，可在此确认' : '周期进入结果确认阶段后可在此查看'}</span>
          </CardContent>
        </Card>
      </div>
    )
  }

  const dims = result.resultSnapshot.manager.dimensions
  const composite = result.resultSnapshot.manager.compositeScore
  const finalLevelColor = isPerfPerformanceLevel(result.finalLevel) ? RATING_SOFT[result.finalLevel] : null

  return (
    <div className='flex flex-col gap-6 pb-8'>
      <PageHeader
        title='结果确认'
        description={participant.cycle.name}
        actions={<StatusBadge confirmedAt={result.confirmedAt} />}
      />

      {actionable ? (
        <Alert className='border-amber-500/30 bg-amber-500/5'>
          <AlertCircleIcon />
          <AlertTitle>请确认本周期绩效结果</AlertTitle>
          <AlertDescription>
            等级 {result.finalLevel}
            {composite ? ` · 综合分 ${composite}` : ''}
            {canAppeal ? '。确认后进入面谈闭环；有异议可发起申诉。' : '。请再次确认申诉处理结果。'}
          </AlertDescription>
          <div className='col-span-full mt-3 flex justify-end gap-2'>
            {canAppeal && (
              <Button variant='outline' disabled={confirming} onClick={() => setAppealOpen(true)}>
                发起申诉
              </Button>
            )}
            <Button disabled={confirming} onClick={() => setConfirmOpen(true)}>
              确认结果
            </Button>
          </div>
        </Alert>
      ) : appealPending ? (
        <Alert className='border-blue-500/30 bg-blue-500/5'>
          <AlertCircleIcon />
          <AlertTitle>申诉处理中</AlertTitle>
          <AlertDescription>申诉已提交，请等待 HR 完成申诉处理；处理完成后请再次确认结果。</AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <CheckCircle2Icon />
          <AlertTitle>结果已确认</AlertTitle>
          <AlertDescription>
            {result.confirmedAt ? `确认于 ${formatDateTime(result.confirmedAt)}` : '本周期结果已处理完毕'}
            {result.employeeExplanation ? ` · ${result.employeeExplanation}` : ''}
          </AlertDescription>
        </Alert>
      )}

      <StatsCards
        items={[
          {
            label: '绩效等级',
            value: <PerformanceLevelBadge level={result.finalLevel} size='md' variant='plain' />,
            description:
              result.previousFinalLevel && result.previousFinalLevel !== result.finalLevel
                ? `${result.previousFinalLevel} → ${result.finalLevel}`
                : PARTICIPANT_STATUS_LABEL[participant.status],
            icon: <AwardIcon className='size-4' />,
            iconClassName: finalLevelColor
              ? cn(finalLevelColor.bg, finalLevelColor.text)
              : 'bg-primary/10 text-primary'
          },
          {
            label: '综合分',
            value: composite ?? '—',
            description: '上级评估综合分',
            icon: <GaugeIcon className='size-4' />,
            iconClassName: 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
          },
          {
            label: '版本',
            value: `V${result.version}`,
            description: `发布于 ${formatDateTime(result.publishedAt)}`,
            icon: <HashIcon className='size-4' />,
            iconClassName: 'bg-violet-500/10 text-violet-600 dark:text-violet-400'
          },
          {
            label: '我的状态',
            value: PARTICIPANT_STATUS_LABEL[participant.status] ?? participant.status,
            description: result.employeeExplanation ?? '当前周期参评状态',
            icon: <CheckCircle2Icon className='size-4' />,
            iconClassName: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          }
        ]}
      />

      {cycleInterviews.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>我的面谈预约</CardTitle>
            <CardDescription>仅展示预约时间与飞书日程入口；面谈纪要对员工不可见</CardDescription>
          </CardHeader>
          <CardContent className='flex flex-col gap-3'>
            {cycleInterviews.map(interview => {
              const calendarHref =
                interview.calendarId && interview.calendarEventId
                  ? feishuCalendarEventUrl(interview.calendarId, interview.calendarEventId)
                  : null

              return (
                <div
                  key={interview.id}
                  className='flex flex-col gap-1 rounded-lg border p-3 text-sm sm:flex-row sm:items-center sm:justify-between'
                >
                  <div className='flex flex-col gap-1'>
                    <div className='flex items-center gap-2'>
                      <Badge variant='outline'>
                        {INTERVIEW_STATUS_LABEL[interview.status] ?? interview.status}
                      </Badge>
                      <span>
                        {interview.scheduledStartAt
                          ? formatDateTime(interview.scheduledStartAt)
                          : '时间待定'}
                        {interview.scheduledEndAt
                          ? ` ~ ${formatDateTime(interview.scheduledEndAt)}`
                          : ''}
                      </span>
                    </div>
                  </div>
                  {calendarHref ? (
                    <FeishuCalendarLinkButton href={calendarHref} />
                  ) : (
                    <span className='text-muted-foreground text-xs'>暂无日程入口</span>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>结果明细</CardTitle>
          <CardDescription>按 Tab 查看维度评分、评语与自评</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue='dimensions'>
            <TabsList>
              <TabsTrigger value='dimensions'>各维度</TabsTrigger>
              <TabsTrigger value='manager'>上级评语</TabsTrigger>
              <TabsTrigger value='self'>我的自评</TabsTrigger>
              {appeals.length > 0 && <TabsTrigger value='appeals'>申诉</TabsTrigger>}
            </TabsList>

            <TabsContent value='dimensions' className='mt-4 space-y-3'>
              {dims.length === 0 ? (
                <p className='text-muted-foreground py-6 text-center text-sm'>暂无维度结果明细</p>
              ) : (
                dims.map(dimension => {
                  const levelColor = isPerfPerformanceLevel(dimension.level)
                    ? RATING_SOFT[dimension.level]
                    : null

                  return (
                    <Card key={dimension.dimensionKey} size='sm'>
                      <CardContent className='flex flex-col gap-2'>
                        <div className='flex flex-wrap items-center justify-between gap-2'>
                          <div className='flex items-center gap-2'>
                            <span className='font-medium'>{dimension.name}</span>
                            <PerformanceLevelBadge level={dimension.level} />
                          </div>
                          <span
                            className={cn(
                              'text-lg font-semibold tabular-nums',
                              levelColor?.text ?? 'text-primary'
                            )}
                          >
                            {dimension.score} 分
                          </span>
                        </div>
                        <Progress value={Number(dimension.score) || 0} className='h-2' />
                      </CardContent>
                    </Card>
                  )
                })
              )}
            </TabsContent>

            <TabsContent value='manager' className='mt-4'>
              <FieldAnswers fields={result.resultSnapshot.manager.fields} />
            </TabsContent>

            <TabsContent value='self' className='mt-4 space-y-3'>
              {result.resultSnapshot.self.level && (
                <div className='flex items-center gap-2 text-sm'>
                  <span className='text-muted-foreground'>自评等级</span>
                  <PerformanceLevelBadge level={result.resultSnapshot.self.level} />
                </div>
              )}
              <FieldAnswers fields={result.resultSnapshot.self.fields} />
            </TabsContent>

            {appeals.length > 0 && (
              <TabsContent value='appeals' className='mt-4'>
                <div className='flex flex-col gap-3'>
                  {appeals.map(appeal => (
                    <div key={appeal.id} className='rounded-lg border p-3 text-sm'>
                      <Badge className={APPEAL_STATUS_BADGE[appeal.status]}>
                        {APPEAL_STATUS_LABEL[appeal.status] ?? appeal.status}
                      </Badge>
                      <p className='mt-2'>{appeal.reason}</p>
                      {appeal.conclusion && (
                        <p className='text-muted-foreground mt-1'>结论：{appeal.conclusion}</p>
                      )}
                    </div>
                  ))}
                </div>
              </TabsContent>
            )}
          </Tabs>
        </CardContent>
      </Card>

      <p className='text-muted-foreground text-center text-xs'>
        {canAppeal
          ? '确认结果后进入面谈闭环；若对结果有异议，请在确认窗口内点击「发起申诉」。逾期未操作视为默认确认。'
          : participant.status === 'RE_CONFIRMING'
            ? '申诉处理后请确认复核结果；确认后进入面谈闭环。逾期未操作视为默认确认。'
            : appealPending
              ? '申诉正在处理中，处理完成后可在此查看并确认复核结果。'
              : '本周期结果已确认，已进入面谈闭环。'}
      </p>

      <Dialog
        open={confirmOpen}
        onOpenChange={open => {
          if (confirming) return
          setConfirmOpen(open)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认绩效结果？</DialogTitle>
            <DialogDescription>
              确认后本周期绩效结果将正式生效：此后无法再发起申诉，也无法更改绩效等级。请确认已充分了解当前结果后再继续。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' disabled={confirming} onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button disabled={confirming} onClick={() => void handleConfirm()}>
              {confirming && <Loader2Icon className='size-4 animate-spin' />}
              确认结果
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={appealOpen} onOpenChange={setAppealOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>发起申诉</DialogTitle>
            <DialogDescription>请说明对绩效结果的异议与理由，提交后 HR 将安排申诉面谈</DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder='请填写申诉理由（必填）…'
            rows={5}
            value={appealReason}
            onChange={event => setAppealReason(event.target.value)}
          />
          <DialogFooter>
            <Button variant='outline' disabled={appealSubmitting} onClick={() => setAppealOpen(false)}>
              取消
            </Button>
            <Button disabled={appealSubmitting || !appealReason.trim()} onClick={() => void handleAppeal()}>
              {appealSubmitting && <Loader2Icon className='size-4 animate-spin' />}
              提交申诉
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default Results
