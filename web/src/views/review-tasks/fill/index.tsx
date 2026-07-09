'use client'

// React Imports
import { useCallback, useEffect, useMemo, useState } from 'react'

// Next Imports
import { useRouter, useSearchParams } from 'next/navigation'

// Third-party Imports
import { Loader2Icon, SaveIcon, SendIcon } from 'lucide-react'
import { toast } from 'sonner'

// Component Imports
import { UserAvatar } from '@/components/shared/lark'
import PageHeader from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'

// Util Imports
import { ApiError, apiFetch } from '@/lib/api'
import type {
  DimensionScore,
  LarkUserBrief,
  PerfDimension,
  PerfScoringRule,
  PerfSelfReviewStatus
} from '@/lib/perf-api'
import { avatarUrlOf, formatDateTime } from '@/lib/perf-api'

// ===== 类型（GET /review-tasks/context 响应） =====

type ReviewContext = {
  participant: { id: number; cycleId: number; isPromotionEnabled: boolean; status: string }
  cycle: { id: number; name: string; status: string }
  employee: LarkUserBrief | null
  selfReview: {
    okrContent?: { text?: string } | null
    summary?: Record<string, string> | null
    promotionSelfReview?: { text?: string } | null
    status: PerfSelfReviewStatus
    submittedAt?: string | null
  } | null
  dimensions: PerfDimension[]
  scoringRule: PerfScoringRule | null
  myDraft: {
    dimensionScores?: DimensionScore[] | null
    comments?: string | null
    promotionFeedback?: { text?: string } | null
    overallComment?: string | null
    initialLevel?: string | null
    promotionConclusion?: string | null
    status: 'DRAFT' | 'SUBMITTED'
    submittedAt?: string | null
  } | null
  peerReviews: {
    reviewerOpenId: string
    reviewer: LarkUserBrief | null
    dimensionScores?: DimensionScore[] | null
    comments?: string | null
    submittedAt?: string | null
  }[]
  history: { finalLevel: string; participant: { cycle: { id: number; name: string } } }[]
}

const SUMMARY_SECTIONS: { key: string; label: string }[] = [
  { key: 'outputs', label: '重点工作产出' },
  { key: 'results', label: '业务结果' },
  { key: 'collaboration', label: '协作贡献' },
  { key: 'reflection', label: '复盘不足' },
  { key: 'plan', label: '下期计划' }
]

/**
 * 评估填写页（UI/UX 文档 §6.8/§6.9 左右分栏）：
 * 左侧参考信息（被评人/自评/上级评估额外含 360° 汇总与历史绩效），右侧按维度动态表单。
 * type=REVIEW → 360° 评估；type=MANAGER_REVIEW → 上级评估。
 */
const ReviewFill = () => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const participantId = Number(searchParams.get('participant_id'))
  const taskType = searchParams.get('type') === 'MANAGER_REVIEW' ? 'MANAGER_REVIEW' : 'REVIEW'
  const isManager = taskType === 'MANAGER_REVIEW'

  const [context, setContext] = useState<ReviewContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // 表单态
  const [scores, setScores] = useState<Record<number, DimensionScore>>({})
  const [comments, setComments] = useState('')
  const [promotionFeedback, setPromotionFeedback] = useState('')
  const [initialLevel, setInitialLevel] = useState('')
  const [promotionConclusion, setPromotionConclusion] = useState('')

  const submitted = context?.myDraft?.status === 'SUBMITTED'

  const fetchContext = useCallback(async () => {
    if (!participantId) {
      setError('缺少 participant_id 参数')
      setLoading(false)

      return
    }

    setLoading(true)
    setError(null)

    try {
      const data = await apiFetch<ReviewContext>(
        `/review-tasks/context?participant_id=${participantId}&type=${taskType}`
      )

      setContext(data)

      // 用我的草稿回填表单
      const draft = data.myDraft
      const scoreMap: Record<number, DimensionScore> = {}

      for (const item of draft?.dimensionScores ?? []) {
        if (item.dimensionId != null) scoreMap[item.dimensionId] = item
      }

      setScores(scoreMap)
      setComments(draft?.comments ?? '')
      setPromotionFeedback(draft?.promotionFeedback?.text ?? '')
      setInitialLevel(draft?.initialLevel ?? '')
      setPromotionConclusion(draft?.promotionConclusion ?? '')
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法加载评估上下文')
    } finally {
      setLoading(false)
    }
  }, [participantId, taskType])

  useEffect(() => {
    // 延迟到宏任务，避免在 effect 内同步 setState 触发级联渲染
    const initialLoad = setTimeout(() => void fetchContext(), 0)

    return () => clearTimeout(initialLoad)
  }, [fetchContext])

  const levels = useMemo(() => context?.scoringRule?.levels ?? [], [context])

  // 等级下拉选项（含说明后缀）
  const levelOptions = useMemo(
    () =>
      levels.map(item => ({
        value: item.level,
        label: `${item.level}${item.description ? ` · ${item.description}` : ''}`
      })),
    [levels]
  )

  const promotionDimension = useMemo(
    () => context?.dimensions.find(dim => dim.type === 'PROMOTION'),
    [context]
  )

  const updateScore = (dimensionId: number, patch: Partial<DimensionScore>) => {
    setScores(prev => ({ ...prev, [dimensionId]: { ...prev[dimensionId], dimensionId, ...patch } }))
  }

  // ---- 保存 / 提交 ----

  const buildDimensionScores = () => Object.values(scores)

  const saveDraft = async (silent = false) => {
    if (!context) return false
    setSaving(true)

    try {
      if (isManager) {
        await apiFetch('/manager-reviews/draft', {
          method: 'PUT',
          body: JSON.stringify({
            participantId,
            dimensionScores: buildDimensionScores(),
            overallComment: comments || undefined,
            initialLevel: initialLevel || undefined,
            promotionConclusion: promotionConclusion || undefined
          })
        })
      } else {
        await apiFetch('/reviews/draft', {
          method: 'PUT',
          body: JSON.stringify({
            participantId,
            dimensionScores: buildDimensionScores(),
            comments: comments || undefined,
            promotionFeedback: promotionFeedback ? { text: promotionFeedback } : undefined
          })
        })
      }

      if (!silent) toast.success('草稿已保存')

      return true
    } catch (err) {
      if (!silent) toast.error(err instanceof ApiError ? err.message : '保存失败')

      return false
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = async () => {
    // 必填校验：必填维度必须有值
    const missing = (context?.dimensions ?? []).filter(dim => {
      if (!dim.required || dim.type === 'PROMOTION') return false
      const score = scores[dim.id]

      return !score || (score.level == null && score.score == null && !score.conclusion && !score.text)
    })

    if (missing.length > 0) {
      toast.error(`以下必填维度尚未填写：${missing.map(dim => dim.name).join('、')}`)

      return
    }

    if (isManager && !initialLevel) {
      toast.error('提交前必须给出初步绩效等级')

      return
    }

    if (!(await saveDraft(true))) return
    setSaving(true)

    try {
      await apiFetch(isManager ? '/manager-reviews/submit' : '/reviews/submit', {
        method: 'POST',
        body: JSON.stringify({ participantId })
      })
      toast.success('评估已提交')
      router.push('/review-tasks')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '提交失败')
    } finally {
      setSaving(false)
    }
  }

  // ---- 渲染 ----

  if (loading) {
    return (
      <div className='text-muted-foreground flex items-center justify-center gap-2 py-24'>
        <Loader2Icon className='size-4 animate-spin' />
        正在加载评估上下文…
      </div>
    )
  }

  if (error || !context) {
    return (
      <div className='text-destructive flex flex-col items-center gap-3 py-24 text-sm'>
        {error ?? '加载失败'}
        <Button variant='outline' size='sm' onClick={() => void fetchContext()}>
          重试
        </Button>
      </div>
    )
  }

  const { employee, selfReview, dimensions } = context

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title={isManager ? '上级评估' : '360° 评估'}
        description={`${context.cycle.name} · 被评估人：${employee?.name ?? '-'}`}
        actions={submitted ? <Badge variant='outline'>已提交</Badge> : undefined}
      />

      <div className='grid gap-6 lg:grid-cols-[minmax(320px,2fr)_3fr]'>
        {/* 左侧：参考信息 */}
        <div className='flex flex-col gap-4'>
          {/* 被评人卡片 */}
          <Card>
            <CardContent className='flex items-center gap-3'>
              <UserAvatar
                openId={employee?.open_id}
                name={employee?.name}
                avatarUrl={avatarUrlOf(employee)}
                size='lg'
              />
              <div className='flex flex-col'>
                <span className='text-base font-semibold'>{employee?.name ?? '-'}</span>
                <span className='text-muted-foreground text-sm'>{employee?.job_title ?? ''}</span>
              </div>
            </CardContent>
          </Card>

          {/* 自评与工作总结 */}
          <Card>
            <CardHeader>
              <CardTitle>员工自评</CardTitle>
              <CardDescription>
                {selfReview ? `提交于 ${formatDateTime(selfReview.submittedAt)}` : '员工尚未提交自评'}
              </CardDescription>
            </CardHeader>
            {selfReview && (
              <CardContent className='flex flex-col gap-3 text-sm'>
                {selfReview.okrContent?.text && (
                  <div>
                    <div className='mb-1 font-medium'>OKR</div>
                    <p className='text-muted-foreground whitespace-pre-wrap'>{selfReview.okrContent.text}</p>
                  </div>
                )}
                {SUMMARY_SECTIONS.map(section =>
                  selfReview.summary?.[section.key] ? (
                    <div key={section.key}>
                      <div className='mb-1 font-medium'>{section.label}</div>
                      <p className='text-muted-foreground whitespace-pre-wrap'>{selfReview.summary[section.key]}</p>
                    </div>
                  ) : null
                )}
                {context.participant.isPromotionEnabled && selfReview.promotionSelfReview?.text && (
                  <div>
                    <div className='mb-1 font-medium'>晋升自述</div>
                    <p className='text-muted-foreground whitespace-pre-wrap'>
                      {selfReview.promotionSelfReview.text}
                    </p>
                  </div>
                )}
              </CardContent>
            )}
          </Card>

          {/* 上级评估专属：360° 汇总 + 历史绩效 */}
          {isManager && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>360° 评估汇总</CardTitle>
                  <CardDescription>已提交 {context.peerReviews.length} 份</CardDescription>
                </CardHeader>
                <CardContent className='flex flex-col gap-3 text-sm'>
                  {context.peerReviews.length === 0 ? (
                    <span className='text-muted-foreground'>暂无已提交的 360° 评估</span>
                  ) : (
                    context.peerReviews.map(review => (
                      <div key={review.reviewerOpenId} className='rounded-lg border p-3'>
                        <div className='mb-1.5 flex items-center gap-2'>
                          <UserAvatar
                            openId={review.reviewer?.open_id}
                            name={review.reviewer?.name}
                            avatarUrl={avatarUrlOf(review.reviewer)}
                            size='sm'
                          />
                          <span className='font-medium'>{review.reviewer?.name ?? '-'}</span>
                        </div>
                        <div className='text-muted-foreground flex flex-wrap gap-2'>
                          {(review.dimensionScores ?? []).map(score => {
                            const dim = dimensions.find(d => d.id === score.dimensionId)

                            return (
                              <Badge key={score.dimensionId} variant='outline'>
                                {dim?.name ?? `维度#${score.dimensionId}`}：
                                {score.level ?? score.score ?? score.conclusion ?? '—'}
                              </Badge>
                            )
                          })}
                        </div>
                        {review.comments && (
                          <p className='text-muted-foreground mt-1.5 whitespace-pre-wrap'>{review.comments}</p>
                        )}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>历史绩效</CardTitle>
                </CardHeader>
                <CardContent className='flex flex-col gap-2 text-sm'>
                  {context.history.length === 0 ? (
                    <span className='text-muted-foreground'>暂无归档的历史绩效</span>
                  ) : (
                    context.history.map((item, index) => (
                      <div key={index} className='flex items-center justify-between'>
                        <span className='text-muted-foreground'>{item.participant.cycle.name}</span>
                        <Badge variant='outline'>{item.finalLevel}</Badge>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* 右侧：评分表单 */}
        <Card className='h-fit'>
          <CardHeader>
            <CardTitle>{isManager ? '上级评估表单' : '评估表单'}</CardTitle>
            <CardDescription>
              {submitted ? '已提交，内容只读' : '各维度按配置的计分方式填写；草稿可随时保存'}
            </CardDescription>
          </CardHeader>
          <CardContent className='flex flex-col gap-5'>
            {dimensions.map(dim => {
              const score = scores[dim.id] ?? { dimensionId: dim.id }
              const isPromotion = dim.type === 'PROMOTION'

              return (
                <div key={dim.id} className='flex flex-col gap-2'>
                  <div className='flex items-center gap-2'>
                    <span className='font-medium'>{dim.name}</span>
                    {dim.weight != null && !isPromotion && (
                      <Badge variant='outline'>{Number(dim.weight)}%</Badge>
                    )}
                    {dim.required && !isPromotion && <span className='text-destructive text-xs'>*</span>}
                    {isPromotion && (
                      <Badge className='bg-purple-500/10 text-purple-600 dark:text-purple-400'>晋升评估</Badge>
                    )}
                  </div>

                  {/* 按计分方式渲染输入 */}
                  {dim.scoringMethod === 'LEVEL' ? (
                    <Select
                      value={score.level ?? null}
                      items={levelOptions}
                      disabled={submitted}
                      onValueChange={value => updateScore(dim.id, { level: (value as string | null) || undefined })}
                    >
                      <SelectTrigger className='w-full'>
                        <SelectValue placeholder='选择等级…' />
                      </SelectTrigger>
                      <SelectContent>
                        {levelOptions.map(option => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : dim.scoringMethod === 'SCORE' ? (
                    <Input
                      type='number'
                      placeholder='输入分数'
                      value={score.score ?? ''}
                      disabled={submitted}
                      onChange={event =>
                        updateScore(dim.id, {
                          score: event.target.value === '' ? undefined : Number(event.target.value)
                        })
                      }
                    />
                  ) : dim.scoringMethod === 'CONCLUSION' ? (
                    <Select
                      value={score.conclusion ?? null}
                      disabled={submitted}
                      onValueChange={value =>
                        updateScore(dim.id, { conclusion: (value as string | null) || undefined })
                      }
                    >
                      <SelectTrigger className='w-full'>
                        <SelectValue placeholder='选择结论…' />
                      </SelectTrigger>
                      <SelectContent>
                        {(dim.conclusionOptions ?? []).map(option => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Textarea
                      rows={3}
                      placeholder='填写文本反馈…'
                      value={score.text ?? ''}
                      disabled={submitted}
                      onChange={event => updateScore(dim.id, { text: event.target.value || undefined })}
                    />
                  )}

                  {/* 维度评语（文本类维度不重复展示） */}
                  {dim.scoringMethod !== 'TEXT' && (
                    <Textarea
                      rows={2}
                      placeholder='维度评语（选填；高/低分需说明事实依据）'
                      value={score.comment ?? ''}
                      disabled={submitted}
                      onChange={event => updateScore(dim.id, { comment: event.target.value || undefined })}
                    />
                  )}
                </div>
              )
            })}

            <Separator />

            {/* 综合评语 */}
            <Field className='gap-2'>
              <FieldLabel>{isManager ? '综合评语' : '整体评语'}</FieldLabel>
              <Textarea
                rows={4}
                placeholder='对被评估人本周期表现的整体评价…'
                value={comments}
                disabled={submitted}
                onChange={event => setComments(event.target.value)}
              />
            </Field>

            {/* 360°：晋升反馈；上级：初评等级 + 晋升结论 */}
            {!isManager && context.participant.isPromotionEnabled && (
              <Field className='gap-2'>
                <FieldLabel>晋升反馈</FieldLabel>
                <Textarea
                  rows={3}
                  placeholder='对被评估人晋升的观察与反馈…'
                  value={promotionFeedback}
                  disabled={submitted}
                  onChange={event => setPromotionFeedback(event.target.value)}
                />
              </Field>
            )}

            {isManager && (
              <div className='grid gap-4 sm:grid-cols-2'>
                <Field className='gap-2'>
                  <FieldLabel>
                    初步绩效等级<span className='text-destructive'>*</span>
                  </FieldLabel>
                  <Select
                    value={initialLevel || null}
                    items={levelOptions}
                    disabled={submitted}
                    onValueChange={value => setInitialLevel((value as string | null) ?? '')}
                  >
                    <SelectTrigger className='w-full'>
                      <SelectValue placeholder='选择等级…' />
                    </SelectTrigger>
                    <SelectContent>
                      {levelOptions.map(option => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {context.participant.isPromotionEnabled && (
                  <Field className='gap-2'>
                    <FieldLabel>晋升建议结论</FieldLabel>
                    <Select
                      value={promotionConclusion || null}
                      disabled={submitted}
                      onValueChange={value => setPromotionConclusion((value as string | null) ?? '')}
                    >
                      <SelectTrigger className='w-full'>
                        <SelectValue placeholder='选择结论…' />
                      </SelectTrigger>
                      <SelectContent>
                        {(promotionDimension?.conclusionOptions ?? ['建议晋升', '暂缓晋升', '不建议晋升']).map(
                          option => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </div>
            )}

            {/* 底部操作 */}
            {!submitted && (
              <div className='flex justify-end gap-2 border-t pt-4'>
                <Button variant='outline' disabled={saving} onClick={() => void saveDraft()}>
                  <SaveIcon />
                  保存草稿
                </Button>
                <Button disabled={saving} onClick={() => void handleSubmit()}>
                  {saving ? <Loader2Icon className='size-4 animate-spin' /> : <SendIcon />}
                  提交评估
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default ReviewFill
