'use client'

import { useCallback, useEffect, useState } from 'react'

import { useRouter } from 'next/navigation'
import { Edit3Icon, Loader2Icon, SaveIcon, SendIcon } from 'lucide-react'
import { toast } from 'sonner'

import EvaluationSplitLayout from '@/components/shared/EvaluationSplitLayout'
import { ParticipantOkrWarmup } from '@/components/shared/okr'
import PageHeader from '@/components/shared/PageHeader'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ApiError } from '@/lib/api'
import {
  getPeerEvaluationContext,
  savePeerEvaluationDraft,
  submitPeerEvaluation,
  type PerfPeerEvaluationContext
} from '@/lib/perf-api'
import EvaluationForm from '@/views/self-review/evaluation-form'
import {
  buildDraftPayloadDimensions,
  buildDimensionSubmitPayload,
  toDimensionEvaluationAnswers,
  type EvaluationAnswers,
  type EvaluationItemAnswer
} from '@/views/self-review/evaluation-form-types'

import PeerReferencePanel from './peer-reference-panel'

type PeerReviewFillProps = {
  assignmentId: number

  /** 组件实验台专用：传入固定上下文后不访问后端，便于验证真实页面组件的交互和视觉状态。 */
  previewContext?: PerfPeerEvaluationContext
}

const STATE_LABEL: Record<Exclude<PerfPeerEvaluationContext['state'], null>, string> = {
  DRAFT: '草稿',
  EFFECTIVE: '已生效',
  PENDING_RESUBMIT: '待重新提交'
}

/** Ticket 07：360°评审员只消费 PEER 快照子表单，并复用统一提交的草稿/生效双态。 */
const PeerReviewFill = ({ assignmentId, previewContext }: PeerReviewFillProps) => {
  const router = useRouter()

  const [context, setContext] = useState<PerfPeerEvaluationContext | null>(previewContext ?? null)

  const [answers, setAnswers] = useState<EvaluationAnswers>(() =>
    toDimensionEvaluationAnswers(previewContext?.draft?.dimensionAnswers ?? previewContext?.submitted?.dimensionAnswers ?? [])
  )

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState(previewContext?.state !== 'EFFECTIVE')
  const [loading, setLoading] = useState(!previewContext)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [referenceCollapsed, setReferenceCollapsed] = useState(false)

  const load = useCallback(async () => {
    if (!assignmentId) {
      setError('缺少 assignment_id 参数')
      setLoading(false)

      return
    }

    setLoading(true)
    setError(null)

    try {
      const data = await getPeerEvaluationContext(assignmentId)
      const currentDimensions = data.draft?.dimensionAnswers ?? data.submitted?.dimensionAnswers ?? []

      setContext(data)
      setAnswers(toDimensionEvaluationAnswers(currentDimensions))

      // 首次草稿或已有更新草稿直接进入编辑；仅“只有生效提交”先只读展示。
      setEditing(data.state !== 'EFFECTIVE')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法加载 360°评估任务')
    } finally {
      setLoading(false)
    }
  }, [assignmentId])

  useEffect(() => {
    if (previewContext) return
    const initialLoad = setTimeout(() => void load(), 0)

    return () => clearTimeout(initialLoad)
  }, [load, previewContext])

  const updateAnswer = (itemKey: string, answer: EvaluationItemAnswer) => {
    setAnswers(previous => ({ ...previous, [itemKey]: answer }))
    setErrors(previous => {
      if (!previous[itemKey]) return previous
      const next = { ...previous }

      delete next[itemKey]

      return next
    })
  }

  const saveDraft = async (silent = false) => {
    if (!context?.form) return false
    setSaving(true)

    try {
      if (previewContext) {
        setContext(previous => (previous ? { ...previous, state: 'PENDING_RESUBMIT' } : previous))
        toast.success('预览：360°评估草稿已保存')

        return true
      }

      await savePeerEvaluationDraft({
        assignmentId,
        dimensions: buildDraftPayloadDimensions(context.form.subforms, answers)
      })
      setContext(previous => (previous?.submitted ? { ...previous, state: 'PENDING_RESUBMIT' } : previous))
      if (!silent) toast.success('360°评估草稿已保存')

      return true
    } catch (caught) {
      if (!silent) toast.error(caught instanceof ApiError ? caught.message : '保存草稿失败')

      return false
    } finally {
      setSaving(false)
    }
  }

  const submit = async () => {
    if (!context?.form) return
    const result = buildDimensionSubmitPayload(context.form.subforms, answers, ratings)

    setErrors(result.errors)

    if (Object.keys(result.errors).length > 0) {
      toast.error('请先完成所有必填评估维度与表单字段')

      return
    }

    setSaving(true)

    try {
      if (previewContext) {
        setContext(previous => (previous ? { ...previous, state: 'EFFECTIVE' } : previous))
        setEditing(false)
        toast.success('预览：360°评估已重新提交并生效')

        return
      }

      await submitPeerEvaluation({ assignmentId, dimensions: result.dimensions })
      toast.success(context.submitted ? '360°评估已重新提交并生效' : '360°评估已提交')
      router.push('/review-tasks')
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : '提交评估失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className='text-muted-foreground flex items-center justify-center gap-2 py-24'>
        <Loader2Icon className='size-4 animate-spin' />
        正在加载 360°评估表单…
      </div>
    )
  }

  if (error || !context) {
    return (
      <div className='text-destructive flex flex-col items-center gap-3 py-24 text-sm'>
        {error ?? '加载失败'}
        <Button variant='outline' size='sm' onClick={() => void load()}>
          重试
        </Button>
      </div>
    )
  }

  const state = context.state
  const ratings = context.cycle?.currentConfigVersion?.ratings ?? []

  return (
    <div className='flex h-full min-h-0 flex-col gap-3 overflow-hidden'>
      <div className='shrink-0 space-y-3'>
        <PageHeader
          title='360°评估'
          description={`${context.cycle?.name ?? ''} · 被评估人：${context.employee?.name ?? '-'}`}
          backHref='/review-tasks'
          backLabel='评审任务'
          actions={state ? <Badge variant='outline'>{STATE_LABEL[state]}</Badge> : undefined}
        />

        {!context.form ? null : state === 'PENDING_RESUBMIT' ? (
          <Alert>
            <AlertTitle>待重新提交</AlertTitle>
            <AlertDescription>
              当前更新仍是草稿，计算继续使用上一次已生效提交；重新提交后才会替换。
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      {!context.form ? (
        <>
          {context.participant && <ParticipantOkrWarmup participantId={context.participant.id} />}
          <Card>
            <CardHeader>
              <CardTitle>任务尚未开放</CardTitle>
              <CardDescription>到达任务开始时间后才能查看、保存或提交评估表单。</CardDescription>
            </CardHeader>
          </Card>
        </>
      ) : (
        <>
          <EvaluationSplitLayout
            collapsed={referenceCollapsed}
            onCollapsedChange={setReferenceCollapsed}
            left={
              <PeerReferencePanel
                participantId={context.participant?.id ?? 0}
                okrPreviewData={
                  previewContext
                    ? {
                        participantId: context.participant?.id ?? 0,
                        employeeOpenId: context.employee?.open_id ?? '',
                        lastSyncedAt: null,
                        sync: { status: 'success' },
                        cycles: []
                      }
                    : undefined
                }
                employee={context.employee}
                relation={context.assignment?.relation}
                selfItems={[]}
                selfDimensionAnswers={context.selfEvaluation?.dimensionAnswers ?? []}
                collapsed={referenceCollapsed}
                onCollapsedChange={setReferenceCollapsed}
              />
            }
            right={
              <EvaluationForm
                subforms={context.form.subforms}
                answers={answers}
                onAnswerChange={updateAnswer}
                errors={errors}
                disabled={!editing || saving}
                ratings={ratings}
              />
            }
          />

          <div className='flex shrink-0 items-center justify-between gap-4 py-1'>
            <span className='text-muted-foreground text-sm'>
              左侧对照员工自评与 OKR，右侧填写可观察行为评估后提交
            </span>
            <div className='flex items-center gap-3'>
              {!editing ? (
                <Button onClick={() => setEditing(true)}>
                  <Edit3Icon />
                  编辑并重新提交
                </Button>
              ) : (
                <>
                  <Button variant='outline' disabled={saving} onClick={() => void saveDraft()}>
                    <SaveIcon />
                    保存草稿
                  </Button>
                  <Button disabled={saving} onClick={() => void submit()}>
                    {saving ? <Loader2Icon className='size-4 animate-spin' /> : <SendIcon />}
                    {context.submitted ? '重新提交' : '提交评估'}
                  </Button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default PeerReviewFill
