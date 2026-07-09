'use client'

// React Imports
import { useMemo, useState } from 'react'

// Third-party Imports
import { PlusIcon, Trash2Icon } from 'lucide-react'

// Component Imports
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// Util Imports
import { cn } from '@/lib/utils'

import type { DimensionDraft } from './types'
import {
  DIMENSION_TYPES,
  DIMENSION_TYPE_LABEL,
  EDITABLE_ROLES,
  EMPTY_DIMENSION,
  ROLE_LABEL,
  SCORING_METHODS,
  SCORING_METHOD_LABEL,
  summarizeWeights
} from './types'

/**
 * 评估维度编辑区：按「岗位分组」分组展示（全员通用在前），组头带权重小计；
 * 维度默认收起为一行摘要，点击展开为行内表单编辑（无弹窗）。
 */
const DimensionSection = ({
  dimensions,
  onChange
}: {
  dimensions: DimensionDraft[]
  onChange: (next: DimensionDraft[]) => void
}) => {
  // 展开编辑中的维度下标（相对完整 dimensions 数组），null 表示全部收起
  const [expanded, setExpanded] = useState<number | null>(null)

  const weightSummary = useMemo(() => summarizeWeights(dimensions), [dimensions])

  // 分组：全员（jobCategory 为空）在前，其余按分组名排序；保留原数组下标用于写回
  const groups = useMemo(() => {
    const map = new Map<string, { dim: DimensionDraft; index: number }[]>()

    for (const [index, dim] of dimensions.entries()) {
      const key = dim.jobCategory || ''
      const list = map.get(key) ?? []

      list.push({ dim, index })
      map.set(key, list)
    }

    return [...map.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
  }, [dimensions])

  const patchAt = (index: number, patch: Partial<DimensionDraft>) =>
    onChange(dimensions.map((item, i) => (i === index ? { ...item, ...patch } : item)))

  const removeAt = (index: number) => {
    onChange(dimensions.filter((_, i) => i !== index))
    setExpanded(null)
  }

  return (
    <div className='flex flex-col gap-4'>
      {dimensions.length === 0 && <p className='text-muted-foreground py-4 text-sm'>暂无维度，点击「添加维度」开始配置</p>}

      {groups.map(([groupKey, items]) => {
        const summary = weightSummary.find(item => item.label === (groupKey || '全员'))

        return (
          <div key={groupKey || '__ALL__'} className='flex flex-col gap-2'>
            <div className='flex items-center gap-2'>
              <h4 className='text-muted-foreground text-xs font-medium'>{groupKey ? `岗位分组 ${groupKey}` : '全员通用'}</h4>
              {summary && (
                <Badge
                  variant='outline'
                  className={cn(!summary.ok && 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400')}
                >
                  合计 {summary.total}%{!summary.ok && '（需为 100%）'}
                </Badge>
              )}
            </div>

            {items.map(({ dim, index }) =>
              expanded === index ? (

                /* 编辑态：行内标准表单 */
                <div key={index} className='flex flex-col gap-4 rounded-md border p-4'>
                  <div className='grid gap-4 sm:grid-cols-2'>
                    <Field className='gap-2'>
                      <FieldLabel>维度名称*</FieldLabel>
                      <Input
                        value={dim.name}
                        placeholder='如 业绩目标'
                        onChange={event => patchAt(index, { name: event.target.value })}
                      />
                    </Field>
                    <div className='grid grid-cols-2 gap-4'>
                      <Field className='gap-2'>
                        <FieldLabel>类型</FieldLabel>
                        <Select
                          value={dim.type}
                          items={DIMENSION_TYPES}
                          onValueChange={value => patchAt(index, { type: value as string })}
                        >
                          <SelectTrigger>
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
                      <Field className='gap-2'>
                        <FieldLabel>计分方式</FieldLabel>
                        <Select
                          value={dim.scoringMethod}
                          items={SCORING_METHODS}
                          onValueChange={value => patchAt(index, { scoringMethod: value as string })}
                        >
                          <SelectTrigger>
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
                    </div>
                    <div className='grid grid-cols-2 gap-4'>
                      <Field className='gap-2'>
                        <FieldLabel>权重 %</FieldLabel>
                        <Input
                          type='number'
                          value={dim.weight}
                          placeholder='晋升维度不计权重'
                          onChange={event => patchAt(index, { weight: event.target.value })}
                        />
                      </Field>
                      <Field className='gap-2'>
                        <FieldLabel>岗位分组</FieldLabel>
                        <Input
                          value={dim.jobCategory}
                          placeholder='如 D / M，留空为全员'
                          onChange={event => patchAt(index, { jobCategory: event.target.value })}
                        />
                      </Field>
                    </div>
                    <Field className='gap-2'>
                      <FieldLabel>填写角色</FieldLabel>
                      <div className='flex h-9 items-center gap-4'>
                        {EDITABLE_ROLES.map(roleOption => (
                          <label key={roleOption.value} className='flex items-center gap-1.5 text-sm'>
                            <Checkbox
                              checked={dim.editableRoles.includes(roleOption.value)}
                              onCheckedChange={checked =>
                                patchAt(index, {
                                  editableRoles: checked
                                    ? [...dim.editableRoles, roleOption.value]
                                    : dim.editableRoles.filter(role => role !== roleOption.value)
                                })
                              }
                            />
                            {roleOption.label}
                          </label>
                        ))}
                      </div>
                    </Field>
                    {dim.scoringMethod === 'CONCLUSION' && (
                      <Field className='gap-2 sm:col-span-2'>
                        <FieldLabel>结论选项（顿号分隔）</FieldLabel>
                        <Input
                          value={dim.conclusionOptions}
                          placeholder='建议晋升、暂缓晋升、不建议晋升'
                          onChange={event => patchAt(index, { conclusionOptions: event.target.value })}
                        />
                      </Field>
                    )}
                  </div>
                  <div className='flex justify-end gap-2'>
                    <Button variant='ghost' size='sm' onClick={() => removeAt(index)}>
                      <Trash2Icon className='size-4' />
                      删除
                    </Button>
                    <Button size='sm' onClick={() => setExpanded(null)}>
                      完成
                    </Button>
                  </div>
                </div>
              ) : (

                /* 摘要态：一行概览，点击展开编辑 */
                <div
                  key={index}
                  className='hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2.5'
                  onClick={() => setExpanded(index)}
                >
                  <span className='min-w-0 flex-1 truncate text-sm font-medium'>{dim.name || '未命名维度'}</span>
                  <Badge variant='outline'>{DIMENSION_TYPE_LABEL[dim.type] ?? dim.type}</Badge>
                  <Badge variant='outline'>{SCORING_METHOD_LABEL[dim.scoringMethod] ?? dim.scoringMethod}</Badge>
                  {dim.type !== 'PROMOTION' && dim.weight !== '' && (
                    <span className='w-12 shrink-0 text-right text-sm tabular-nums'>{dim.weight}%</span>
                  )}
                  <span className='text-muted-foreground hidden w-28 shrink-0 truncate text-right text-xs sm:block'>
                    {dim.editableRoles.map(role => ROLE_LABEL[role] ?? role).join('/')}
                  </span>
                </div>
              )
            )}
          </div>
        )
      })}

      <Button
        variant='outline'
        size='sm'
        className='self-start'
        onClick={() => {
          onChange([...dimensions, EMPTY_DIMENSION])
          setExpanded(dimensions.length)
        }}
      >
        <PlusIcon className='size-4' />
        添加维度
      </Button>
    </div>
  )
}

export default DimensionSection
