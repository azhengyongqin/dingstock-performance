'use client'

// React Imports
import type { SetStateAction } from 'react'
import { useCallback, useEffect, useState } from 'react'

// Next Imports
import { useRouter } from 'next/navigation'

// Third-party Imports
import {
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  XCircleIcon
} from 'lucide-react'
import { toast } from 'sonner'

// Component Imports
import { DateRangePicker, DateTimeRangePicker } from '@/components/shared/DatePicker'
import {
  DEFAULT_COMMENT_REQUIRED_RULES,
  DEFAULT_EVALUATION_RATINGS,
  EvaluationRuleEditor,
  normalizeEvaluationRuleDraft,
  validateEvaluationRuleDraft
} from '@/components/shared/evaluation-rule-editor'
import { LarkMemberSelector, UserAvatar } from '@/components/shared/lark'
import PageHeader from '@/components/shared/PageHeader'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

// Util Imports
import { ApiError, apiFetch } from '@/lib/api'
import type {
  ListResponse,
  PerfCycle,
  PerfDimension,
  PerfParticipantItem,
  PerfRole,
  PerfTemplate,
  StartCheckItem
} from '@/lib/perf-api'
import { avatarUrlOf } from '@/lib/perf-api'
import { findDefaultUsableTemplateId, shouldConfirmTemplateOverwrite, toTemplateOptions } from './cycle-template-utils'

// ===== 分步表单配置 =====

const STEPS = [
  { key: 'basic', title: '基础信息', description: '周期名称、类型、时间与配置模板' },
  { key: 'members', title: '考核人员', description: '圈定参评部门与员工' },
  { key: 'dimensions', title: '评估维度', description: '维度、权重与填写角色（含晋升维度）' },
  { key: 'scoring', title: '评估规则', description: '评级定义、分数段与评语要求' },
  { key: 'windows', title: '时间窗口', description: '各阶段起止时间' },
  { key: 'preflight', title: '启动前检查', description: '配置完整性校验与启动' }
] as const

const WINDOW_STAGES = [
  { key: 'selfReview', label: '员工自评' },
  { key: 'review', label: '评审打分' },
  { key: 'calibration', label: 'AI 分析 & 校准' },
  { key: 'confirm', label: '结果确认' },
  { key: 'appeal', label: '申诉处理' }
] as const

const DIMENSION_TYPES = [
  { value: 'REGULAR', label: '常规评估' },
  { value: 'PROMOTION', label: '晋升评估' },
  { value: 'TEXT', label: '文本反馈' },
  { value: 'METRIC', label: '系统指标' }
]

const SCORING_METHODS = [
  { value: 'LEVEL', label: '等级' },
  { value: 'SCORE', label: '分值' },
  { value: 'CONCLUSION', label: '结论型' },
  { value: 'TEXT', label: '文本' }
]

const EDITABLE_ROLES: { value: PerfRole; label: string }[] = [
  { value: 'EMPLOYEE', label: '员工' },
  { value: 'REVIEWER', label: '评审员' },
  { value: 'LEADER', label: '上级' }
]

/** 维度编辑行（本地态；提交时转 PUT /cycles/:id/dimensions 的 items） */
type DimensionDraft = {
  id?: number
  name: string
  type: string
  scoringMethod: string
  weight: string
  editableRoles: PerfRole[]
  jobCategory: string
}

const dimensionToDraft = (dim: PerfDimension): DimensionDraft => ({
  id: dim.id,
  name: dim.name,
  type: dim.type,
  scoringMethod: dim.scoringMethod,
  weight: dim.weight != null ? String(Number(dim.weight)) : '',
  editableRoles: dim.editableRoles,
  jobCategory: (dim.applicableScope as { jobCategory?: string } | null)?.jobCategory ?? ''
})

/** 周期类型选项（季度/年度为预留能力） */
const CYCLE_TYPES = [
  { value: 'SEMI_ANNUAL', label: '半年度' },
  { value: 'QUARTERLY', label: '季度（预留）' },
  { value: 'ANNUAL', label: '年度（预留）' }
]

/**
 * 创建/编辑周期：6 步分步表单，逐步提交后端。
 * 新建时第 1 步创建周期（可选模板复制），随后各步骤 PUT 各子资源。
 */
const CycleEdit = ({ cycleId }: { cycleId: string }) => {
  const router = useRouter()
  const isNew = cycleId === 'new'

  const [currentStep, setCurrentStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [realCycleId, setRealCycleId] = useState<number | null>(isNew ? null : Number(cycleId))

  // 第 1 步：基础信息
  const [name, setName] = useState('')
  const [type, setType] = useState('SEMI_ANNUAL')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [templateId, setTemplateId] = useState<string>('')
  const [sourceTemplateName, setSourceTemplateName] = useState('')
  const [configDirty, setConfigDirty] = useState(false)
  const [applyConfirmOpen, setApplyConfirmOpen] = useState(false)
  const [templates, setTemplates] = useState<PerfTemplate[]>([])
  const [cycleStatus, setCycleStatus] = useState<string>('DRAFT')

  // 配置模板下拉选项（空值 = 不使用模板，由 placeholder 兜底展示）
  const templateOptions = toTemplateOptions(templates)

  // 第 2 步：考核人员
  const [participants, setParticipants] = useState<PerfParticipantItem[]>([])
  const [departments, setDepartments] = useState<{ open_department_id: string; name: string }[]>([])
  const [selectedDept, setSelectedDept] = useState('')

  // 按部门圈人下拉选项
  const departmentOptions = departments.map(dept => ({ value: dept.open_department_id, label: dept.name }))

  // 第 3/4/5 步
  const [dimensions, setDimensions] = useState<DimensionDraft[]>([])

  const [evaluationRule, setEvaluationRule] = useState({
    levels: DEFAULT_EVALUATION_RATINGS,
    commentRequiredRules: DEFAULT_COMMENT_REQUIRED_RULES
  })

  const [windows, setWindows] = useState<Record<string, { startAt: string; endAt: string }>>({})

  // 第 6 步
  const [checkItems, setCheckItems] = useState<StartCheckItem[]>([])
  const [checkOk, setCheckOk] = useState(false)

  const editable = cycleStatus === 'DRAFT' || cycleStatus === 'PENDING'

  const markConfigDirty = () => setConfigDirty(true)

  const updateDimensions = (updater: SetStateAction<DimensionDraft[]>) => {
    markConfigDirty()
    setDimensions(updater)
  }

  const updateEvaluationRule = (updater: SetStateAction<typeof evaluationRule>) => {
    markConfigDirty()
    setEvaluationRule(updater)
  }

  // ---- 数据加载 ----

  const loadCycle = useCallback(async (id: number) => {
    const cycle = await apiFetch<PerfCycle>(`/cycles/${id}`)

    setName(cycle.name)
    setType(cycle.type)
    setStartDate(cycle.startDate?.slice(0, 10) ?? '')
    setEndDate(cycle.endDate?.slice(0, 10) ?? '')
    setTemplateId(cycle.templateId ? String(cycle.templateId) : '')
    setSourceTemplateName(cycle.template?.name ?? '')
    setCycleStatus(cycle.status)
    setDimensions((cycle.dimensions ?? []).map(dimensionToDraft))
    setConfigDirty(false)

    if (cycle.evaluationRule?.levels?.length) {
      setEvaluationRule({
        levels: cycle.evaluationRule.levels,
        commentRequiredRules: cycle.evaluationRule.commentRequiredRules ?? DEFAULT_COMMENT_REQUIRED_RULES
      })
    }

    const windowState: Record<string, { startAt: string; endAt: string }> = {}

    for (const stage of WINDOW_STAGES) {
      const value = cycle.windows?.[stage.key]

      windowState[stage.key] = {
        startAt: value?.startAt?.slice(0, 16) ?? '',
        endAt: value?.endAt?.slice(0, 16) ?? ''
      }
    }

    setWindows(windowState)
  }, [])

  const loadParticipants = useCallback(async (id: number) => {
    const data = await apiFetch<ListResponse<PerfParticipantItem>>(`/cycles/${id}/participants`)

    setParticipants(data.items ?? [])
  }, [])

  useEffect(() => {
    // 模板与部门列表（新建/编辑都可能用）
    apiFetch<ListResponse<PerfTemplate>>('/templates')
      .then(data => {
        const items = data.items ?? []

        setTemplates(items)

        // 新建周期时只自动选中“默认且可用于创建”的配置模板。
        if (isNew && !realCycleId) {
          const defaultUsableTemplateId = findDefaultUsableTemplateId(items)

          if (defaultUsableTemplateId) {
            setTemplateId(current => current || defaultUsableTemplateId)
          }
        }
      })
      .catch(() => undefined)
    apiFetch<{ items: { open_department_id: string; name: string }[] }>('/contact/departments')
      .then(data => setDepartments(data.items ?? []))
      .catch(() => undefined)

    if (realCycleId) {
      // 延迟到宏任务，避免在 effect 内同步 setState 触发级联渲染
      const initialLoad = setTimeout(() => {
        loadCycle(realCycleId).catch(err => toast.error(err instanceof ApiError ? err.message : '加载周期失败'))
        loadParticipants(realCycleId).catch(() => undefined)
      }, 0)

      return () => clearTimeout(initialLoad)
    }
  }, [isNew, realCycleId, loadCycle, loadParticipants])

  // ---- 各步骤保存 ----

  /** 第 1 步：新建 POST /cycles；编辑 PATCH /cycles/:id */
  const saveBasic = async (): Promise<boolean> => {
    if (!name || !startDate || !endDate) {
      toast.error('请填写周期名称与起止日期')

      return false
    }

    setSaving(true)

    try {
      if (!realCycleId) {
        const created = await apiFetch<PerfCycle>('/cycles', {
          method: 'POST',
          body: JSON.stringify({
            name,
            type,
            startDate,
            endDate,
            templateId: templateId ? Number(templateId) : undefined
          })
        })

        setRealCycleId(created.id)

        // 更新地址栏，刷新后仍停留在该周期
        window.history.replaceState(null, '', `/cycles/${created.id}/edit`)
        toast.success(templateId ? '周期已创建，已从模板复制评估规则与维度' : '周期已创建')
      } else {
        await apiFetch(`/cycles/${realCycleId}`, {
          method: 'PATCH',
          body: JSON.stringify({ name, type, startDate, endDate })
        })
        toast.success('基础信息已保存')
      }

      return true
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败')

      return false
    } finally {
      setSaving(false)
    }
  }

  /** 第 3 步：整体提交维度 */
  const saveDimensions = async (): Promise<boolean> => {
    if (!realCycleId) return false
    setSaving(true)

    try {
      await apiFetch(`/cycles/${realCycleId}/dimensions`, {
        method: 'PUT',
        body: JSON.stringify({
          items: dimensions.map((dim, index) => ({
            id: dim.id,
            name: dim.name,
            type: dim.type,
            scoringMethod: dim.scoringMethod,
            weight: dim.weight === '' ? undefined : Number(dim.weight),
            sortOrder: index,
            editableRoles: dim.editableRoles,
            visibleRoles: dim.editableRoles,
            applicableScope: dim.jobCategory ? { jobCategory: dim.jobCategory } : undefined
          }))
        })
      })
      toast.success('评估维度已保存')
      await loadCycle(realCycleId)

      return true
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存维度失败')

      return false
    } finally {
      setSaving(false)
    }
  }

  /** 第 4 步：评估规则 */
  const saveEvaluationRule = async (): Promise<boolean> => {
    if (!realCycleId) return false

    const evaluationRuleError = validateEvaluationRuleDraft(evaluationRule)

    if (evaluationRuleError) {
      toast.error(evaluationRuleError)

      return false
    }

    setSaving(true)

    try {
      await apiFetch(`/cycles/${realCycleId}/evaluation-rule`, {
        method: 'PUT',
        body: JSON.stringify(normalizeEvaluationRuleDraft(evaluationRule))
      })
      toast.success('评估规则已保存')

      return true
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存评估规则失败')

      return false
    } finally {
      setSaving(false)
    }
  }

  /** 第 5 步：时间窗口 */
  const saveWindows = async (): Promise<boolean> => {
    if (!realCycleId) return false
    setSaving(true)

    try {
      const payload: Record<string, { startAt?: string; endAt?: string }> = {}

      for (const stage of WINDOW_STAGES) {
        const value = windows[stage.key]

        if (value?.startAt || value?.endAt) {
          payload[stage.key] = {
            startAt: value.startAt ? new Date(value.startAt).toISOString() : undefined,
            endAt: value.endAt ? new Date(value.endAt).toISOString() : undefined
          }
        }
      }

      await apiFetch(`/cycles/${realCycleId}/windows`, {
        method: 'PUT',
        body: JSON.stringify({ windows: payload })
      })
      toast.success('时间窗口已保存')

      return true
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存时间窗口失败')

      return false
    } finally {
      setSaving(false)
    }
  }

  const runStartCheck = useCallback(async () => {
    if (!realCycleId) return

    try {
      const data = await apiFetch<{ items: StartCheckItem[]; ok: boolean }>(`/cycles/${realCycleId}/start-check`)

      setCheckItems(data.items)
      setCheckOk(data.ok)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '启动检查失败')
    }
  }, [realCycleId])

  const handleStart = async () => {
    if (!realCycleId) return
    setSaving(true)

    try {
      await apiFetch(`/cycles/${realCycleId}/start`, { method: 'POST' })
      toast.success('周期已启动，进入员工自评阶段')
      router.push(`/cycles/${realCycleId}`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '启动失败')
    } finally {
      setSaving(false)
    }
  }

  const executeApplyTemplate = async () => {
    if (!realCycleId || !templateId) {
      toast.error('请选择要重新套用的配置模板')

      return
    }

    setSaving(true)

    try {
      const cycle = await apiFetch<PerfCycle>(`/cycles/${realCycleId}/apply-template`, {
        method: 'POST',
        body: JSON.stringify({ templateId: Number(templateId) })
      })

      toast.success('已重新套用模板，当前评估规则与评估维度已更新')
      setSourceTemplateName(
        cycle.template?.name ?? templates.find(template => template.id === Number(templateId))?.name ?? ''
      )
      setApplyConfirmOpen(false)
      setConfigDirty(false)
      await loadCycle(realCycleId)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '重新套用模板失败')
    } finally {
      setSaving(false)
    }
  }

  const handleApplyTemplate = () => {
    if (shouldConfirmTemplateOverwrite(configDirty)) {
      setApplyConfirmOpen(true)

      return
    }

    void executeApplyTemplate()
  }

  /** 下一步：先保存当前步骤 */
  const handleNext = async () => {
    const stepKey = STEPS[currentStep].key
    let ok = true

    if (editable) {
      if (stepKey === 'basic') ok = await saveBasic()
      else if (stepKey === 'dimensions') ok = await saveDimensions()
      else if (stepKey === 'scoring') ok = await saveEvaluationRule()
      else if (stepKey === 'windows') ok = await saveWindows()
    }

    if (!ok) return
    const next = Math.min(STEPS.length - 1, currentStep + 1)

    setCurrentStep(next)
    if (STEPS[next].key === 'preflight') void runStartCheck()
  }

  // ---- 人员操作 ----

  const addMember = async (openId?: string) => {
    if (!realCycleId || !openId) return

    try {
      const result = await apiFetch<{ added: number }>(`/cycles/${realCycleId}/participants`, {
        method: 'POST',
        body: JSON.stringify({ openIds: [openId] })
      })

      if (result.added === 0) toast.info('该员工已在名单中')
      await loadParticipants(realCycleId)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '添加人员失败')
    }
  }

  const addDepartment = async () => {
    if (!realCycleId || !selectedDept) return

    try {
      const result = await apiFetch<{ added: number }>(`/cycles/${realCycleId}/participants/by-departments`, {
        method: 'POST',
        body: JSON.stringify({ departmentIds: [selectedDept] })
      })

      toast.success(`已添加 ${result.added} 人（含子部门）`)
      await loadParticipants(realCycleId)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '按部门圈人失败')
    }
  }

  const removeMember = async (participantId: number) => {
    if (!realCycleId) return

    try {
      await apiFetch(`/cycles/${realCycleId}/participants/${participantId}`, { method: 'DELETE' })
      await loadParticipants(realCycleId)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '移除失败')
    }
  }

  const togglePromotion = async (participant: PerfParticipantItem) => {
    if (!realCycleId) return

    try {
      await apiFetch(`/cycles/${realCycleId}/participants/${participant.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isPromotionEnabled: !participant.isPromotionEnabled })
      })
      await loadParticipants(realCycleId)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '更新失败')
    }
  }

  // ---- 渲染 ----

  const step = STEPS[currentStep]
  const stepLocked = !realCycleId && step.key !== 'basic'

  return (
    <>
      <div className='flex flex-col gap-6'>
        <PageHeader
          title={isNew && !realCycleId ? '新建绩效周期' : `编辑绩效周期${name ? ` · ${name}` : ''}`}
          description={editable ? '按步骤完成周期配置后即可启动评审' : '周期已启动：仅时间窗口可调整，其余配置只读'}
        />

        {/* 编号步骤布局对齐模板 Numbered Steps：单卡片、左侧步骤列、右侧当前步骤内容。 */}
        <Card className='gap-0 p-0 md:grid md:max-lg:grid-cols-5 lg:grid-cols-4'>
          <CardContent className='col-span-5 p-6 max-md:border-b md:border-r md:max-lg:col-span-2 lg:col-span-1'>
            <nav aria-label='周期配置步骤'>
              <ol className='flex flex-col justify-between gap-x-2 gap-y-6'>
                {STEPS.map((item, index) => {
                  const reached = index <= currentStep

                  return (
                    <li key={item.key}>
                      <Button
                        variant='ghost'
                        aria-current={index === currentStep ? 'step' : undefined}
                        className='h-auto w-full shrink-0 cursor-pointer justify-start gap-2 rounded bg-transparent! px-0! text-left whitespace-normal'
                        onClick={() => {
                          setCurrentStep(index)
                          if (item.key === 'preflight') void runStartCheck()
                        }}
                      >
                        <Avatar className='size-10.5 shrink-0'>
                          <AvatarFallback
                            className={cn('text-sm font-semibold', {
                              'bg-primary text-primary-foreground shadow-sm': reached
                            })}
                          >
                            {index + 1}
                          </AvatarFallback>
                        </Avatar>
                        <div className='flex min-w-0 flex-1 flex-col items-start'>
                          <span className='text-base'>{item.title}</span>
                          <span className='text-muted-foreground text-sm leading-normal break-words'>
                            {item.description}
                          </span>
                        </div>
                      </Button>
                    </li>
                  )
                })}
              </ol>
            </nav>
          </CardContent>

          <CardContent className='col-span-4 flex min-h-80 flex-col justify-between gap-6 p-6 md:col-span-3'>
            <div className='flex flex-col gap-5'>
              <div>
                <h3 className='font-semibold'>{`第 ${currentStep + 1} 步 · ${step.title}`}</h3>
                <p className='text-muted-foreground text-sm'>{step.description}</p>
              </div>
              <div>
                {stepLocked ? (
                  <div className='text-muted-foreground flex min-h-60 items-center justify-center rounded-lg border border-dashed p-8 text-sm'>
                    请先完成第 1 步创建周期
                  </div>
                ) : step.key === 'basic' ? (
                  <FieldGroup className='max-w-xl gap-4'>
                    <Field className='gap-2'>
                      <FieldLabel htmlFor='cycleName'>周期名称*</FieldLabel>
                      <Input
                        id='cycleName'
                        placeholder='例如：2026 上半年绩效考核'
                        value={name}
                        disabled={!editable}
                        onChange={event => setName(event.target.value)}
                      />
                    </Field>
                    <Field className='gap-2'>
                      <FieldLabel htmlFor='cycleType'>周期类型*</FieldLabel>
                      <Select
                        value={type}
                        items={CYCLE_TYPES}
                        disabled={!editable}
                        onValueChange={value => setType(value as string)}
                      >
                        <SelectTrigger id='cycleType' className='w-full'>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CYCLE_TYPES.map(option => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field className='gap-2'>
                      <FieldLabel htmlFor='cycleDateRange'>周期起止日期*</FieldLabel>
                      <DateRangePicker
                        id='cycleDateRange'
                        value={{ from: startDate, to: endDate }}
                        disabled={!editable}
                        onChange={value => {
                          setStartDate(value.from)
                          setEndDate(value.to)
                        }}
                      />
                    </Field>
                    {!realCycleId && (
                      <Field className='gap-2'>
                        <FieldLabel htmlFor='template'>配置模板</FieldLabel>
                        <Select
                          value={templateId || null}
                          items={templateOptions}
                          onValueChange={value => setTemplateId((value as string | null) ?? '')}
                        >
                          <SelectTrigger id='template' className='w-full'>
                            <SelectValue placeholder='不使用模板（手动配置）' />
                          </SelectTrigger>
                          <SelectContent>
                            {templateOptions.map(option => (
                              <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                                <span className='flex min-w-0 flex-col items-start'>
                                  <span className='truncate'>{option.label}</span>
                                  {option.disabled && option.reason ? (
                                    <span className='text-muted-foreground text-xs whitespace-normal'>
                                      {option.reason}
                                    </span>
                                  ) : null}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <span className='text-muted-foreground text-xs'>
                          选择模板后自动复制评估规则与维度集为本周期快照，创建后可再微调
                        </span>
                      </Field>
                    )}
                    {realCycleId && (
                      <Field className='gap-2'>
                        <FieldLabel htmlFor='applyTemplate'>来源模板</FieldLabel>
                        <div className='rounded-md border p-3 text-sm'>
                          <div className='font-medium'>{sourceTemplateName || '未记录来源模板'}</div>
                          <p className='text-muted-foreground mt-1 text-xs'>
                            来源模板仅表示创建时或最近套用时复制；当前评估规则与评估维度是周期配置快照，可能已被手动修改。
                          </p>
                        </div>
                        {editable && (
                          <div className='flex flex-wrap items-end gap-2'>
                            <Select
                              value={templateId || null}
                              items={templateOptions}
                              onValueChange={value => setTemplateId((value as string | null) ?? '')}
                            >
                              <SelectTrigger id='applyTemplate' className='min-w-64'>
                                <SelectValue placeholder='选择要重新套用的模板' />
                              </SelectTrigger>
                              <SelectContent>
                                {templateOptions.map(option => (
                                  <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                                    <span className='flex min-w-0 flex-col items-start'>
                                      <span className='truncate'>{option.label}</span>
                                      {option.disabled && option.reason ? (
                                        <span className='text-muted-foreground text-xs whitespace-normal'>
                                          {option.reason}
                                        </span>
                                      ) : null}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              variant='outline'
                              disabled={!templateId || saving}
                              onClick={() => handleApplyTemplate()}
                            >
                              <RefreshCwIcon />
                              重新套用模板
                            </Button>
                          </div>
                        )}
                      </Field>
                    )}
                  </FieldGroup>
                ) : step.key === 'members' ? (
                  <div className='flex flex-col gap-4'>
                    {editable && (
                      <div className='flex flex-wrap items-end gap-3'>
                        <Field className='gap-2'>
                          <FieldLabel>按员工添加</FieldLabel>
                          <LarkMemberSelector
                            placeholder='搜索并选择员工'
                            onSelect={option => void addMember(option.id as string | undefined)}
                          />
                        </Field>
                        <Field className='gap-2'>
                          <FieldLabel htmlFor='deptSelect'>按部门圈人（含子部门）</FieldLabel>
                          <div className='flex gap-2'>
                            <Select
                              value={selectedDept || null}
                              items={departmentOptions}
                              onValueChange={value => setSelectedDept((value as string | null) ?? '')}
                            >
                              <SelectTrigger id='deptSelect' className='min-w-44'>
                                <SelectValue placeholder='选择部门…' />
                              </SelectTrigger>
                              <SelectContent>
                                {departmentOptions.map(option => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button variant='outline' disabled={!selectedDept} onClick={() => void addDepartment()}>
                              <PlusIcon />
                              添加
                            </Button>
                          </div>
                        </Field>
                      </div>
                    )}

                    <div className='rounded-lg border'>
                      <div className='text-muted-foreground border-b px-4 py-2 text-sm'>
                        已圈定 {participants.length} 人
                      </div>
                      <div className='flex max-h-96 flex-col gap-1 overflow-y-auto p-2'>
                        {participants.length === 0 ? (
                          <div className='text-muted-foreground py-10 text-center text-sm'>暂无人员</div>
                        ) : (
                          participants.map(participant => (
                            <div
                              key={participant.id}
                              className='hover:bg-muted flex items-center justify-between rounded-md px-2 py-1.5'
                            >
                              <div className='flex items-center gap-2'>
                                <UserAvatar
                                  openId={participant.employeeOpenId}
                                  name={participant.employee?.name}
                                  avatarUrl={avatarUrlOf(participant.employee)}
                                  size='sm'
                                />
                                <span className='text-sm font-medium'>
                                  {participant.employee?.name ?? participant.employeeOpenId}
                                </span>
                                <span className='text-muted-foreground text-xs'>{participant.departmentName}</span>
                              </div>
                              <div className='flex items-center gap-2'>
                                <label className='text-muted-foreground flex items-center gap-1.5 text-xs'>
                                  <Checkbox
                                    checked={participant.isPromotionEnabled}
                                    disabled={!editable}
                                    onCheckedChange={() => void togglePromotion(participant)}
                                  />
                                  晋升评估
                                </label>
                                {editable && (
                                  <Button
                                    variant='ghost'
                                    size='icon-sm'
                                    onClick={() => void removeMember(participant.id)}
                                  >
                                    <Trash2Icon className='text-destructive size-3.5' />
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                ) : step.key === 'dimensions' ? (
                  <div className='flex flex-col gap-3'>
                    {dimensions.map((dim, index) => (
                      <div
                        key={dim.id ?? `new-${index}`}
                        className='flex flex-wrap items-end gap-2 rounded-lg border p-3'
                      >
                        <Field className='min-w-40 flex-1 gap-1'>
                          <FieldLabel className='text-xs'>维度名称</FieldLabel>
                          <Input
                            value={dim.name}
                            disabled={!editable}
                            onChange={event =>
                              updateDimensions(prev =>
                                prev.map((item, i) => (i === index ? { ...item, name: event.target.value } : item))
                              )
                            }
                          />
                        </Field>
                        <Field className='gap-1'>
                          <FieldLabel className='text-xs'>类型</FieldLabel>
                          <Select
                            value={dim.type}
                            items={DIMENSION_TYPES}
                            disabled={!editable}
                            onValueChange={value =>
                              updateDimensions(prev =>
                                prev.map((item, i) => (i === index ? { ...item, type: value as string } : item))
                              )
                            }
                          >
                            <SelectTrigger className='min-w-28'>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {DIMENSION_TYPES.map(option => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field className='gap-1'>
                          <FieldLabel className='text-xs'>计分方式</FieldLabel>
                          <Select
                            value={dim.scoringMethod}
                            items={SCORING_METHODS}
                            disabled={!editable}
                            onValueChange={value =>
                              updateDimensions(prev =>
                                prev.map((item, i) =>
                                  i === index ? { ...item, scoringMethod: value as string } : item
                                )
                              )
                            }
                          >
                            <SelectTrigger className='min-w-28'>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {SCORING_METHODS.map(option => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field className='w-24 gap-1'>
                          <FieldLabel className='text-xs'>权重 %</FieldLabel>
                          <Input
                            type='number'
                            value={dim.weight}
                            disabled={!editable}
                            onChange={event =>
                              updateDimensions(prev =>
                                prev.map((item, i) => (i === index ? { ...item, weight: event.target.value } : item))
                              )
                            }
                          />
                        </Field>
                        <Field className='w-28 gap-1'>
                          <FieldLabel className='text-xs'>岗位分组</FieldLabel>
                          <Input
                            placeholder='如 D / M'
                            value={dim.jobCategory}
                            disabled={!editable}
                            onChange={event =>
                              updateDimensions(prev =>
                                prev.map((item, i) =>
                                  i === index ? { ...item, jobCategory: event.target.value } : item
                                )
                              )
                            }
                          />
                        </Field>
                        <Field className='gap-1'>
                          <FieldLabel className='text-xs'>填写角色</FieldLabel>
                          <div className='flex h-9 items-center gap-3'>
                            {EDITABLE_ROLES.map(role => (
                              <label key={role.value} className='flex items-center gap-1 text-xs'>
                                <Checkbox
                                  checked={dim.editableRoles.includes(role.value)}
                                  disabled={!editable}
                                  onCheckedChange={checked =>
                                    updateDimensions(prev =>
                                      prev.map((item, i) =>
                                        i === index
                                          ? {
                                              ...item,
                                              editableRoles: checked
                                                ? [...item.editableRoles, role.value]
                                                : item.editableRoles.filter(r => r !== role.value)
                                            }
                                          : item
                                      )
                                    )
                                  }
                                />
                                {role.label}
                              </label>
                            ))}
                          </div>
                        </Field>
                        {editable && (
                          <Button
                            variant='ghost'
                            size='icon-sm'
                            className='mb-0.5'
                            onClick={() => updateDimensions(prev => prev.filter((_, i) => i !== index))}
                          >
                            <Trash2Icon className='text-destructive size-3.5' />
                          </Button>
                        )}
                      </div>
                    ))}
                    {editable && (
                      <Button
                        variant='outline'
                        className='w-fit'
                        onClick={() =>
                          updateDimensions(prev => [
                            ...prev,
                            {
                              name: '',
                              type: 'REGULAR',
                              scoringMethod: 'LEVEL',
                              weight: '',
                              editableRoles: ['REVIEWER', 'LEADER'],
                              jobCategory: ''
                            }
                          ])
                        }
                      >
                        <PlusIcon />
                        添加维度
                      </Button>
                    )}
                    <span className='text-muted-foreground text-xs'>
                      权重按「岗位分组」分别合计 100%；留空分组表示全员适用。晋升维度不计权重。
                    </span>
                  </div>
                ) : step.key === 'scoring' ? (
                  <div className='max-w-5xl'>
                    <EvaluationRuleEditor
                      value={evaluationRule}
                      disabled={!editable}
                      onChange={updateEvaluationRule}
                    />
                  </div>
                ) : step.key === 'windows' ? (
                  <div className='flex max-w-3xl flex-col gap-4'>
                    {WINDOW_STAGES.map(stage => (
                      <div key={stage.key} className='grid items-end gap-3 sm:grid-cols-[140px_1fr]'>
                        <span className='pb-2 text-sm font-medium'>{stage.label}</span>
                        <Field className='gap-1'>
                          <FieldLabel className='text-xs'>起止时间</FieldLabel>
                          <DateTimeRangePicker
                            value={{
                              from: windows[stage.key]?.startAt ?? '',
                              to: windows[stage.key]?.endAt ?? ''
                            }}
                            disabled={!editable}
                            onChange={value =>
                              setWindows(prev => ({
                                ...prev,
                                [stage.key]: {
                                  ...prev[stage.key],
                                  startAt: value.from,
                                  endAt: value.to
                                }
                              }))
                            }
                          />
                        </Field>
                      </div>
                    ))}
                    <span className='text-muted-foreground text-xs'>
                      自评与评审窗口为启动必填项；周期启动后仍可调整（视为延长窗口，写入审计日志）。
                    </span>
                  </div>
                ) : (
                  <div className='flex max-w-xl flex-col gap-3'>
                    {checkItems.length === 0 ? (
                      <div className='text-muted-foreground py-10 text-center text-sm'>正在获取检查结果…</div>
                    ) : (
                      checkItems.map(item => (
                        <div key={item.key} className='flex items-start gap-3 rounded-lg border p-3 text-sm'>
                          {item.ok ? (
                            <CheckCircle2Icon className='mt-0.5 size-4 shrink-0 text-green-600' />
                          ) : (
                            <XCircleIcon className='text-destructive mt-0.5 size-4 shrink-0' />
                          )}
                          <span className={item.ok ? '' : 'text-destructive'}>{item.message}</span>
                        </div>
                      ))
                    )}
                    {!editable && <Badge variant='outline'>周期已启动</Badge>}
                  </div>
                )}
              </div>
            </div>

            {/* 底部步骤切换：沿用原保存/启动逻辑，只调整为模板的右侧内容区动作栏。 */}
            <div className='flex flex-wrap items-center justify-between gap-3 border-t pt-4'>
              <Button
                variant='outline'
                onClick={() => setCurrentStep(prev => Math.max(0, prev - 1))}
                disabled={currentStep === 0}
              >
                <ChevronLeftIcon />
                上一步
              </Button>
              {step.key === 'preflight' ? (
                <div className='flex gap-2'>
                  <Button variant='outline' onClick={() => void runStartCheck()}>
                    重新检查
                  </Button>
                  <Button disabled={!checkOk || !editable || saving} onClick={() => void handleStart()}>
                    {saving && <Loader2Icon className='size-4 animate-spin' />}
                    启动周期
                  </Button>
                </div>
              ) : (
                <Button onClick={() => void handleNext()} disabled={saving}>
                  {saving && <Loader2Icon className='size-4 animate-spin' />}
                  {editable ? '保存并下一步' : '下一步'}
                  <ChevronRightIcon />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
      <Dialog open={applyConfirmOpen} onOpenChange={setApplyConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>覆盖当前评估规则与评估维度？</DialogTitle>
            <DialogDescription>
              重新套用模板会整体覆盖当前周期配置快照中的评估规则与评估维度，不会做字段级合并。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setApplyConfirmOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void executeApplyTemplate()} disabled={saving}>
              {saving && <Loader2Icon className='size-4 animate-spin' />}
              确认覆盖
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default CycleEdit
