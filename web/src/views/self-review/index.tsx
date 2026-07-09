'use client'

// React Imports
import { useCallback, useEffect, useRef, useState } from 'react'

// Third-party Imports
import { AlertCircleIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

// Component Imports
import PageHeader from '@/components/shared/PageHeader'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

// Util Imports
import { apiFetch } from '@/lib/api'
import type {
  PerfCycleStatus,
  PerfDimension,
  PerfParticipantStatus,
  PerfEvaluationRule,
  PerfSelfReviewStatus
} from '@/lib/perf-api'
import { CYCLE_STATUS_BADGE, CYCLE_STATUS_LABEL, PARTICIPANT_STATUS_LABEL, formatDateTime } from '@/lib/perf-api'

// ===== 后端数据类型（GET /self-reviews/current） =====

/** 工作总结分节内容 */
type SelfReviewSummary = {
  outputs: string
  results: string
  collaboration: string
  reflection: string
  plan: string
}

/** 自评详情 */
type SelfReviewDetail = {
  okrContent: { text: string } | null
  summary: SelfReviewSummary | null
  promotionSelfReview: { text: string } | null
  status: PerfSelfReviewStatus
  returnReason?: string | null
  submittedAt?: string | null
}

/** 当前周期自评上下文 */
type CurrentSelfReview = {
  participant: {
    id: number
    cycleId: number
    status: PerfParticipantStatus
    isPromotionEnabled: boolean
    cycle: { id: number; name: string; status: PerfCycleStatus }
  } | null
  selfReview: SelfReviewDetail | null
  dimensions: PerfDimension[]
  evaluationRule: PerfEvaluationRule | null
}

/** 表单本地状态（各分节均为纯文本） */
type SelfReviewForm = {
  okrText: string
  summary: SelfReviewSummary
  promotionText: string
}

const EMPTY_SUMMARY: SelfReviewSummary = { outputs: '', results: '', collaboration: '', reflection: '', plan: '' }

// 工作总结分节配置：字段 → 标签/占位提示
const SUMMARY_SECTIONS: { key: keyof SelfReviewSummary; label: string; placeholder: string; rows: number }[] = [
  { key: 'outputs', label: '重点工作产出', placeholder: '列出本周期最重要的工作产出…', rows: 4 },
  { key: 'results', label: '业务结果', placeholder: '说明工作带来的业务结果与数据表现…', rows: 4 },
  { key: 'collaboration', label: '协作贡献', placeholder: '说明跨团队协作、帮助他人等贡献…', rows: 3 },
  { key: 'reflection', label: '复盘不足', placeholder: '反思执行中的不足与原因…', rows: 3 },
  { key: 'plan', label: '下期计划', placeholder: '给出下阶段的重点计划与改进措施…', rows: 3 }
]

// 后端返回 → 表单初始值
const toForm = (selfReview: SelfReviewDetail | null): SelfReviewForm => ({
  okrText: selfReview?.okrContent?.text ?? '',
  summary: { ...EMPTY_SUMMARY, ...(selfReview?.summary ?? {}) },
  promotionText: selfReview?.promotionSelfReview?.text ?? ''
})

/**
 * 员工自评（真实后端 /self-reviews/current）：
 * OKR 区 + 工作总结分节 + 晋升自述（按参评配置显示）+ 保存草稿（含 2 秒停顿自动保存）/提交底栏。
 * participant.status 为 PENDING_SELF_REVIEW / RETURNED 时可编辑，其余状态只读。
 */
const SelfReview = () => {
  // 当前自评上下文
  const [data, setData] = useState<CurrentSelfReview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 表单内容与操作中状态
  const [form, setForm] = useState<SelfReviewForm>(toForm(null))
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // 自动保存定时器（输入停止 2 秒后触发；组件卸载时清理）
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const participant = data?.participant ?? null
  const selfReview = data?.selfReview ?? null

  // 可编辑：待自评或被退回；其余状态（已提交等）只读
  const editable = participant?.status === 'PENDING_SELF_REVIEW' || participant?.status === 'RETURNED'

  // 拉取当前周期自评
  const fetchCurrent = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const result = await apiFetch<CurrentSelfReview>('/self-reviews/current')

      setData(result)
      setForm(toForm(result.selfReview))
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法加载自评数据，请确认后端服务已启动。')
    } finally {
      setLoading(false)
    }
  }, [])

  // 首次加载（放入宏任务，避免在 effect 中同步 setState）；卸载时清理自动保存定时器
  useEffect(() => {
    const initialLoad = setTimeout(() => void fetchCurrent(), 0)

    return () => {
      clearTimeout(initialLoad)
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  }, [fetchCurrent])

  // 保存草稿：silent 为自动保存（失败静默），手动保存则 toast 反馈
  const saveDraft = useCallback(
    async (draft: SelfReviewForm, silent: boolean) => {
      if (!participant) return

      if (!silent) setSaving(true)

      try {
        await apiFetch('/self-reviews/current', {
          method: 'PUT',
          body: JSON.stringify({
            cycleId: participant.cycleId,
            summary: draft.summary,
            okrContent: { text: draft.okrText },
            promotionSelfReview: participant.isPromotionEnabled ? { text: draft.promotionText } : null
          })
        })

        if (!silent) toast.success('草稿已保存')
      } catch (err) {
        // 自动保存失败静默处理，避免打断输入
        if (!silent) toast.error(err instanceof Error ? err.message : '保存草稿失败，请稍后重试')
      } finally {
        if (!silent) setSaving(false)
      }
    },
    [participant]
  )

  // 表单变更：更新本地状态并重排 2 秒自动保存
  const handleChange = (updater: (prev: SelfReviewForm) => SelfReviewForm) => {
    setForm(prev => {
      const next = updater(prev)

      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = setTimeout(() => void saveDraft(next, true), 2000)

      return next
    })
  }

  // 提交自评：先取消待触发的自动保存，提交成功后刷新为只读态
  const handleSubmit = async () => {
    if (!participant) return

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    setSubmitting(true)

    try {
      // 提交前先落一次草稿，确保后端拿到最新内容
      await saveDraft(form, true)
      await apiFetch('/self-reviews/current/submit', {
        method: 'POST',
        body: JSON.stringify({ cycleId: participant.cycleId })
      })
      toast.success('自评已提交')
      await fetchCurrent()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  // ===== 三态：加载 / 错误 / 无进行中周期 =====

  if (loading) {
    return (
      <div className='flex flex-col gap-6'>
        <PageHeader title='员工自评' description='正在加载当前周期自评…' />
        <Skeleton className='h-48 w-full' />
        <Skeleton className='h-72 w-full' />
      </div>
    )
  }

  if (error) {
    return (
      <div className='flex flex-col gap-6'>
        <PageHeader title='员工自评' description='当前周期的自评填写' />
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

  if (!participant) {
    return (
      <div className='flex flex-col gap-6'>
        <PageHeader title='员工自评' description='当前周期的自评填写' />
        <Card>
          <CardContent className='text-muted-foreground flex flex-col items-center gap-2 py-16 text-sm'>
            <span>当前没有进行中的考核周期</span>
            <span>周期启动并进入自评阶段后，可在此填写自评</span>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-6 pb-20'>
      <PageHeader
        title='员工自评'
        description={`${participant.cycle.name} · 我的状态：${PARTICIPANT_STATUS_LABEL[participant.status] ?? participant.status}`}
        actions={
          <div className='flex items-center gap-2'>
            <Badge className={CYCLE_STATUS_BADGE[participant.cycle.status]}>
              {CYCLE_STATUS_LABEL[participant.cycle.status] ?? participant.cycle.status}
            </Badge>
            {/* 只读态显示「已提交」徽标与提交时间 */}
            {!editable && (
              <Badge className='bg-green-500/10 text-green-600 dark:text-green-400'>
                已提交{selfReview?.submittedAt ? ` · ${formatDateTime(selfReview.submittedAt)}` : ''}
              </Badge>
            )}
          </div>
        }
      />

      {/* 被退回：醒目展示退回原因 */}
      {participant.status === 'RETURNED' && (
        <Alert variant='destructive'>
          <AlertCircleIcon />
          <AlertTitle>自评被退回，请修改后重新提交</AlertTitle>
          <AlertDescription>退回原因：{selfReview?.returnReason || '未填写退回原因'}</AlertDescription>
        </Alert>
      )}

      {/* OKR 区 */}
      <Card>
        <CardHeader>
          <CardTitle>OKR 达成情况</CardTitle>
          <CardDescription>对本周期各 OKR 的完成情况进行自评</CardDescription>
        </CardHeader>
        <CardContent>
          <Field className='gap-2'>
            <FieldLabel htmlFor='okr-content'>OKR 完成情况说明</FieldLabel>
            <Textarea
              id='okr-content'
              placeholder='逐条说明本周期 OKR 的达成情况、亮点与不足…'
              rows={6}
              value={form.okrText}
              disabled={!editable}
              onChange={event => handleChange(prev => ({ ...prev, okrText: event.target.value }))}
            />
          </Field>
        </CardContent>
      </Card>

      {/* 工作总结区：分节填写 */}
      <Card>
        <CardHeader>
          <CardTitle>工作总结</CardTitle>
          <CardDescription>本周期的整体工作回顾与下阶段计划</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className='gap-4'>
            {SUMMARY_SECTIONS.map(section => (
              <Field key={section.key} className='gap-2'>
                <FieldLabel htmlFor={`summary-${section.key}`}>{section.label}</FieldLabel>
                <Textarea
                  id={`summary-${section.key}`}
                  placeholder={section.placeholder}
                  rows={section.rows}
                  value={form.summary[section.key]}
                  disabled={!editable}
                  onChange={event =>
                    handleChange(prev => ({
                      ...prev,
                      summary: { ...prev.summary, [section.key]: event.target.value }
                    }))
                  }
                />
              </Field>
            ))}
          </FieldGroup>
        </CardContent>
      </Card>

      {/* 晋升自述区：仅参评配置开启晋升评估时显示 */}
      {participant.isPromotionEnabled && (
        <Card>
          <CardHeader>
            <CardTitle>晋升自述</CardTitle>
            <CardDescription>本周期已开启晋升评估，请填写晋升自述材料</CardDescription>
          </CardHeader>
          <CardContent>
            <Field className='gap-2'>
              <FieldLabel htmlFor='promotion-self-review'>晋升自述材料</FieldLabel>
              <Textarea
                id='promotion-self-review'
                placeholder='围绕目标职级要求，说明能力达标的依据与代表性工作…'
                rows={5}
                value={form.promotionText}
                disabled={!editable}
                onChange={event => handleChange(prev => ({ ...prev, promotionText: event.target.value }))}
              />
            </Field>
          </CardContent>
        </Card>
      )}

      {/* 底部操作栏：保存草稿 / 提交（仅可编辑时显示操作按钮） */}
      <div className='bg-card fixed inset-x-0 bottom-0 z-40 border-t px-4 py-3 sm:px-6'>
        <div className='mx-auto flex max-w-360 items-center justify-between gap-4'>
          <span className='text-muted-foreground text-sm'>
            {editable ? '输入停止 2 秒自动保存草稿；提交后将进入 360° 评估环节' : '自评已提交，内容为只读状态'}
          </span>
          {editable && (
            <div className='flex items-center gap-3'>
              <Button variant='outline' disabled={saving || submitting} onClick={() => void saveDraft(form, false)}>
                {saving && <Loader2Icon className='size-4 animate-spin' />}
                保存草稿
              </Button>
              <Button disabled={saving || submitting} onClick={() => void handleSubmit()}>
                {submitting && <Loader2Icon className='size-4 animate-spin' />}
                提交自评
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SelfReview
