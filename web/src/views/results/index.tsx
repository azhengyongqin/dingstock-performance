'use client'

// React Imports
import { useCallback, useEffect, useState } from 'react'

// Third-party Imports
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

// Component Imports
import PageHeader from '@/components/shared/PageHeader'
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
import { Textarea } from '@/components/ui/textarea'

// Util Imports
import { apiFetch } from '@/lib/api'
import type { PerfAppealStatus, PerfParticipantStatus } from '@/lib/perf-api'
import { APPEAL_STATUS_LABEL, PARTICIPANT_STATUS_LABEL, formatDateTime } from '@/lib/perf-api'

// ===== 后端数据类型（GET /results/current） =====

/** 单个维度的最终结果 */
type DimensionResult = {
  dimensionId: number
  name: string
  level?: string | null
  score?: number | null
  comment?: string | null
}

/** 我的申诉记录 */
type AppealItem = {
  id: number
  status: PerfAppealStatus
  reason: string
  conclusion?: string | null
}

/** 当前周期结果上下文 */
type CurrentResult = {
  participant: { id: number; status: PerfParticipantStatus; cycle: { id: number; name: string } } | null
  result: {
    finalLevel: string
    dimensionResults: DimensionResult[]
    promotionResult?: string | null
    confirmedByEmployee: boolean
    confirmedAt?: string | null
  } | null
  appeals: AppealItem[]
}

// 申诉状态徽标配色
const APPEAL_STATUS_BADGE: Record<PerfAppealStatus, string> = {
  PENDING: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  IN_INTERVIEW: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  RESOLVED: 'bg-green-500/10 text-green-600 dark:text-green-400'
}

/**
 * 结果确认（员工视角，真实后端 /results/current）：
 * 绩效等级展示卡 + 各维度结果 + 确认/申诉操作 + 申诉记录。
 * participant.status 为 RESULT_PUSHED / RE_CONFIRMING 时可确认或发起申诉。
 */
const Results = () => {
  // 结果数据
  const [data, setData] = useState<CurrentResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 操作中状态
  const [confirming, setConfirming] = useState(false)

  // 申诉弹窗
  const [appealOpen, setAppealOpen] = useState(false)
  const [appealReason, setAppealReason] = useState('')
  const [appealSubmitting, setAppealSubmitting] = useState(false)

  const participant = data?.participant ?? null
  const result = data?.result ?? null
  const appeals = data?.appeals ?? []

  // 可操作：结果已推送待确认 / 申诉处理后待再次确认
  const actionable = participant?.status === 'RESULT_PUSHED' || participant?.status === 'RE_CONFIRMING'

  // 拉取当前周期结果
  const fetchCurrent = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await apiFetch<CurrentResult>('/results/current')

      setData(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法加载绩效结果，请确认后端服务已启动。')
    } finally {
      setLoading(false)
    }
  }, [])

  // 首次加载（放入宏任务，避免在 effect 中同步 setState）
  useEffect(() => {
    const initialLoad = setTimeout(() => void fetchCurrent(), 0)

    return () => clearTimeout(initialLoad)
  }, [fetchCurrent])

  // 确认结果
  const handleConfirm = async () => {
    if (!participant) return

    setConfirming(true)

    try {
      await apiFetch('/results/current/confirm', {
        method: 'POST',
        body: JSON.stringify({ cycleId: participant.cycle.id })
      })
      toast.success('绩效结果已确认')
      await fetchCurrent()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '确认失败，请稍后重试')
    } finally {
      setConfirming(false)
    }
  }

  // 提交申诉（理由必填）
  const handleAppeal = async () => {
    if (!participant) return

    if (!appealReason.trim()) {
      toast.error('请填写申诉理由')

      return
    }

    setAppealSubmitting(true)

    try {
      await apiFetch('/appeals', {
        method: 'POST',
        body: JSON.stringify({ cycleId: participant.cycle.id, reason: appealReason.trim() })
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

  // ===== 三态：加载 / 错误 / 无周期或结果未发布 =====

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

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='结果确认'
        description={`${participant.cycle.name} · 我的状态：${PARTICIPANT_STATUS_LABEL[participant.status] ?? participant.status}`}
        actions={
          result.confirmedByEmployee ? (
            <Badge className='bg-green-500/10 text-green-600 dark:text-green-400'>
              已确认{result.confirmedAt ? ` · ${formatDateTime(result.confirmedAt)}` : ''}
            </Badge>
          ) : (
            <Badge className='bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'>待确认</Badge>
          )
        }
      />

      {/* 绩效等级展示卡 */}
      <Card>
        <CardContent className='flex flex-wrap items-center justify-between gap-6'>
          <div className='flex items-center gap-6'>
            <div className='bg-primary/10 text-primary flex size-20 items-center justify-center rounded-2xl text-4xl font-bold'>
              {result.finalLevel}
            </div>
            <div className='flex flex-col gap-1'>
              <span className='text-lg font-semibold'>绩效等级：{result.finalLevel}</span>
              <span className='text-muted-foreground text-sm'>经校准会议确认的最终结果</span>
              {/* 晋升结果：仅参与晋升评估且有结论时展示 */}
              {result.promotionResult && (
                <span className='text-muted-foreground text-sm'>晋升结果：{result.promotionResult}</span>
              )}
            </div>
          </div>
          {/* 确认 / 申诉操作：仅待确认或待再次确认时可用 */}
          {actionable && (
            <div className='flex items-center gap-3'>
              <Button variant='outline' disabled={confirming} onClick={() => setAppealOpen(true)}>
                发起申诉
              </Button>
              <Button disabled={confirming} onClick={() => void handleConfirm()}>
                {confirming && <Loader2Icon className='size-4 animate-spin' />}
                确认结果
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 各维度结果 */}
      <Card>
        <CardHeader>
          <CardTitle>各维度结果</CardTitle>
          <CardDescription>按评估维度拆解的结果与评语</CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-4'>
          {result.dimensionResults.length === 0 ? (
            <p className='text-muted-foreground py-6 text-center text-sm'>暂无维度结果明细</p>
          ) : (
            result.dimensionResults.map(dimension => (
              <div key={dimension.dimensionId} className='flex flex-col gap-2 rounded-lg border p-4'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <div className='flex items-center gap-2'>
                    <span className='font-medium'>{dimension.name}</span>
                    {dimension.level && <Badge variant='outline'>等级 {dimension.level}</Badge>}
                  </div>
                  {dimension.score != null && (
                    <span className='text-primary text-lg font-semibold'>{dimension.score} 分</span>
                  )}
                </div>
                {/* 分值型维度用进度条可视化 */}
                {dimension.score != null && <Progress value={dimension.score} className='h-2' />}
                {dimension.comment && <p className='text-muted-foreground text-sm'>{dimension.comment}</p>}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* 申诉记录：已发起过申诉时展示 */}
      {appeals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>我的申诉</CardTitle>
            <CardDescription>本周期发起的申诉与处理进展</CardDescription>
          </CardHeader>
          <CardContent className='flex flex-col gap-3'>
            {appeals.map(appeal => (
              <div key={appeal.id} className='flex flex-col gap-2 rounded-lg border p-4'>
                <div className='flex items-center gap-2'>
                  <Badge className={APPEAL_STATUS_BADGE[appeal.status]}>
                    {APPEAL_STATUS_LABEL[appeal.status] ?? appeal.status}
                  </Badge>
                </div>
                <p className='text-sm'>申诉理由：{appeal.reason}</p>
                {appeal.conclusion && <p className='text-muted-foreground text-sm'>处理结论：{appeal.conclusion}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 确认说明 */}
      <Card>
        <CardContent className='text-muted-foreground text-sm'>
          确认结果后进入面谈闭环阶段；若对结果有异议，请在确认窗口内点击「发起申诉」，HR 将安排申诉面谈。逾期未操作视为默认确认。
        </CardContent>
      </Card>

      {/* 申诉弹窗：理由必填 */}
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
