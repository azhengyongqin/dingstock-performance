'use client'

import { useState } from 'react'

import type {
  PerfConfigConstraintProfiles,
  PerfConfigReviewerRelation,
  PerfConfigScheduleStage,
  PerfConfigTemplateVersion,
  PerfFormTemplateVersionSummary,
  PerfJobLevelPrefix,
  PerfPerformanceLevel
} from '@/lib/perf-api'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

import type { ConfigTemplateSection } from './config-template-utils'
import {
  buildReminderFrequency,
  filterPublishedFormCandidates,
  replaceFormBindingForPrefix,
  summarizeReviewerRelationWeights
} from './config-template-utils'

const MODE_OPTIONS = [
  { value: 'WEIGHTED_RATING', label: '加权评级' },
  { value: 'WEIGHTED_SCORE', label: '加权评分' }
] as const

const LEVEL_OPTIONS: Array<{ value: PerfPerformanceLevel; label: PerfPerformanceLevel }> = ['S', 'A', 'B', 'C'].map(
  value => ({ value: value as PerfPerformanceLevel, label: value as PerfPerformanceLevel })
)

const RELATIONS: Array<{ value: PerfConfigReviewerRelation; label: string }> = [
  { value: 'ORG_OWNER', label: '组织负责人' },
  { value: 'PROJECT_OWNER', label: '项目负责人' },
  { value: 'PEER', label: '同部门同事' },
  { value: 'CROSS_DEPT', label: '跨部门协作方' }
]

const SCHEDULE_STAGES: Array<{ value: PerfConfigScheduleStage; label: string }> = [
  { value: 'SELF', label: '员工自评' },
  { value: 'PEER', label: '360°评估' },
  { value: 'MANAGER', label: '上级评估' }
]

const RATING_CONSTRAINT_LABEL: Record<string, string> = {
  CORE_RATING_FORCE: '核心维度命中等级时强制定级',
  CORE_RATING_CAP: '核心维度命中等级时封顶',
  ANY_RATING_CAP: '任一维度命中等级时封顶'
}

const SCORE_CONSTRAINT_LABEL: Record<string, string> = {
  CORE_SCORE_FORCE: '核心维度低于阈值时强制定级',
  CORE_SCORE_CAP: '核心维度低于阈值时封顶',
  ANY_SCORE_CAP: '任一维度低于阈值时封顶'
}

type Props = {
  value: PerfConfigTemplateVersion
  candidates: PerfFormTemplateVersionSummary[]
  editable: boolean
  onChange: (value: PerfConfigTemplateVersion) => void
  section?: ConfigTemplateSection
  onSectionChange?: (section: ConfigTemplateSection) => void
  visibleSections?: ConfigTemplateSection[]
}

const CONFIG_SECTIONS: Array<{ value: ConfigTemplateSection; label: string }> = [
  { value: 'ratings', label: '评级与模式' },
  { value: 'constraints', label: '等级约束' },
  { value: 'relations', label: '关系权重' },
  { value: 'bindings', label: '表单绑定' },
  { value: 'schedule', label: '日程通知' }
]

/** 配置模板草稿编辑器：所有可变项均来自固定枚举，不接受公式、脚本或自由扩展评级。 */
const ConfigTemplateEditor = ({
  value,
  candidates,
  editable,
  onChange,
  section = 'ratings',
  onSectionChange,
  visibleSections = CONFIG_SECTIONS.map(item => item.value)
}: Props) => {
  const [internalSection, setInternalSection] = useState<ConfigTemplateSection>(section)
  const requestedSection = onSectionChange ? section : internalSection
  const activeSection = visibleSections.includes(requestedSection) ? requestedSection : (visibleSections[0] ?? 'ratings')
  const patch = (next: Partial<PerfConfigTemplateVersion>) => onChange({ ...value, ...next })

  const patchRating = (symbol: PerfPerformanceLevel, next: Partial<(typeof value.ratings)[number]>) =>
    patch({ ratings: value.ratings.map(rating => (rating.symbol === symbol ? { ...rating, ...next } : rating)) })

  const patchConstraint = <K extends keyof PerfConfigConstraintProfiles>(
    profile: K,
    index: number,
    next: Partial<PerfConfigConstraintProfiles[K][number]>
  ) =>
    patch({
      constraintProfiles: {
        ...value.constraintProfiles,
        [profile]: value.constraintProfiles[profile].map((constraint, itemIndex) =>
          itemIndex === index ? { ...constraint, ...next } : constraint
        )
      } as PerfConfigConstraintProfiles
    })

  const selectedBinding = (prefix: PerfJobLevelPrefix) => {
    const expanded = value.formBindings?.find(binding => binding.jobLevelPrefix === prefix)?.formTemplateVersionId

    const selectedFromIds = value.formTemplateVersionIds.find(
      id => candidates.find(item => item.id === id)?.jobLevelPrefix === prefix
    )

    if (selectedFromIds) return selectedFromIds
    if (editable) return expanded && value.formTemplateVersionIds.includes(expanded) ? expanded : undefined
    if (expanded) return expanded

    return undefined
  }

  const setBinding = (prefix: PerfJobLevelPrefix, versionId?: number) => {
    patch({
      formTemplateVersionIds: replaceFormBindingForPrefix({
        currentIds: value.formTemplateVersionIds,
        bindings: value.formBindings ?? [],
        candidates,
        prefix,
        nextId: versionId
      })
    })
  }

  const relationSummary = summarizeReviewerRelationWeights(value.reviewerRelationWeights)

  const scheduleFor = (stage: PerfConfigScheduleStage) =>
    value.schedulePreset.stages.find(item => item.stage === stage) ?? {
      stage,
      startOffsetMinutes: 0,
      reminderDeadlineOffsetMinutes: 0
    }

  const patchSchedule = (stage: PerfConfigScheduleStage, next: Partial<ReturnType<typeof scheduleFor>>) =>
    patch({
      schedulePreset: {
        ...value.schedulePreset,
        stages: SCHEDULE_STAGES.map(item => {
          const current = scheduleFor(item.value)

          return item.value === stage ? { ...current, ...next } : current
        })
      }
    })

  const notificationFor = (stage: PerfConfigScheduleStage) =>
    value.notificationRules.stages.find(item => item.stage === stage) ?? {
      stage,
      taskOpened: { enabled: true, recipient: 'ASSIGNEE' as const, ccLeader: false, ccHr: false },
      reminder: {
        enabled: true,
        recipient: 'ASSIGNEE' as const,
        ccLeader: false,
        ccHr: false,
        frequency: { type: 'ONCE_AT_DEADLINE' as const }
      }
    }

  const patchNotification = (
    stage: PerfConfigScheduleStage,
    next: Partial<ReturnType<typeof notificationFor>>
  ) =>
    patch({
      notificationRules: {
        stages: SCHEDULE_STAGES.map(item => {
          const current = notificationFor(item.value)

          return item.value === stage ? { ...current, ...next } : current
        })
      }
    })

  return (
    <Tabs
      value={activeSection}
      onValueChange={next => {
        const nextSection = next as ConfigTemplateSection

        setInternalSection(nextSection)
        onSectionChange?.(nextSection)
      }}
      className='flex flex-col gap-4'
    >
      <TabsList className='h-auto flex-wrap justify-start'>
        {CONFIG_SECTIONS.filter(item => visibleSections.includes(item.value)).map(item => (
          <TabsTrigger key={item.value} value={item.value}>{item.label}</TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value='ratings' className='flex flex-col gap-6'>
        <section className='flex flex-col gap-3'>
          <div>
            <h3 className='font-medium'>阶段结果模式</h3>
            <p className='text-muted-foreground text-sm'>员工自评和 AI 固定直接评级，360°及上级评估仅支持受控加权模式。</p>
          </div>
          <div className='grid gap-4 md:grid-cols-2'>
            <Field className='gap-2'>
              <FieldLabel>员工自评（固定）</FieldLabel>
              <Input value='直接评级' disabled />
            </Field>
            <Field className='gap-2'>
              <FieldLabel>AI 评估（固定）</FieldLabel>
              <Input value='直接评级' disabled />
            </Field>
            <Field className='gap-2'>
              <FieldLabel>360°阶段模式</FieldLabel>
              <Select
                value={value.stageModes.PEER}
                items={MODE_OPTIONS.map(item => ({ ...item }))}
                disabled={!editable}
                onValueChange={next =>
                  patch({ stageModes: { ...value.stageModes, PEER: next as 'WEIGHTED_RATING' | 'WEIGHTED_SCORE' } })
                }
              >
                <SelectTrigger aria-label='360°阶段模式' className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODE_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field className='gap-2'>
              <FieldLabel>上级评估阶段模式</FieldLabel>
              <Select
                value={value.stageModes.MANAGER}
                items={MODE_OPTIONS.map(item => ({ ...item }))}
                disabled={!editable}
                onValueChange={next =>
                  patch({
                    stageModes: { ...value.stageModes, MANAGER: next as 'WEIGHTED_RATING' | 'WEIGHTED_SCORE' }
                  })
                }
              >
                <SelectTrigger aria-label='上级评估阶段模式' className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODE_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </section>

        <section className='flex flex-col gap-3'>
          <div>
            <h3 className='font-medium'>S/A/B/C 评级</h3>
            <p className='text-muted-foreground text-sm'>符号和顺序固定；区间必须连续覆盖 0～100，映射分需落在所属区间。</p>
          </div>
          <div className='flex flex-col gap-3'>
            {(['S', 'A', 'B', 'C'] as PerfPerformanceLevel[]).map(symbol => {
              const rating = value.ratings.find(item => item.symbol === symbol)

              if (!rating) return <div key={symbol} className='text-destructive rounded-md border p-3 text-sm'>缺少 {symbol} 评级</div>

              return (
                <div key={symbol} className='grid gap-3 rounded-lg border p-4 lg:grid-cols-[4rem_1fr_6rem_6rem_6rem_7rem]'>
                  <div className='flex items-center'><Badge className='text-base'>{symbol}</Badge></div>
                  <Field className='gap-1'>
                    <FieldLabel>名称</FieldLabel>
                    <Input value={rating.name} disabled={!editable} onChange={event => patchRating(symbol, { name: event.target.value })} />
                  </Field>
                  <Field className='gap-1'>
                    <FieldLabel>下限</FieldLabel>
                    <Input type='number' value={rating.minScore} disabled={!editable} onChange={event => patchRating(symbol, { minScore: event.target.value })} />
                  </Field>
                  <Field className='gap-1'>
                    <FieldLabel>上限</FieldLabel>
                    <Input type='number' value={rating.maxScore} disabled={!editable} onChange={event => patchRating(symbol, { maxScore: event.target.value })} />
                  </Field>
                  <Field className='gap-1'>
                    <FieldLabel>映射分</FieldLabel>
                    <Input type='number' value={rating.mappingScore} disabled={!editable} onChange={event => patchRating(symbol, { mappingScore: event.target.value })} />
                  </Field>
                  <label className='flex items-center gap-2 self-end pb-2 text-sm'>
                    <Switch checked={rating.commentRequired} disabled={!editable} onCheckedChange={checked => patchRating(symbol, { commentRequired: Boolean(checked) })} />
                    评语必填
                  </label>
                  <Field className='gap-1 lg:col-start-2 lg:col-end-7'>
                    <FieldLabel>说明</FieldLabel>
                    <Textarea value={rating.description ?? ''} disabled={!editable} onChange={event => patchRating(symbol, { description: event.target.value })} />
                  </Field>
                </div>
              )
            })}
          </div>
        </section>
      </TabsContent>

      <TabsContent value='constraints' className='grid gap-6 xl:grid-cols-2'>
        <ConstraintCard title='加权评级约束'>
          {value.constraintProfiles.WEIGHTED_RATING.map((constraint, index) => (
            <div key={constraint.type} className='grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_7rem_7rem_auto]'>
              <div className='text-sm font-medium'>{RATING_CONSTRAINT_LABEL[constraint.type]}</div>
              <Select
                value={constraint.triggerRating}
                items={LEVEL_OPTIONS}
                disabled={!editable || !constraint.enabled}
                onValueChange={next => patchConstraint('WEIGHTED_RATING', index, { triggerRating: next as PerfPerformanceLevel })}
              >
                <SelectTrigger aria-label={`${constraint.type} 触发等级`}><SelectValue /></SelectTrigger>
                <SelectContent>{LEVEL_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
              <Select
                value={constraint.targetLevel}
                items={LEVEL_OPTIONS}
                disabled={!editable || !constraint.enabled}
                onValueChange={next => patchConstraint('WEIGHTED_RATING', index, { targetLevel: next as PerfPerformanceLevel })}
              >
                <SelectTrigger aria-label={`${constraint.type} 目标等级`}><SelectValue /></SelectTrigger>
                <SelectContent>{LEVEL_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
              <Switch checked={constraint.enabled} disabled={!editable} onCheckedChange={checked => patchConstraint('WEIGHTED_RATING', index, { enabled: Boolean(checked) })} />
            </div>
          ))}
        </ConstraintCard>
        <ConstraintCard title='加权评分约束'>
          {value.constraintProfiles.WEIGHTED_SCORE.map((constraint, index) => (
            <div key={constraint.type} className='grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_7rem_7rem_auto]'>
              <div className='text-sm font-medium'>{SCORE_CONSTRAINT_LABEL[constraint.type]}</div>
              <Input
                aria-label={`${constraint.type} 阈值`}
                type='number'
                value={constraint.threshold}
                disabled={!editable || !constraint.enabled}
                onChange={event => patchConstraint('WEIGHTED_SCORE', index, { threshold: event.target.value })}
              />
              <Select
                value={constraint.targetLevel}
                items={LEVEL_OPTIONS}
                disabled={!editable || !constraint.enabled}
                onValueChange={next => patchConstraint('WEIGHTED_SCORE', index, { targetLevel: next as PerfPerformanceLevel })}
              >
                <SelectTrigger aria-label={`${constraint.type} 目标等级`}><SelectValue /></SelectTrigger>
                <SelectContent>{LEVEL_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
              <Switch checked={constraint.enabled} disabled={!editable} onCheckedChange={checked => patchConstraint('WEIGHTED_SCORE', index, { enabled: Boolean(checked) })} />
            </div>
          ))}
        </ConstraintCard>
        <p className='text-muted-foreground text-sm xl:col-span-2'>红线强制 C 为系统硬约束，不允许在模板中关闭或修改。</p>
      </TabsContent>

      <TabsContent value='relations' className='flex flex-col gap-4'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div>
            <h3 className='font-medium'>360°关系基础权重</h3>
            <p className='text-muted-foreground text-sm'>四项均需大于 0、最多两位小数，并严格合计 100%。</p>
          </div>
          <Badge variant={relationSummary.valid ? 'default' : 'destructive'}>
            合计 {relationSummary.total}% · 差额 {relationSummary.difference}%
          </Badge>
        </div>
        <div className='grid gap-4 md:grid-cols-2'>
          {RELATIONS.map(relation => (
            <Field key={relation.value} className='gap-2'>
              <FieldLabel>{relation.label}</FieldLabel>
              <Input
                type='number'
                min='0.01'
                max='100'
                step='0.01'
                value={value.reviewerRelationWeights[relation.value]}
                disabled={!editable}
                onChange={event =>
                  patch({
                    reviewerRelationWeights: { ...value.reviewerRelationWeights, [relation.value]: event.target.value }
                  })
                }
              />
            </Field>
          ))}
        </div>
      </TabsContent>

      <TabsContent value='bindings' className='flex flex-col gap-4'>
        <div>
          <h3 className='font-medium'>D/M 评估表单版本</h3>
          <p className='text-muted-foreground text-sm'>仅可绑定同职级前缀的已发布版本，配置模板不会自动跟随表单最新版。</p>
        </div>
        <div className='grid gap-4 md:grid-cols-2'>
          {(['D', 'M'] as PerfJobLevelPrefix[]).map(prefix => {
            const currentBinding = value.formBindings?.find(binding => binding.jobLevelPrefix === prefix)
            const publishedOptions = filterPublishedFormCandidates(candidates, prefix)
            const expandedCurrent = currentBinding?.formTemplateVersion

            const options =
              expandedCurrent && !publishedOptions.some(option => option.id === expandedCurrent.id)
                ? [...publishedOptions, expandedCurrent]
                : publishedOptions

            const selected = selectedBinding(prefix)
            const selectableValue = selected && options.some(option => option.id === selected) ? String(selected) : undefined

            return (
              <Field key={prefix} className='gap-2 rounded-lg border p-4'>
                <FieldLabel>{prefix} 职级表单版本</FieldLabel>
                {!editable && currentBinding ? (
                  <div className='flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm'>
                    <span className='font-medium'>
                      {expandedCurrent ? `${expandedCurrent.name} · v${expandedCurrent.version}` : `版本 #${currentBinding.formTemplateVersionId}`}
                    </span>
                    <Badge variant='outline'>{currentBinding.status ?? expandedCurrent?.status ?? 'PUBLISHED'}</Badge>
                  </div>
                ) : options.length > 0 ? (
                  <Select
                    value={selectableValue}
                    items={options.map(option => ({ value: String(option.id), label: `${option.name} · v${option.version}` }))}
                    disabled={!editable}
                    onValueChange={next => setBinding(prefix, Number(next))}
                  >
                    <SelectTrigger aria-label={`${prefix} 职级表单版本`} className='w-full'>
                      <SelectValue placeholder='请选择已发布版本' />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map(option => (
                        <SelectItem key={option.id} value={String(option.id)}>{option.name} · v{option.version}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className='text-destructive text-sm'>暂无可用的 {prefix} 已发布表单版本</p>
                )}
                {editable && selected && !selectableValue && (
                  <p className='text-amber-600 text-sm'>当前绑定版本 #{selected} 已不在可选列表，请改选新的已发布版本。</p>
                )}
                {selected && editable && <Button variant='ghost' size='sm' className='self-start' onClick={() => setBinding(prefix)}>清除绑定</Button>}
              </Field>
            )
          })}
        </div>
      </TabsContent>

      <TabsContent value='schedule' className='flex flex-col gap-6'>
        <section className='flex flex-col gap-4'>
          <label className='flex items-center justify-between rounded-lg border p-4 text-sm font-medium'>
            允许评估阶段时间重叠
            <Switch
              checked={value.schedulePreset.allowStageOverlap}
              disabled={!editable}
              onCheckedChange={checked => patch({ schedulePreset: { ...value.schedulePreset, allowStageOverlap: Boolean(checked) } })}
            />
          </label>
          <div className='grid gap-3'>
            {SCHEDULE_STAGES.map(stage => {
              const schedule = scheduleFor(stage.value)

              return (
              <div key={stage.value} className='grid gap-3 rounded-lg border p-4 md:grid-cols-[1fr_1fr_1fr]'>
                <div className='font-medium'>{stage.label}</div>
                <Field className='gap-1'>
                  <FieldLabel>开始偏移（分钟）</FieldLabel>
                  <Input
                    type='number'
                    min={0}
                    value={schedule.startOffsetMinutes}
                    disabled={!editable}
                    onChange={event => patchSchedule(stage.value, { startOffsetMinutes: Number(event.target.value) })}
                  />
                </Field>
                <Field className='gap-1'>
                  <FieldLabel>提醒截止偏移（分钟）</FieldLabel>
                  <Input
                    type='number'
                    min={0}
                    value={schedule.reminderDeadlineOffsetMinutes}
                    disabled={!editable}
                    onChange={event =>
                      patchSchedule(stage.value, { reminderDeadlineOffsetMinutes: Number(event.target.value) })
                    }
                  />
                  <FieldDescription>仅用于提醒，不会关闭填写入口。</FieldDescription>
                </Field>
              </div>
              )
            })}
          </div>
        </section>

        <section className='flex flex-col gap-4'>
          <div className='grid gap-4'>
            {SCHEDULE_STAGES.map(stage => {
              const notification = notificationFor(stage.value)

              return (
                <div key={stage.value} className='grid gap-4 rounded-lg border p-4 lg:grid-cols-2'>
                  <h4 className='font-medium lg:col-span-2'>{stage.label}</h4>
                  <div className='flex flex-col gap-3 rounded-md border p-3'>
                    <label className='flex items-center justify-between text-sm font-medium'>任务开放通知<Switch checked={notification.taskOpened.enabled} disabled={!editable} onCheckedChange={checked => patchNotification(stage.value, { taskOpened: { ...notification.taskOpened, enabled: Boolean(checked) } })} /></label>
                    <label className='flex items-center justify-between text-sm'>抄送 Leader<Switch checked={notification.taskOpened.ccLeader} disabled={!editable || !notification.taskOpened.enabled} onCheckedChange={checked => patchNotification(stage.value, { taskOpened: { ...notification.taskOpened, ccLeader: Boolean(checked) } })} /></label>
                    <label className='flex items-center justify-between text-sm'>抄送 HR<Switch checked={notification.taskOpened.ccHr} disabled={!editable || !notification.taskOpened.enabled} onCheckedChange={checked => patchNotification(stage.value, { taskOpened: { ...notification.taskOpened, ccHr: Boolean(checked) } })} /></label>
                  </div>
                  <div className='flex flex-col gap-3 rounded-md border p-3'>
                    <label className='flex items-center justify-between text-sm font-medium'>填写提醒<Switch checked={notification.reminder.enabled} disabled={!editable} onCheckedChange={checked => patchNotification(stage.value, { reminder: { ...notification.reminder, enabled: Boolean(checked) } })} /></label>
                    <Select
                      value={notification.reminder.frequency.type}
                      items={[{ value: 'ONCE_AT_DEADLINE', label: '截止时一次' }, { value: 'DAILY_AFTER_DEADLINE', label: '截止后每天' }, { value: 'EVERY_N_DAYS_AFTER_DEADLINE', label: '截止后每 N 天' }]}
                      disabled={!editable || !notification.reminder.enabled}
                      onValueChange={next =>
                        patchNotification(stage.value, {
                          reminder: {
                            ...notification.reminder,
                            frequency: buildReminderFrequency(
                              next as typeof notification.reminder.frequency.type,
                              notification.reminder.frequency.intervalDays
                            )
                          }
                        })
                      }
                    >
                      <SelectTrigger aria-label={`${stage.label}提醒频率`}><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value='ONCE_AT_DEADLINE'>截止时一次</SelectItem><SelectItem value='DAILY_AFTER_DEADLINE'>截止后每天</SelectItem><SelectItem value='EVERY_N_DAYS_AFTER_DEADLINE'>截止后每 N 天</SelectItem></SelectContent>
                    </Select>
                    {notification.reminder.frequency.type === 'EVERY_N_DAYS_AFTER_DEADLINE' && <Input aria-label={`${stage.label}提醒间隔天数`} type='number' min={1} value={notification.reminder.frequency.intervalDays ?? 1} disabled={!editable || !notification.reminder.enabled} onChange={event => patchNotification(stage.value, { reminder: { ...notification.reminder, frequency: { ...notification.reminder.frequency, intervalDays: Number(event.target.value) } } })} />}
                    <div className='flex gap-4'>
                      <label className='flex items-center gap-2 text-sm'>抄送 Leader<Switch checked={notification.reminder.ccLeader} disabled={!editable || !notification.reminder.enabled} onCheckedChange={checked => patchNotification(stage.value, { reminder: { ...notification.reminder, ccLeader: Boolean(checked) } })} /></label>
                      <label className='flex items-center gap-2 text-sm'>抄送 HR<Switch checked={notification.reminder.ccHr} disabled={!editable || !notification.reminder.enabled} onCheckedChange={checked => patchNotification(stage.value, { reminder: { ...notification.reminder, ccHr: Boolean(checked) } })} /></label>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </TabsContent>
    </Tabs>
  )
}

const ConstraintCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className='flex flex-col gap-3'>
    <h3 className='font-medium'>{title}</h3>
    {children}
  </section>
)

export default ConfigTemplateEditor
