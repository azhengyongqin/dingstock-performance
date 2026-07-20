'use client'

// React Imports
import { useCallback, useEffect, useState } from 'react'

// Third-party Imports
import { AlertCircleIcon, ClockIcon, InfoIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

// Component Imports
import EvaluationSplitLayout from '@/components/shared/EvaluationSplitLayout'
import { ParticipantOkrWarmup } from '@/components/shared/okr'
import PageHeader from '@/components/shared/PageHeader'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

// Util Imports
import {
  formatDateTime,
  getSelfEvaluationContext,
  saveSelfEvaluationDraft,
  submitSelfEvaluation,
  type PerfSelfEvaluationContext,
  type PerfSelfEvaluationState
} from '@/lib/perf-api'

import EvaluationForm from './evaluation-form'
import {
  buildDraftPayloadDimensions,
  buildDimensionSubmitPayload,
  subformsForStage,
  toDimensionEvaluationAnswers,
  type EvaluationAnswers,
  type EvaluationItemAnswer
} from './evaluation-form-types'
import ReferencePanel from './reference-panel'

const STATE_LABEL: Record<Exclude<PerfSelfEvaluationState, null>, string> = {
  DRAFT: '草稿',
  EFFECTIVE: '已生效',
  PENDING_RESUBMIT: '待重新提交'
}

const STATE_BADGE: Record<Exclude<PerfSelfEvaluationState, null>, string> = {
  DRAFT: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  EFFECTIVE: 'bg-green-500/10 text-green-600 dark:text-green-400',
  PENDING_RESUBMIT: 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
}

/**
 * 员工自评（统一提交，ADR-0009）：左侧参考区（OKR/复盘/日志，可折叠）+ 右侧动态表单，
 * 同处一张 Card，中间分割线分隔；支持草稿保存与提交。
 */
const SelfReview = () => {
  const [data, setData] = useState<PerfSelfEvaluationContext | null>(null)
  const [state, setState] = useState<PerfSelfEvaluationState>(null)
  const [answers, setAnswers] = useState<EvaluationAnswers>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [referenceCollapsed, setReferenceCollapsed] = useState(false)

  // 拉取自评上下文：任务开放状态 + 表单快照 + 生效/草稿明细 + 状态标记
  const fetchContext = useCallback(async () => {
    setLoading(true)
    setLoadError(null)

    try {
      const result = await getSelfEvaluationContext()

      setData(result)
      setState(result.state)
      setAnswers(toDimensionEvaluationAnswers((result.draft ?? result.submitted)?.dimensionAnswers ?? []))
      setErrors({})
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '无法加载自评数据，请确认后端服务已启动。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const initialLoad = setTimeout(() => void fetchContext(), 0)

    return () => clearTimeout(initialLoad)
  }, [fetchContext])

  const handleAnswerChange = (itemKey: string, answer: EvaluationItemAnswer) => {
    setAnswers(prev => ({ ...prev, [itemKey]: answer }))
    setErrors(prev => {
      if (!prev[itemKey]) return prev
      const next = { ...prev }

      delete next[itemKey]

      return next
    })
  }

  // 保存草稿：允许不完整，跳过未作答/格式不合法的项；已生效时保存新草稿转为「待重新提交」
  const handleSaveDraft = async () => {
    if (!data?.participant || !data.form) return

    setSaving(true)

    try {
      const dimensions = buildDraftPayloadDimensions(subformsForStage(data.form.subforms, 'SELF'), answers)

      await saveSelfEvaluationDraft({ cycleId: data.participant.cycleId, dimensions })
      toast.success('草稿已保存')
      setState(prev => (prev === 'EFFECTIVE' || prev === 'PENDING_RESUBMIT' ? 'PENDING_RESUBMIT' : 'DRAFT'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存草稿失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  // 提交：前端就地必填/格式校验通过后才发起请求；提交成功后完整刷新上下文（此时不再有未保存的本地内容需要保留）
  const handleSubmit = async () => {
    if (!data?.participant || !data.form) return

    const { errors: validationErrors, dimensions } = buildDimensionSubmitPayload(
      subformsForStage(data.form.subforms, 'SELF'),
      answers,
      data.participant.cycle.currentConfigVersion?.ratings ?? []
    )

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      toast.error('还有必填项未完成或内容格式有误，请检查后再提交')

      return
    }

    setErrors({})
    setSubmitting(true)

    try {
      await submitSelfEvaluation({ cycleId: data.participant.cycleId, dimensions })
      toast.success('自评已提交')
      await fetchContext()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  // ===== 加载 / 错误 / 无进行中周期 =====

  if (loading) {
    return (
      <div className='flex flex-col gap-6'>
        <PageHeader title='员工自评' description='正在加载当前周期自评…' backHref='/workbench' backLabel='工作台' />
        <Skeleton className='h-48 w-full' />
        <Skeleton className='h-72 w-full' />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className='flex flex-col gap-6'>
        <PageHeader title='员工自评' description='当前周期的自评填写' backHref='/workbench' backLabel='工作台' />
        <Card>
          <CardContent className='text-muted-foreground flex flex-col items-center gap-3 py-16 text-sm'>
            <span>{loadError}</span>
            <Button variant='outline' size='sm' onClick={() => void fetchContext()}>
              重试
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const participant = data?.participant ?? null

  if (!participant) {
    return (
      <div className='flex flex-col gap-6'>
        <PageHeader title='员工自评' description='当前周期的自评填写' backHref='/workbench' backLabel='工作台' />
        <Card>
          <CardContent className='text-muted-foreground flex flex-col items-center gap-2 py-16 text-sm'>
            <span>当前没有进行中的考核周期</span>
            <span>周期启动并进入自评阶段后，可在此填写自评</span>
          </CardContent>
        </Card>
      </div>
    )
  }

  // 任务未到开始时间：只展示预告，不下发表单结构，不允许填写
  if (!data?.form) {
    return (
      <div className='flex flex-col gap-6'>
        <ParticipantOkrWarmup participantId={participant.id} />
        <PageHeader
          title='员工自评'
          description={`${participant.cycle.name} · 自评任务尚未开放`}
          backHref='/workbench'
          backLabel='工作台'
        />
        <Alert>
          <ClockIcon />
          <AlertTitle>自评尚未开放</AlertTitle>
          <AlertDescription>
            {data?.task?.startAt
              ? `自评将于 ${formatDateTime(data.task.startAt)} 开放，请届时填写`
              : '自评任务尚未配置开始时间，请联系 HR'}
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  const ratings = participant.cycle.currentConfigVersion?.ratings

  return (
    <div className='flex h-full min-h-0 flex-col gap-3 overflow-hidden'>
      <div className='shrink-0 space-y-3'>
        <PageHeader
          title='员工自评'
          description={participant.cycle.name}
          backHref='/workbench'
          backLabel='工作台'
          actions={
            state && (
              <Badge className={STATE_BADGE[state]}>
                {STATE_LABEL[state]}
                {state === 'EFFECTIVE' && data.submitted?.submittedAt
                  ? ` · ${formatDateTime(data.submitted.submittedAt)}`
                  : ''}
              </Badge>
            )
          }
        />

        {/* 有生效版本又有草稿：明确提示重新提交前生效版本仍参与计算，避免误以为草稿已经替换结果 */}
        {state === 'PENDING_RESUBMIT' && (
          <Alert>
            <InfoIcon />
            <AlertTitle>待重新提交</AlertTitle>
            <AlertDescription>已生效版本仍参与计算，完整重新提交后才会替换</AlertDescription>
          </Alert>
        )}

        {Object.keys(errors).length > 0 && (
          <Alert variant='destructive'>
            <AlertCircleIcon />
            <AlertTitle>还有必填项未完成或内容格式有误</AlertTitle>
            <AlertDescription>请检查下方标红的评估维度或表单字段后再提交</AlertDescription>
          </Alert>
        )}
      </div>

      <EvaluationSplitLayout
        collapsed={referenceCollapsed}
        onCollapsedChange={setReferenceCollapsed}
        left={
          <ReferencePanel
            participantId={participant.id}
            employee={data.employee}
            collapsed={referenceCollapsed}
            onCollapsedChange={setReferenceCollapsed}
          />
        }
        right={
          <EvaluationForm
            subforms={subformsForStage(data.form.subforms, 'SELF')}
            answers={answers}
            onAnswerChange={handleAnswerChange}
            errors={errors}
            ratings={ratings}
          />
        }
      />

      {/* 底部操作栏：流式紧贴 Card，不再 fixed + 预留大块底距 */}
      <div className='flex shrink-0 items-center justify-between gap-4 py-1'>
        <span className='text-muted-foreground text-sm'>可先保存草稿，完整填写后再提交生效</span>
        <div className='flex items-center gap-3'>
          <Button variant='outline' disabled={saving || submitting} onClick={() => void handleSaveDraft()}>
            {saving && <Loader2Icon className='size-4 animate-spin' />}
            保存草稿
          </Button>
          <Button disabled={saving || submitting} onClick={() => void handleSubmit()}>
            {submitting && <Loader2Icon className='size-4 animate-spin' />}
            提交自评
          </Button>
        </div>
      </div>
    </div>
  )
}

export default SelfReview
