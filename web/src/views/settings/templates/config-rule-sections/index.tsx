'use client'

import type { PerfJobLevelPrefix } from '@/lib/perf-api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

import {
  ConfigRuleSectionChrome,
  ConfigRuleTable,
  configRuleNestedRowClassName,
  configRuleRowClassName
} from '../config-rule-table'
import {
  LEVEL_OPTIONS,
  MODE_OPTIONS,
  RATING_CONSTRAINT_LABEL,
  RELATIONS,
  SCHEDULE_STAGES,
  SCORE_CONSTRAINT_LABEL,
  STAGE_MODE_ROWS,
  createSectionHelpers,
  type RuleSectionProps
} from './helpers'

const STAGE_GRID = 'grid-cols-[minmax(0,1fr)_12rem]'
const CONSTRAINT_GRID = 'grid-cols-[minmax(0,1.4fr)_6rem_6rem_4.5rem]'
const RELATION_GRID = 'grid-cols-[minmax(0,1fr)_8rem]'
const BINDING_GRID = 'grid-cols-[5rem_minmax(0,1fr)_5rem]'
const SCHEDULE_GRID = 'grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)]'
const NOTIFY_GRID = 'grid-cols-[6rem_4rem_4rem_4rem_minmax(0,1fr)_4rem_4rem]'

/** 阶段结果模式：表头与行共用 STAGE_GRID，左对齐。 */
export const StageModesSection = (props: RuleSectionProps) => {
  const { value, editable } = props
  const { patch } = createSectionHelpers(props)

  return (
    <section className='flex flex-col gap-5'>
      <ConfigRuleSectionChrome
        title='阶段结果模式'
        description='员工自评和 AI 固定直接评级，360°及上级评估仅支持受控加权模式。'
      />
      <ConfigRuleTable
        gridClassName={STAGE_GRID}
        headers={[
          <>
            阶段 <span className='text-destructive'>*</span>
          </>,
          '结果模式'
        ]}
      >
        {STAGE_MODE_ROWS.map(row => (
          <div key={row.key} className={configRuleRowClassName(STAGE_GRID)}>
            <div className='flex min-w-0 items-center gap-2 text-sm'>
              <span className='font-medium'>{row.label}</span>
              {row.fixed && (
                <Badge variant='outline' className='text-[10px]'>
                  固定
                </Badge>
              )}
            </div>
            {row.fixed ? (
              <Input value='直接评级' disabled />
            ) : (
              <Select
                value={value.stageModes[row.key]}
                items={MODE_OPTIONS.map(item => ({ ...item }))}
                disabled={!editable}
                onValueChange={next =>
                  patch({
                    stageModes: {
                      ...value.stageModes,
                      [row.key]: next as 'WEIGHTED_RATING' | 'WEIGHTED_SCORE'
                    }
                  })
                }
              >
                <SelectTrigger
                  aria-label={row.key === 'PEER' ? '360°阶段模式' : '上级评估阶段模式'}
                  className='w-full'
                >
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
            )}
          </div>
        ))}
      </ConfigRuleTable>
    </section>
  )
}

/** 等级约束：两张同构表，启用列左对齐勾选。 */
export const ConstraintsSection = (props: RuleSectionProps) => {
  const { value, editable } = props
  const { patchConstraint } = createSectionHelpers(props)

  return (
    <div className='flex flex-col gap-8'>
      <section className='flex flex-col gap-5'>
        <ConfigRuleSectionChrome
          title='加权评级约束'
          description='核心/任一维度命中指定等级时的强制或封顶规则。'
        />
        <ConfigRuleTable
          gridClassName={CONSTRAINT_GRID}
          headers={['规则', '触发等级', '目标等级', '启用']}
        >
          {value.constraintProfiles.WEIGHTED_RATING.map((constraint, index) => (
            <div key={constraint.type} className={configRuleRowClassName(CONSTRAINT_GRID)}>
              <span className='min-w-0 text-sm font-medium'>
                {RATING_CONSTRAINT_LABEL[constraint.type]}
              </span>
              <Select
                value={constraint.triggerRating}
                items={LEVEL_OPTIONS}
                disabled={!editable || !constraint.enabled}
                onValueChange={next =>
                  patchConstraint('WEIGHTED_RATING', index, {
                    triggerRating: next as (typeof LEVEL_OPTIONS)[number]['value']
                  })
                }
              >
                <SelectTrigger aria-label={`${constraint.type} 触发等级`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEVEL_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={constraint.targetLevel}
                items={LEVEL_OPTIONS}
                disabled={!editable || !constraint.enabled}
                onValueChange={next =>
                  patchConstraint('WEIGHTED_RATING', index, {
                    targetLevel: next as (typeof LEVEL_OPTIONS)[number]['value']
                  })
                }
              >
                <SelectTrigger aria-label={`${constraint.type} 目标等级`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEVEL_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className='flex items-center justify-start'>
                <Checkbox
                  checked={constraint.enabled}
                  disabled={!editable}
                  onCheckedChange={checked =>
                    patchConstraint('WEIGHTED_RATING', index, { enabled: Boolean(checked) })
                  }
                />
              </label>
            </div>
          ))}
        </ConfigRuleTable>
      </section>

      <section className='flex flex-col gap-5'>
        <ConfigRuleSectionChrome
          title='加权评分约束'
          description='核心/任一维度低于阈值时的强制或封顶规则。'
        />
        <ConfigRuleTable
          gridClassName={CONSTRAINT_GRID}
          headers={['规则', '阈值', '目标等级', '启用']}
        >
          {value.constraintProfiles.WEIGHTED_SCORE.map((constraint, index) => (
            <div key={constraint.type} className={configRuleRowClassName(CONSTRAINT_GRID)}>
              <span className='min-w-0 text-sm font-medium'>
                {SCORE_CONSTRAINT_LABEL[constraint.type]}
              </span>
              <Input
                aria-label={`${constraint.type} 阈值`}
                type='number'
                value={constraint.threshold}
                disabled={!editable || !constraint.enabled}
                onChange={event =>
                  patchConstraint('WEIGHTED_SCORE', index, { threshold: event.target.value })
                }
              />
              <Select
                value={constraint.targetLevel}
                items={LEVEL_OPTIONS}
                disabled={!editable || !constraint.enabled}
                onValueChange={next =>
                  patchConstraint('WEIGHTED_SCORE', index, {
                    targetLevel: next as (typeof LEVEL_OPTIONS)[number]['value']
                  })
                }
              >
                <SelectTrigger aria-label={`${constraint.type} 目标等级`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEVEL_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className='flex items-center justify-start'>
                <Checkbox
                  checked={constraint.enabled}
                  disabled={!editable}
                  onCheckedChange={checked =>
                    patchConstraint('WEIGHTED_SCORE', index, { enabled: Boolean(checked) })
                  }
                />
              </label>
            </div>
          ))}
        </ConfigRuleTable>
      </section>

      <p className='text-muted-foreground text-sm'>
        红线强制 C 为系统硬约束，不允许在模板中关闭或修改。
      </p>
    </div>
  )
}

export const RelationsSection = (props: RuleSectionProps) => {
  const { value, editable } = props
  const { patch, relationSummary } = createSectionHelpers(props)

  return (
    <section className='flex flex-col gap-5'>
      <ConfigRuleSectionChrome
        title='360°关系基础权重'
        description='四项均需大于 0、最多两位小数，并严格合计 100%。'
        trailing={
          <Badge variant={relationSummary.valid ? 'default' : 'destructive'}>
            合计 {relationSummary.total}% · 差额 {relationSummary.difference}%
          </Badge>
        }
      />
      <ConfigRuleTable
        gridClassName={RELATION_GRID}
        headers={[
          <>
            关系类型 <span className='text-destructive'>*</span>
          </>,
          '权重 %'
        ]}
      >
        {RELATIONS.map(relation => (
          <div key={relation.value} className={configRuleRowClassName(RELATION_GRID)}>
            <span className='min-w-0 text-sm font-medium'>{relation.label}</span>
            <Input
              type='number'
              min='0.01'
              max='100'
              step='0.01'
              value={value.reviewerRelationWeights[relation.value]}
              disabled={!editable}
              onChange={event =>
                patch({
                  reviewerRelationWeights: {
                    ...value.reviewerRelationWeights,
                    [relation.value]: event.target.value
                  }
                })
              }
            />
          </div>
        ))}
      </ConfigRuleTable>
    </section>
  )
}

export const BindingsSection = (props: RuleSectionProps) => {
  const { editable } = props
  const { setBinding, bindingOptions } = createSectionHelpers(props)

  return (
    <section className='flex flex-col gap-5'>
      <ConfigRuleSectionChrome
        title='D/M 评估表单版本'
        description='仅可绑定同职级前缀的已发布版本，配置模板不会自动跟随表单最新版。'
      />
      <ConfigRuleTable
        gridClassName={BINDING_GRID}
        headers={['职级', '已发布表单版本', '操作']}
      >
        {(['D', 'M'] as PerfJobLevelPrefix[]).map(prefix => {
          const { currentBinding, expandedCurrent, options, selected, selectableValue } =
            bindingOptions(prefix)

          return (
            <div key={prefix} className='flex flex-col gap-2 px-3 py-2.5'>
              <div className={configRuleNestedRowClassName(BINDING_GRID)}>
                <span className='font-semibold'>{prefix}</span>
                {!editable && currentBinding ? (
                  <div className='flex min-w-0 flex-wrap items-center gap-2 text-sm'>
                    <span className='font-medium'>
                      {expandedCurrent
                        ? `${expandedCurrent.name} · v${expandedCurrent.version}`
                        : `版本 #${currentBinding.formTemplateVersionId}`}
                    </span>
                    <Badge variant='outline'>
                      {currentBinding.status ?? expandedCurrent?.status ?? 'PUBLISHED'}
                    </Badge>
                  </div>
                ) : options.length > 0 ? (
                  <Select
                    value={selectableValue}
                    items={options.map(option => ({
                      value: String(option.id),
                      label: `${option.name} · v${option.version}`
                    }))}
                    disabled={!editable}
                    onValueChange={next => setBinding(prefix, Number(next))}
                  >
                    <SelectTrigger aria-label={`${prefix} 职级表单版本`} className='w-full'>
                      <SelectValue placeholder='请选择已发布版本' />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map(option => (
                        <SelectItem key={option.id} value={String(option.id)}>
                          {option.name} · v{option.version}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className='text-destructive text-sm'>暂无可用的 {prefix} 已发布表单版本</p>
                )}
                {selected && editable ? (
                  <Button variant='ghost' size='sm' className='justify-start' onClick={() => setBinding(prefix)}>
                    清除
                  </Button>
                ) : (
                  <span />
                )}
              </div>
              {editable && selected && !selectableValue && (
                <p className='text-amber-600 text-xs'>
                  当前绑定版本 #{selected} 已不在可选列表，请改选新的已发布版本。
                </p>
              )}
            </div>
          )
        })}
      </ConfigRuleTable>
    </section>
  )
}

export const ScheduleSection = (props: RuleSectionProps) => {
  const { value, editable } = props
  const {
    patch,
    scheduleFor,
    patchSchedule,
    notificationFor,
    patchNotification,
    buildReminderFrequency
  } = createSectionHelpers(props)

  return (
    <div className='flex flex-col gap-8'>
      <section className='flex flex-col gap-5'>
        <ConfigRuleSectionChrome
          title='相对日程'
          description='相对周期开始时间的分钟偏移；提醒截止不会关闭填写入口。'
          trailing={
            <label className='flex items-center gap-2 text-sm'>
              <Checkbox
                checked={value.schedulePreset.allowStageOverlap}
                disabled={!editable}
                onCheckedChange={checked =>
                  patch({
                    schedulePreset: {
                      ...value.schedulePreset,
                      allowStageOverlap: Boolean(checked)
                    }
                  })
                }
              />
              允许阶段重叠
            </label>
          }
        />
        <ConfigRuleTable
          gridClassName={SCHEDULE_GRID}
          headers={['阶段', '开始偏移（分钟）', '提醒截止偏移（分钟）']}
        >
          {SCHEDULE_STAGES.map(stage => {
            const schedule = scheduleFor(stage.value)

            return (
              <div key={stage.value} className={configRuleRowClassName(SCHEDULE_GRID)}>
                <span className='text-sm font-medium'>{stage.label}</span>
                <Input
                  type='number'
                  min={0}
                  value={schedule.startOffsetMinutes}
                  disabled={!editable}
                  onChange={event =>
                    patchSchedule(stage.value, {
                      startOffsetMinutes: Number(event.target.value)
                    })
                  }
                />
                <Input
                  type='number'
                  min={0}
                  value={schedule.reminderDeadlineOffsetMinutes}
                  disabled={!editable}
                  onChange={event =>
                    patchSchedule(stage.value, {
                      reminderDeadlineOffsetMinutes: Number(event.target.value)
                    })
                  }
                />
              </div>
            )
          })}
        </ConfigRuleTable>
      </section>

      <section className='flex flex-col gap-5'>
        <ConfigRuleSectionChrome
          title='飞书通知'
          description='各阶段任务开放与填写提醒；抄送对象按行勾选。'
        />
        <ConfigRuleTable
          gridClassName={NOTIFY_GRID}
          headers={['阶段', '开放', '抄送L', '抄送H', '提醒频率', '提醒L', '提醒H']}
        >
          {SCHEDULE_STAGES.map(stage => {
            const notification = notificationFor(stage.value)

            return (
              <div key={stage.value} className='flex flex-col gap-2 px-3 py-2.5'>
                <div className={configRuleNestedRowClassName(NOTIFY_GRID)}>
                  <span className='text-sm font-medium'>{stage.label}</span>
                  <label className='flex items-center justify-start'>
                    <Checkbox
                      checked={notification.taskOpened.enabled}
                      disabled={!editable}
                      onCheckedChange={checked =>
                        patchNotification(stage.value, {
                          taskOpened: {
                            ...notification.taskOpened,
                            enabled: Boolean(checked)
                          }
                        })
                      }
                    />
                  </label>
                  <label className='flex items-center justify-start'>
                    <Checkbox
                      checked={notification.taskOpened.ccLeader}
                      disabled={!editable || !notification.taskOpened.enabled}
                      onCheckedChange={checked =>
                        patchNotification(stage.value, {
                          taskOpened: {
                            ...notification.taskOpened,
                            ccLeader: Boolean(checked)
                          }
                        })
                      }
                    />
                  </label>
                  <label className='flex items-center justify-start'>
                    <Checkbox
                      checked={notification.taskOpened.ccHr}
                      disabled={!editable || !notification.taskOpened.enabled}
                      onCheckedChange={checked =>
                        patchNotification(stage.value, {
                          taskOpened: {
                            ...notification.taskOpened,
                            ccHr: Boolean(checked)
                          }
                        })
                      }
                    />
                  </label>
                  <Select
                    value={
                      notification.reminder.enabled
                        ? notification.reminder.frequency.type
                        : '__OFF__'
                    }
                    items={[
                      { value: '__OFF__', label: '关闭提醒' },
                      { value: 'ONCE_AT_DEADLINE', label: '截止时一次' },
                      { value: 'DAILY_AFTER_DEADLINE', label: '截止后每天' },
                      { value: 'EVERY_N_DAYS_AFTER_DEADLINE', label: '截止后每 N 天' }
                    ]}
                    disabled={!editable}
                    onValueChange={next => {
                      if (next === '__OFF__') {
                        patchNotification(stage.value, {
                          reminder: { ...notification.reminder, enabled: false }
                        })

                        return
                      }

                      patchNotification(stage.value, {
                        reminder: {
                          ...notification.reminder,
                          enabled: true,
                          frequency: buildReminderFrequency(
                            next as typeof notification.reminder.frequency.type,
                            notification.reminder.frequency.intervalDays
                          )
                        }
                      })
                    }}
                  >
                    <SelectTrigger aria-label={`${stage.label}提醒频率`} className='w-full'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='__OFF__'>关闭提醒</SelectItem>
                      <SelectItem value='ONCE_AT_DEADLINE'>截止时一次</SelectItem>
                      <SelectItem value='DAILY_AFTER_DEADLINE'>截止后每天</SelectItem>
                      <SelectItem value='EVERY_N_DAYS_AFTER_DEADLINE'>截止后每 N 天</SelectItem>
                    </SelectContent>
                  </Select>
                  <label className='flex items-center justify-start'>
                    <Checkbox
                      checked={notification.reminder.ccLeader}
                      disabled={!editable || !notification.reminder.enabled}
                      onCheckedChange={checked =>
                        patchNotification(stage.value, {
                          reminder: {
                            ...notification.reminder,
                            ccLeader: Boolean(checked)
                          }
                        })
                      }
                    />
                  </label>
                  <label className='flex items-center justify-start'>
                    <Checkbox
                      checked={notification.reminder.ccHr}
                      disabled={!editable || !notification.reminder.enabled}
                      onCheckedChange={checked =>
                        patchNotification(stage.value, {
                          reminder: {
                            ...notification.reminder,
                            ccHr: Boolean(checked)
                          }
                        })
                      }
                    />
                  </label>
                </div>
                {notification.reminder.enabled &&
                  notification.reminder.frequency.type === 'EVERY_N_DAYS_AFTER_DEADLINE' && (
                    <Input
                      aria-label={`${stage.label}提醒间隔天数`}
                      type='number'
                      min={1}
                      className='text-muted-foreground h-8 border-dashed text-xs'
                      value={notification.reminder.frequency.intervalDays ?? 1}
                      disabled={!editable}
                      placeholder='间隔天数'
                      onChange={event =>
                        patchNotification(stage.value, {
                          reminder: {
                            ...notification.reminder,
                            frequency: {
                              ...notification.reminder.frequency,
                              intervalDays: Number(event.target.value)
                            }
                          }
                        })
                      }
                    />
                  )}
              </div>
            )
          })}
        </ConfigRuleTable>
      </section>
    </div>
  )
}
