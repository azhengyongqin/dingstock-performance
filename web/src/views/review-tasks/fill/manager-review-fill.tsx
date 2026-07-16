'use client'

import { useCallback, useEffect, useState } from 'react'

import { useRouter } from 'next/navigation'
import { Edit3Icon, Loader2Icon, SaveIcon, SendIcon } from 'lucide-react'
import { toast } from 'sonner'

import PageHeader from '@/components/shared/PageHeader'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { ApiError } from '@/lib/api'
import {
  getManagerEvaluationContext,
  saveManagerEvaluationDraft,
  submitManagerEvaluation,
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

import ManagerReferencePanel from './manager-reference-panel'

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
  const [referenceCollapsed, setReferenceCollapsed] = useState(false)

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
    <div className='flex flex-col gap-6 pb-20'>
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
        <>
          {state === 'PENDING_RESUBMIT' && (
            <Alert>
              <AlertTitle>待重新提交</AlertTitle>
              <AlertDescription>
                当前修改仍是草稿，权威等级继续使用上一次生效提交；重新提交后才会替换并重算。
              </AlertDescription>
            </Alert>
          )}

          {/* 单 Card：左参考区 | 分割线 | 右表单（与员工自评同构） */}
          <Card className='gap-0 overflow-hidden py-0'>
            <div
              className={cn(
                'flex items-stretch',
                referenceCollapsed ? 'flex-row' : 'flex-col lg:flex-row'
              )}
            >
              <aside
                className={cn(
                  'shrink-0',
                  referenceCollapsed ? 'w-12' : 'w-full min-w-0 lg:w-[38%] lg:min-w-[280px] lg:max-w-md'
                )}
              >
                <ManagerReferencePanel
                  employee={context.employee}
                  selfItems={context.selfEvaluation?.items ?? []}
                  peerResult={context.peerResult}
                  managerResult={calculatedResult}
                  history={context.history}
                  collapsed={referenceCollapsed}
                  onCollapsedChange={setReferenceCollapsed}
                />
              </aside>

              {!referenceCollapsed && <Separator className='lg:hidden' />}
              <Separator orientation='vertical' className='hidden lg:block' />

              <section className='min-w-0 flex-1 px-5 py-5 sm:px-6 sm:py-6'>
                <EvaluationForm
                  subforms={context.form.subforms}
                  answers={answers}
                  onAnswerChange={updateAnswer}
                  errors={errors}
                  disabled={!editing || saving}
                  ratings={ratings}
                />
              </section>
            </div>
          </Card>

          <div className='bg-card fixed inset-x-0 bottom-0 z-40 border-t px-4 py-3 sm:px-6'>
            <div className='mx-auto flex max-w-360 items-center justify-between gap-4'>
              <span className='text-muted-foreground text-sm'>
                左侧参考员工自评与 360°汇总，右侧填写上级评估后提交生效
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
                      {context.submitted ? '重新提交上级评估' : '提交上级评估'}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default ManagerReviewFill
