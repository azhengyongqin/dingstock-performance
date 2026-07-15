'use client'

import { useCallback, useEffect, useState } from 'react'

import { useRouter } from 'next/navigation'
import { Edit3Icon, Loader2Icon, SaveIcon, SendIcon } from 'lucide-react'
import { toast } from 'sonner'

import PageHeader from '@/components/shared/PageHeader'
import { UserAvatar } from '@/components/shared/lark'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ApiError } from '@/lib/api'
import {
  avatarUrlOf,
  getManagerEvaluationContext,
  saveManagerEvaluationDraft,
  submitManagerEvaluation,
  type PerfEvaluationItemResult,
  type PerfManagerEvaluationContext,
  type PerfManagerStageResult
} from '@/lib/perf-api'
import EvaluationForm from '@/views/self-review/evaluation-form'
import {
  buildDraftPayloadItems,
  buildSubmitPayload,
  toEvaluationAnswers,
  type EvaluationAnswers,
  type EvaluationItemAnswer
} from '@/views/self-review/evaluation-form-types'

type ManagerReviewFillProps = {
  participantId: number

  /** 组件实验台可注入固定上下文，避免访问真实接口。 */
  previewContext?: PerfManagerEvaluationContext
}

const STATE_LABEL: Record<Exclude<PerfManagerEvaluationContext['state'], null>, string> = {
  DRAFT: '草稿',
  EFFECTIVE: '已生效',
  PENDING_RESUBMIT: '待重新提交'
}

const resultValue = (item: PerfEvaluationItemResult) => {
  if (item.rawLevel) return item.rawLevel
  if (item.rawScore != null) return String(item.rawScore)
  if (typeof item.value === 'string') return item.value
  if (Array.isArray(item.value)) return item.value.map(String).join('、')
  if (item.value != null) return JSON.stringify(item.value)

  return '—'
}

/** Ticket 09：Leader 动态上级评估流程，初始/阶段等级完全由后端计算。 */
const ManagerReviewFill = ({ participantId, previewContext }: ManagerReviewFillProps) => {
  const router = useRouter()
  const [context, setContext] = useState<PerfManagerEvaluationContext | null>(previewContext ?? null)

  const [answers, setAnswers] = useState<EvaluationAnswers>(() =>
    toEvaluationAnswers(previewContext?.draft?.items ?? previewContext?.submitted?.items ?? [])
  )

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState(previewContext?.state !== 'EFFECTIVE')
  const [loading, setLoading] = useState(!previewContext)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [calculatedResult, setCalculatedResult] = useState<PerfManagerStageResult | null>(
    previewContext?.managerResult ?? null
  )

  const load = useCallback(async () => {
    if (!participantId) {
      setError('缺少 participant_id 参数')
      setLoading(false)

      return
    }

    setLoading(true)
    setError(null)

    try {
      const data = await getManagerEvaluationContext(participantId)

      setContext(data)
      setAnswers(toEvaluationAnswers(data.draft?.items ?? data.submitted?.items ?? []))
      setEditing(data.state !== 'EFFECTIVE')
      setCalculatedResult(data.managerResult)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法加载上级评估任务')
    } finally {
      setLoading(false)
    }
  }, [participantId])

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

  const saveDraft = async () => {
    if (!context?.form) return
    setSaving(true)

    try {
      if (!previewContext) {
        await saveManagerEvaluationDraft({
          participantId,
          items: buildDraftPayloadItems(context.form.subforms, answers)
        })
      }

      setContext(previous =>
        previous ? { ...previous, state: previous.submitted ? 'PENDING_RESUBMIT' : 'DRAFT' } : previous
      )
      toast.success('上级评估草稿已保存')
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : '保存草稿失败')
    } finally {
      setSaving(false)
    }
  }

  const submit = async () => {
    if (!context?.form) return
    const payload = buildSubmitPayload(context.form.subforms, answers)

    setErrors(payload.errors)

    if (Object.keys(payload.errors).length > 0) {
      toast.error('请先完成所有必填评估项')

      return
    }

    setSaving(true)

    try {
      const response = previewContext
        ? { ok: true as const, result: context.managerResult as PerfManagerStageResult }
        : await submitManagerEvaluation({ participantId, items: payload.items })

      setCalculatedResult(response.result)
      toast.success(context.submitted ? '上级评估已重新提交并生效' : '上级评估已提交并完成系统计算')
      router.push('/review-tasks')
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : '提交上级评估失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className='text-muted-foreground flex items-center justify-center gap-2 py-24'>
        <Loader2Icon className='size-4 animate-spin' />
        正在加载上级评估表单…
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
  const ratings = context.cycle.currentConfigVersion?.ratings ?? []

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='上级评估'
        description={`${context.cycle.name} · 被评估人：${context.employee?.name ?? '-'}`}
        backHref='/review-tasks'
        backLabel='评审任务'
        actions={state ? <Badge variant='outline'>{STATE_LABEL[state]}</Badge> : undefined}
      />

      {!context.form ? (
        <Card>
          <CardHeader>
            <CardTitle>任务尚未开放</CardTitle>
            <CardDescription>到达任务开始时间后才能查看参考信息和填写表单。</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className='grid gap-6 lg:grid-cols-[minmax(300px,2fr)_3fr]'>
          <div className='flex flex-col gap-4'>
            <Card>
              <CardContent className='flex items-center gap-3'>
                <UserAvatar
                  openId={context.employee?.open_id}
                  name={context.employee?.name}
                  avatarUrl={avatarUrlOf(context.employee)}
                  size='lg'
                />
                <div className='flex flex-col'>
                  <span className='font-semibold'>{context.employee?.name ?? '-'}</span>
                  <span className='text-muted-foreground text-sm'>{context.employee?.job_title ?? ''}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>员工自评参考</CardTitle>
                <CardDescription>员工材料仅供参考，不参与上级阶段二次加权。</CardDescription>
              </CardHeader>
              <CardContent className='flex flex-col gap-2 text-sm'>
                {context.selfEvaluation?.items.length ? (
                  context.selfEvaluation.items.map(item => (
                    <div key={item.id} className='rounded-md border p-2 whitespace-pre-wrap'>
                      {resultValue(item)}
                    </div>
                  ))
                ) : (
                  <span className='text-muted-foreground'>员工尚无生效自评</span>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>360°阶段参考</CardTitle>
                <CardDescription>仅展示汇总结果，不把 360°等级再次合入权威等级。</CardDescription>
              </CardHeader>
              <CardContent className='flex flex-col gap-2 text-sm'>
                {context.peerResult?.status === 'READY' ? (
                  <>
                    <div className='flex flex-wrap gap-2'>
                      <Badge variant='outline'>综合分 {context.peerResult.compositeScore}</Badge>
                      <Badge variant='outline'>阶段等级 {context.peerResult.stageLevel}</Badge>
                      <Badge variant='outline'>{context.peerResult.reviewerCount} 人有效</Badge>
                    </div>
                    {context.peerResult.dimensions.map(dimension => (
                      <div key={dimension.id} className='flex justify-between'>
                        <span>{dimension.name}</span>
                        <span className='text-muted-foreground'>
                          {dimension.score} · {dimension.level}
                        </span>
                      </div>
                    ))}
                  </>
                ) : (
                  <span className='text-muted-foreground'>暂无有效 360°结果</span>
                )}
              </CardContent>
            </Card>

            {calculatedResult?.status === 'READY' && (
              <Card>
                <CardHeader>
                  <CardTitle>系统计算结果</CardTitle>
                  <CardDescription>MANAGER 阶段等级是首次校准前的权威等级。</CardDescription>
                </CardHeader>
                <CardContent className='flex flex-wrap gap-2'>
                  <Badge variant='outline'>综合分 {calculatedResult.compositeScore}</Badge>
                  <Badge variant='outline'>初始等级 {calculatedResult.initialLevel}</Badge>
                  <Badge>阶段等级 {calculatedResult.stageLevel}</Badge>
                </CardContent>
              </Card>
            )}
          </div>

          <div className='flex flex-col gap-4'>
            {state === 'PENDING_RESUBMIT' && (
              <Card className='border-amber-500/40 bg-amber-500/5'>
                <CardContent className='text-sm'>
                  当前修改仍是草稿，权威等级继续使用上一次生效提交；重新提交后才会替换并重算。
                </CardContent>
              </Card>
            )}
            <EvaluationForm
              subforms={context.form.subforms}
              answers={answers}
              onAnswerChange={updateAnswer}
              errors={errors}
              disabled={!editing || saving}
              ratings={ratings}
            />
            <div className='flex justify-end gap-2'>
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
                    {context.submitted ? '重新提交上级评估' : '提交上级评估'}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ManagerReviewFill
