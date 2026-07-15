'use client'

import { useMemo, useState } from 'react'

import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Loader2Icon,
  PlusIcon,
  Settings2Icon,
  XCircleIcon
} from 'lucide-react'

import { DataTable } from '@/components/datatable'
import { DateTimePicker } from '@/components/shared/DatePicker'
import { LarkMemberSelector } from '@/components/shared/lark'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type {
  PerfConfigScheduleStage,
  PerfConfigTemplateVersionSummary,
  PerfCyclePlan,
  PerfCycleSetupParticipant,
  PerfCycleStatus,
  PerfParticipantPrefixCheck,
  StartCheckItem
} from '@/lib/perf-api'
import { cn } from '@/lib/utils'

import { getCycleScheduleColumns } from './cycle-schedule-table-columns'
import {
  CYCLE_SETUP_STEPS,
  type CycleSetupStepKey,
  summarizePrefixChecks,
  toConfigTemplateOptions
} from './cycle-setup-utils'
import { getParticipantSetupColumns } from './participant-setup-table-columns'

export type CycleSetupDraft = {
  name: string
  configTemplateVersionId: string
  plannedStartAt: string
}

type DepartmentOption = { open_department_id: string; name: string }

type Props = {
  status: PerfCycleStatus
  draft: CycleSetupDraft
  configTemplates: PerfConfigTemplateVersionSummary[]
  sourceConfigLabel: string
  snapshotManuallyModified?: boolean
  participants: PerfCycleSetupParticipant[]
  prefixChecks: PerfParticipantPrefixCheck[]
  plan: PerfCyclePlan
  checkItems: StartCheckItem[]
  checkOk: boolean
  editable: boolean
  saving: boolean
  setupReady?: boolean
  departments?: DepartmentOption[]
  onDraftChange: (draft: CycleSetupDraft) => void
  onSaveBasic: () => Promise<boolean>
  onAddMember: (openId: string) => void
  onAddDepartment: (departmentId: string) => void
  onRemoveMember: (participantId: number) => void
  onTogglePromotion: (participant: PerfCycleSetupParticipant) => void
  onPlanChange: (plan: PerfCyclePlan) => void
  onSavePlan: () => Promise<boolean>
  onRunChecks: () => void
  onSaveDraft: () => void
  onSchedule: () => void
  onReturnToDraft: () => void
  onOpenAdvanced: () => void
  onReapplyTemplate?: (configTemplateVersionId: number) => Promise<boolean>
}

const EMPTY_NOTIFICATIONS: PerfCyclePlan['notificationRules'] = { stages: [] }

const ParticipantTable = ({
  participants,
  prefixChecks,
  editable,
  onTogglePromotion,
  onRemoveMember
}: Pick<Props, 'participants' | 'prefixChecks' | 'editable' | 'onTogglePromotion' | 'onRemoveMember'>) => {
  const columns = useMemo(
    () =>
      getParticipantSetupColumns({
        prefixChecks,
        editable,
        onTogglePromotion,
        onRemove: onRemoveMember
      }),
    [prefixChecks, editable, onTogglePromotion, onRemoveMember]
  )

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: participants, columns, getCoreRowModel: getCoreRowModel(), enableSorting: false })

  return <DataTable table={table} emptyText='尚未添加参与者' />
}

const ScheduleTable = ({
  plan,
  editable,
  onPlanChange,
  onEditNotification
}: Pick<Props, 'plan' | 'editable' | 'onPlanChange'> & {
  onEditNotification: (stage: PerfConfigScheduleStage) => void
}) => {
  const columns = useMemo(
    () =>
      getCycleScheduleColumns({
        notificationRules: plan.notificationRules ?? EMPTY_NOTIFICATIONS,
        editable,
        onChange: schedule =>
          onPlanChange({
            ...plan,
            stages: plan.stages.map(item => (item.stage === schedule.stage ? schedule : item))
          }),
        onEditNotification
      }),
    [plan, editable, onPlanChange, onEditNotification]
  )

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: plan.stages, columns, getCoreRowModel: getCoreRowModel(), enableSorting: false })

  return <DataTable table={table} emptyText='尚未生成任务日程' />
}

const CycleSetupEditor = ({
  status,
  draft,
  configTemplates,
  sourceConfigLabel,
  snapshotManuallyModified,
  participants,
  prefixChecks,
  plan,
  checkItems,
  checkOk,
  editable,
  saving,
  setupReady = true,
  departments = [],
  onDraftChange,
  onSaveBasic,
  onAddMember,
  onAddDepartment,
  onRemoveMember,
  onTogglePromotion,
  onPlanChange,
  onSavePlan,
  onRunChecks,
  onSaveDraft,
  onSchedule,
  onReturnToDraft,
  onOpenAdvanced,
  onReapplyTemplate
}: Props) => {
  const [currentStep, setCurrentStep] = useState<CycleSetupStepKey>('basic')
  const [selectedDepartment, setSelectedDepartment] = useState('')
  const [notificationStage, setNotificationStage] = useState<PerfConfigScheduleStage | null>(null)
  const [reapplyOpen, setReapplyOpen] = useState(false)
  const [reapplyStep, setReapplyStep] = useState<'pick' | 'confirm'>('pick')
  const [reapplyVersionId, setReapplyVersionId] = useState('')
  const [reapplying, setReapplying] = useState(false)
  const templateOptions = toConfigTemplateOptions(configTemplates)
  const prefixSummary = summarizePrefixChecks(prefixChecks)
  const stepIndex = CYCLE_SETUP_STEPS.findIndex(step => step.key === currentStep)
  const notification = plan.notificationRules?.stages.find(item => item.stage === notificationStage)

  const goToStep = (step: CycleSetupStepKey) => {
    setCurrentStep(step)
    if (step === 'checks') onRunChecks()
  }

  const handleNext = async () => {
    let allowed = true

    if (currentStep === 'basic') allowed = await onSaveBasic()
    if (currentStep === 'plan') allowed = await onSavePlan()
    if (!allowed) return

    const nextStep = CYCLE_SETUP_STEPS[Math.min(stepIndex + 1, CYCLE_SETUP_STEPS.length - 1)]

    goToStep(nextStep.key)
  }

  /** 左侧步骤可点击，但离开可编辑步骤前必须先保存，避免跳步丢失本地修改。 */
  const handleStepSelection = async (target: CycleSetupStepKey) => {
    if (target === currentStep) return
    let allowed = true

    if (currentStep === 'basic') allowed = await onSaveBasic()
    if (currentStep === 'plan') allowed = await onSavePlan()
    if (allowed) goToStep(target)
  }

  const openReapplyDialog = () => {
    setReapplyVersionId('')
    setReapplyStep('pick')
    setReapplyOpen(true)
  }

  const closeReapplyDialog = () => {
    setReapplyOpen(false)
    setReapplyStep('pick')
  }

  /** 点「套用」：未手动修改过快照时静默直接调用；已手动修改则先切到覆盖确认视图。 */
  const handleReapplyApply = async () => {
    if (!reapplyVersionId || !onReapplyTemplate) return

    if (snapshotManuallyModified) {
      setReapplyStep('confirm')

      return
    }

    setReapplying(true)

    try {
      const ok = await onReapplyTemplate(Number(reapplyVersionId))

      if (ok) closeReapplyDialog()
    } finally {
      setReapplying(false)
    }
  }

  const handleReapplyConfirm = async () => {
    if (!reapplyVersionId || !onReapplyTemplate) return
    setReapplying(true)

    try {
      const ok = await onReapplyTemplate(Number(reapplyVersionId))

      if (ok) closeReapplyDialog()
    } finally {
      setReapplying(false)
    }
  }

  const patchNotification = (next: Partial<NonNullable<typeof notification>>) => {
    if (!notificationStage || !notification) return

    onPlanChange({
      ...plan,
      notificationRules: {
        stages: plan.notificationRules.stages.map(item =>
          item.stage === notificationStage ? { ...item, ...next } : item
        )
      }
    })
  }

  return (
    <>
      <div className='flex justify-end'>
        <Button variant='outline' onClick={onOpenAdvanced}>
          <Settings2Icon />
          高级配置
        </Button>
      </div>

      <Card className='gap-0 p-0 md:grid md:grid-cols-4'>
        <CardContent className='border-b p-6 md:col-span-1 md:border-r md:border-b-0'>
          <nav aria-label='周期创建步骤'>
            <ol className='flex flex-col gap-3'>
              {CYCLE_SETUP_STEPS.map((step, index) => (
                <li key={step.key}>
                  <Button
                    variant='ghost'
                    className={cn(
                      'h-auto w-full justify-start gap-3 px-2 py-3 text-left whitespace-normal',
                      currentStep === step.key && 'bg-muted'
                    )}
                    aria-current={currentStep === step.key ? 'step' : undefined}
                    disabled={!setupReady && index > 0}
                    onClick={() => void handleStepSelection(step.key)}
                  >
                    <span
                      className={cn(
                        'bg-muted flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                        index <= stepIndex && 'bg-primary text-primary-foreground'
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className='flex min-w-0 flex-col items-start'>
                      <span className='font-medium'>{step.title}</span>
                      <span className='text-muted-foreground text-xs'>{step.description}</span>
                    </span>
                  </Button>
                </li>
              ))}
            </ol>
          </nav>
        </CardContent>

        <CardContent className='flex min-h-120 flex-col justify-between gap-6 p-6 md:col-span-3'>
          <div className='flex flex-col gap-5'>
            <div>
              <h2 className='font-semibold'>
                第 {stepIndex + 1} 步 · {CYCLE_SETUP_STEPS[stepIndex].title}
              </h2>
              <p className='text-muted-foreground text-sm'>{CYCLE_SETUP_STEPS[stepIndex].description}</p>
            </div>

            {currentStep === 'basic' && (
              <FieldGroup className='max-w-2xl gap-5'>
                <Field className='gap-2'>
                  <FieldLabel htmlFor='cycle-name'>周期名称</FieldLabel>
                  <Input
                    id='cycle-name'
                    value={draft.name}
                    disabled={!editable}
                    placeholder='例如：2026 上半年绩效评定'
                    onChange={event => onDraftChange({ ...draft, name: event.target.value })}
                  />
                  <FieldDescription>周期名称直接表达业务期间，不再额外配置考核期间起止日期。</FieldDescription>
                </Field>

                {sourceConfigLabel ? (
                  <Field className='gap-2'>
                    <FieldLabel>来源配置模板版本</FieldLabel>
                    <div className='rounded-md border p-3 text-sm'>
                      <span className='font-medium'>{sourceConfigLabel}</span>
                      <p className='text-muted-foreground mt-1 text-xs'>周期已保存独立快照，来源模板后续变化不会影响本周期。</p>
                      {snapshotManuallyModified && (
                        <p className='text-amber-600 mt-1 text-xs'>当前评估规则与评估维度可能已被手动修改。</p>
                      )}
                      {editable && (
                        <Button variant='outline' size='sm' className='mt-3' onClick={openReapplyDialog}>
                          重新套用模板
                        </Button>
                      )}
                    </div>
                  </Field>
                ) : (
                  <Field className='gap-2'>
                    <FieldLabel htmlFor='config-template-version'>配置模板版本</FieldLabel>
                    <Select
                      value={draft.configTemplateVersionId || null}
                      items={templateOptions}
                      disabled={!editable}
                      onValueChange={value =>
                        onDraftChange({ ...draft, configTemplateVersionId: (value as string | null) ?? '' })
                      }
                    >
                      <SelectTrigger
                        id='config-template-version'
                        aria-label='配置模板版本'
                        className='w-full'
                      >
                        <SelectValue placeholder='请选择已发布配置模板版本' />
                      </SelectTrigger>
                      <SelectContent>
                        {templateOptions.map(option => (
                          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                            <span className='flex min-w-0 flex-col items-start'>
                              <span>{option.label}</span>
                              {option.reason && <span className='text-muted-foreground text-xs whitespace-normal'>{option.reason}</span>}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}

                <Field className='gap-2'>
                  <FieldLabel htmlFor='planned-start-at'>计划启动时间</FieldLabel>
                  <DateTimePicker
                    id='planned-start-at'
                    value={draft.plannedStartAt}
                    disabled={!editable}
                    onChange={value => onDraftChange({ ...draft, plannedStartAt: value })}
                  />
                  <FieldDescription>系统根据此时间与模板相对偏移生成三类任务的实际日程。</FieldDescription>
                </Field>
              </FieldGroup>
            )}

            {currentStep === 'participants' && (
              <div className='flex flex-col gap-4'>
                <div className='flex flex-wrap gap-2'>
                  <Badge variant='outline'>共 {prefixSummary.total} 人</Badge>
                  <Badge variant='outline'>D 匹配 {prefixSummary.matchedD} 人</Badge>
                  <Badge variant='outline'>M 匹配 {prefixSummary.matchedM} 人</Badge>
                  <Badge variant={prefixSummary.errors ? 'destructive' : 'outline'}>异常 {prefixSummary.errors} 人</Badge>
                </div>

                {editable && (
                  <div className='flex flex-wrap items-end gap-3'>
                    <Field className='gap-2'>
                      <FieldLabel>按员工添加</FieldLabel>
                      <LarkMemberSelector onSelect={option => option.id && onAddMember(String(option.id))} />
                    </Field>
                    {departments.length > 0 && (
                      <Field className='gap-2'>
                        <FieldLabel htmlFor='cycle-department'>按部门圈人</FieldLabel>
                        <div className='flex gap-2'>
                          <Select
                            value={selectedDepartment || null}
                            items={departments.map(item => ({ value: item.open_department_id, label: item.name }))}
                            onValueChange={value => setSelectedDepartment((value as string | null) ?? '')}
                          >
                            <SelectTrigger id='cycle-department' className='min-w-52'>
                              <SelectValue placeholder='选择部门（含子部门）' />
                            </SelectTrigger>
                            <SelectContent>
                              {departments.map(item => (
                                <SelectItem key={item.open_department_id} value={item.open_department_id}>
                                  {item.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            variant='outline'
                            disabled={!selectedDepartment}
                            onClick={() => onAddDepartment(selectedDepartment)}
                          >
                            <PlusIcon />
                            添加
                          </Button>
                        </div>
                      </Field>
                    )}
                  </div>
                )}

                <ParticipantTable
                  participants={participants}
                  prefixChecks={prefixChecks}
                  editable={editable}
                  onTogglePromotion={onTogglePromotion}
                  onRemoveMember={onRemoveMember}
                />
              </div>
            )}

            {currentStep === 'plan' && (
              <div className='flex flex-col gap-4'>
                <Alert>
                  <AlertTriangleIcon />
                  <AlertTitle>填写提醒时间是软截止</AlertTitle>
                  <AlertDescription>提醒到期后任务仍可填写，不会自动关闭、锁定或改变状态。</AlertDescription>
                </Alert>
                <div className='flex items-center justify-between rounded-lg border p-3 text-sm'>
                  <span>允许三类任务日程重叠</span>
                  <Switch
                    checked={plan.allowStageOverlap}
                    disabled={!editable}
                    onCheckedChange={checked => onPlanChange({ ...plan, allowStageOverlap: Boolean(checked) })}
                  />
                </div>
                <ScheduleTable
                  plan={plan}
                  editable={editable}
                  onPlanChange={onPlanChange}
                  onEditNotification={setNotificationStage}
                />
                {plan.issues?.map(issue => (
                  <Alert key={issue.key} variant={issue.ok ? 'default' : 'destructive'}>
                    <AlertTriangleIcon />
                    <AlertDescription>{issue.message}</AlertDescription>
                  </Alert>
                ))}
              </div>
            )}

            {currentStep === 'checks' && (
              <div className='flex max-w-2xl flex-col gap-3'>
                {checkItems.length === 0 ? (
                  <div className='text-muted-foreground py-12 text-center text-sm'>点击“重新检查”获取最新结果</div>
                ) : (
                  checkItems.map(item => (
                    <div key={item.key} className='flex items-start gap-3 rounded-lg border p-3 text-sm'>
                      {item.ok ? (
                        <CheckCircle2Icon className='mt-0.5 size-4 shrink-0 text-green-600' />
                      ) : (
                        <XCircleIcon className='text-destructive mt-0.5 size-4 shrink-0' />
                      )}
                      <div className='flex flex-1 items-start justify-between gap-3'>
                        <div className='flex flex-col gap-1'>
                          <span className={item.ok ? '' : 'text-destructive'}>{item.message}</span>
                          {!item.ok && item.issues && item.issues.length > 0 && (
                            <ul className='text-destructive list-disc space-y-1 pl-5 text-xs'>
                              {item.issues.map(issue => (
                                <li key={`${issue.code}-${issue.path}-${issue.participantId ?? ''}`}>{issue.message}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                        {!item.ok && item.target && item.actionLabel && (
                          <Button
                            variant='outline'
                            size='sm'
                            onClick={() =>
                              item.target === 'advanced' ? onOpenAdvanced() : goToStep(item.target as CycleSetupStepKey)
                            }
                          >
                            {item.actionLabel}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))
                )}
                <Button variant='outline' className='w-fit' onClick={onRunChecks}>
                  重新检查
                </Button>
              </div>
            )}
          </div>

          <div className='flex flex-wrap items-center justify-between gap-3 border-t pt-4'>
            <Button
              variant='outline'
              disabled={stepIndex === 0}
              onClick={() => goToStep(CYCLE_SETUP_STEPS[Math.max(0, stepIndex - 1)].key)}
            >
              <ChevronLeftIcon />
              上一步
            </Button>

            {currentStep === 'checks' ? (
              <div className='flex flex-wrap gap-2'>
                {status === 'SCHEDULED' ? (
                  <Button variant='outline' disabled={!editable || saving} onClick={onReturnToDraft}>
                    退回草稿
                  </Button>
                ) : (
                  <>
                    <Button variant='outline' disabled={saving} onClick={onSaveDraft}>
                      保存草稿并退出
                    </Button>
                    <Button disabled={!checkOk || !editable || saving} onClick={onSchedule}>
                      {saving && <Loader2Icon className='animate-spin' />}
                      设为待启动
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <Button disabled={saving} onClick={() => void handleNext()}>
                {saving && <Loader2Icon className='animate-spin' />}
                保存并下一步
                <ChevronRightIcon />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={notificationStage != null} onOpenChange={open => !open && setNotificationStage(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑通知</DialogTitle>
            <DialogDescription>通知规则只影响飞书提醒，不改变任务开放和填写权限。</DialogDescription>
          </DialogHeader>
          {notification && (
            <div className='flex flex-col gap-4'>
              <label className='flex items-center justify-between gap-3 rounded-md border p-3 text-sm'>
                任务开放通知
                <Switch
                  checked={notification.taskOpened.enabled}
                  onCheckedChange={checked =>
                    patchNotification({ taskOpened: { ...notification.taskOpened, enabled: Boolean(checked) } })
                  }
                />
              </label>
              <div className='grid gap-3 sm:grid-cols-2'>
                <label className='flex items-center justify-between gap-3 rounded-md border p-3 text-sm'>
                  开放通知抄送 Leader
                  <Switch
                    checked={notification.taskOpened.ccLeader}
                    disabled={!notification.taskOpened.enabled}
                    onCheckedChange={checked =>
                      patchNotification({ taskOpened: { ...notification.taskOpened, ccLeader: Boolean(checked) } })
                    }
                  />
                </label>
                <label className='flex items-center justify-between gap-3 rounded-md border p-3 text-sm'>
                  开放通知抄送 HR
                  <Switch
                    checked={notification.taskOpened.ccHr}
                    disabled={!notification.taskOpened.enabled}
                    onCheckedChange={checked =>
                      patchNotification({ taskOpened: { ...notification.taskOpened, ccHr: Boolean(checked) } })
                    }
                  />
                </label>
              </div>
              <label className='flex items-center justify-between gap-3 rounded-md border p-3 text-sm'>
                填写提醒
                <Switch
                  checked={notification.reminder.enabled}
                  onCheckedChange={checked =>
                    patchNotification({ reminder: { ...notification.reminder, enabled: Boolean(checked) } })
                  }
                />
              </label>
              <div className='grid gap-3 sm:grid-cols-2'>
                <label className='flex items-center justify-between gap-3 rounded-md border p-3 text-sm'>
                  填写提醒抄送 Leader
                  <Switch
                    checked={notification.reminder.ccLeader}
                    disabled={!notification.reminder.enabled}
                    onCheckedChange={checked =>
                      patchNotification({ reminder: { ...notification.reminder, ccLeader: Boolean(checked) } })
                    }
                  />
                </label>
                <label className='flex items-center justify-between gap-3 rounded-md border p-3 text-sm'>
                  填写提醒抄送 HR
                  <Switch
                    checked={notification.reminder.ccHr}
                    disabled={!notification.reminder.enabled}
                    onCheckedChange={checked =>
                      patchNotification({ reminder: { ...notification.reminder, ccHr: Boolean(checked) } })
                    }
                  />
                </label>
              </div>
              <Field className='gap-2'>
                <FieldLabel>提醒频率</FieldLabel>
                <Select
                  value={notification.reminder.frequency.type}
                  items={[
                    { value: 'ONCE_AT_DEADLINE', label: '提醒时间到达时一次' },
                    { value: 'DAILY_AFTER_DEADLINE', label: '提醒时间后每天' },
                    { value: 'EVERY_N_DAYS_AFTER_DEADLINE', label: '提醒时间后每 N 天' }
                  ]}
                  onValueChange={value =>
                    patchNotification({
                      reminder: {
                        ...notification.reminder,
                        frequency:
                          value === 'EVERY_N_DAYS_AFTER_DEADLINE'
                            ? {
                                type: 'EVERY_N_DAYS_AFTER_DEADLINE',
                                intervalDays: notification.reminder.frequency.intervalDays ?? 2
                              }
                            : { type: value as 'ONCE_AT_DEADLINE' | 'DAILY_AFTER_DEADLINE' }
                      }
                    })
                  }
                >
                  <SelectTrigger className='w-full'><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value='ONCE_AT_DEADLINE'>提醒时间到达时一次</SelectItem>
                    <SelectItem value='DAILY_AFTER_DEADLINE'>提醒时间后每天</SelectItem>
                    <SelectItem value='EVERY_N_DAYS_AFTER_DEADLINE'>提醒时间后每 N 天</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setNotificationStage(null)}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reapplyOpen} onOpenChange={open => (open ? setReapplyOpen(true) : closeReapplyDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重新套用模板</DialogTitle>
            <DialogDescription>
              {reapplyStep === 'pick'
                ? '重新套用会把所选已发布模板版本整套复制为本周期新的配置快照。'
                : '当前评估规则或评估维度可能已被手动修改，重新套用将整体覆盖为所选模板版本的快照（日程与通知规则一并重置为模板预设），不做字段级合并。'}
            </DialogDescription>
          </DialogHeader>

          {reapplyStep === 'pick' && (
            <Field className='gap-2'>
              <FieldLabel htmlFor='reapply-config-template-version'>配置模板版本</FieldLabel>
              <Select
                value={reapplyVersionId || null}
                items={templateOptions}
                onValueChange={value => setReapplyVersionId((value as string | null) ?? '')}
              >
                <SelectTrigger id='reapply-config-template-version' aria-label='配置模板版本' className='w-full'>
                  <SelectValue placeholder='请选择已发布配置模板版本' />
                </SelectTrigger>
                <SelectContent>
                  {templateOptions.map(option => (
                    <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                      <span className='flex min-w-0 flex-col items-start'>
                        <span>{option.label}</span>
                        {option.reason && <span className='text-muted-foreground text-xs whitespace-normal'>{option.reason}</span>}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          <DialogFooter>
            {reapplyStep === 'pick' ? (
              <>
                <Button variant='outline' onClick={closeReapplyDialog}>取消</Button>
                <Button disabled={!reapplyVersionId || reapplying} onClick={() => void handleReapplyApply()}>
                  {reapplying && <Loader2Icon className='animate-spin' />}
                  套用
                </Button>
              </>
            ) : (
              <>
                <Button variant='outline' onClick={closeReapplyDialog}>取消</Button>
                <Button variant='destructive' disabled={reapplying} onClick={() => void handleReapplyConfirm()}>
                  {reapplying && <Loader2Icon className='animate-spin' />}
                  确认覆盖
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default CycleSetupEditor
