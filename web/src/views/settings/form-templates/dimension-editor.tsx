'use client'

import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from 'lucide-react'

import type {
  PerfFormDimensionKind,
  PerfFormItemConfig,
  PerfFormItemType,
  PerfFormTemplateDimension,
  PerfFormTemplateItem
} from '@/lib/perf-api'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import { createDefaultItemConfig, FORM_ITEM_TYPES } from './form-template-constants'
import { normalizeDimensionKind } from './form-template-utils'

const DIMENSION_KINDS: { value: PerfFormDimensionKind; label: string }[] = [
  { value: 'REGULAR', label: '常规计分维度' },
  { value: 'TEXT', label: '非计分维度' }
]

const newItem = (sortOrder: number, kind: PerfFormDimensionKind): PerfFormTemplateItem => {
  const type: PerfFormItemType = kind === 'REGULAR' ? 'RATING' : 'MARKDOWN'

  return {
    type,
    title: '',
    required: true,
    sortOrder,
    config: createDefaultItemConfig(type)
  }
}

const normalizeOrder = (items: PerfFormTemplateItem[]) => items.map((item, index) => ({ ...item, sortOrder: index }))

type DimensionEditorProps = {
  dimension: PerfFormTemplateDimension
  editable: boolean
  weighted: boolean
  onChange: (next: PerfFormTemplateDimension) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  canMoveUp: boolean
  canMoveDown: boolean
}

/** 单个维度及其受控评估项编辑器；计分权重只存在于维度，不下沉到评估项。 */
const DimensionEditor = ({
  dimension,
  editable,
  weighted,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown
}: DimensionEditorProps) => {
  const patchItem = (index: number, patch: Partial<PerfFormTemplateItem>) =>
    onChange({
      ...dimension,
      items: dimension.items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
    })

  const patchItemConfig = (index: number, patch: PerfFormItemConfig) =>
    patchItem(index, { config: { ...(dimension.items[index]?.config ?? {}), ...patch } })

  const numericConfigValue = (value: string) => (value === '' ? undefined : Number(value))

  const moveItem = (index: number, offset: -1 | 1) => {
    const next = [...dimension.items]
    const target = index + offset

    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange({ ...dimension, items: normalizeOrder(next) })
  }

  return (
    <Card className='gap-4'>
      <CardHeader className='flex-row items-center gap-2'>
        <CardTitle className='min-w-0 flex-1 truncate'>{dimension.name || '未命名维度'}</CardTitle>
        {dimension.isCore && <Badge variant='secondary'>核心维度</Badge>}
        {editable && (
          <div className='flex items-center gap-1'>
            <Button variant='ghost' size='icon-sm' disabled={!canMoveUp} onClick={onMoveUp} aria-label='上移维度'>
              <ArrowUpIcon />
            </Button>
            <Button variant='ghost' size='icon-sm' disabled={!canMoveDown} onClick={onMoveDown} aria-label='下移维度'>
              <ArrowDownIcon />
            </Button>
            <Button variant='ghost' size='icon-sm' onClick={onRemove} aria-label='删除维度'>
              <Trash2Icon />
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <div className='grid gap-4 md:grid-cols-2'>
          <Field className='gap-2'>
            <FieldLabel>维度名称</FieldLabel>
            <Input
              value={dimension.name}
              disabled={!editable}
              placeholder='如 核心业绩'
              onChange={event => onChange({ ...dimension, name: event.target.value })}
            />
          </Field>
          {dimension.kind !== 'PROMOTION' && (
            <Field className='gap-2'>
              <FieldLabel>维度类型</FieldLabel>
              <Select
                value={dimension.kind}
                items={DIMENSION_KINDS}
                disabled={!editable}
                onValueChange={value => {
                  const kind = value as PerfFormDimensionKind

                  onChange(normalizeDimensionKind(dimension, kind))
                }}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIMENSION_KINDS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field className='gap-2 md:col-span-2'>
            <FieldLabel>维度说明</FieldLabel>
            <Textarea
              value={dimension.description ?? ''}
              disabled={!editable}
              placeholder='说明评价边界和填写提示'
              onChange={event => onChange({ ...dimension, description: event.target.value })}
            />
          </Field>
          {dimension.kind === 'REGULAR' && weighted && (
            <>
              <Field className='gap-2'>
                <FieldLabel>维度权重（%）</FieldLabel>
                <Input
                  type='number'
                  min={0}
                  max={100}
                  step='0.01'
                  value={dimension.weight == null ? '' : String(dimension.weight)}
                  disabled={!editable}
                  onChange={event => onChange({ ...dimension, weight: event.target.value })}
                />
              </Field>
              <Field className='gap-2'>
                <FieldLabel>核心维度</FieldLabel>
                <label className='flex h-9 items-center gap-2 text-sm'>
                  <Switch
                    checked={dimension.isCore}
                    disabled={!editable}
                    onCheckedChange={checked => onChange({ ...dimension, isCore: Boolean(checked) })}
                  />
                  用于核心维度约束
                </label>
              </Field>
            </>
          )}
        </div>

        <div className='flex flex-col gap-3 border-t pt-4'>
          <div className='flex items-center justify-between gap-3'>
            <h4 className='font-medium'>评估项</h4>
            {editable && (
              <Button
                variant='outline'
                size='sm'
                onClick={() =>
                  onChange({
                    ...dimension,
                    items: [...dimension.items, newItem(dimension.items.length, dimension.kind)]
                  })
                }
              >
                <PlusIcon />
                添加评估项
              </Button>
            )}
          </div>

          {dimension.items.length === 0 && (
            <p className='text-muted-foreground rounded-md border border-dashed p-4 text-center text-sm'>暂无评估项</p>
          )}

          {dimension.items.map((item, index) => (
            <div key={item.id ?? index} className='grid gap-3 rounded-md border p-3 md:grid-cols-2'>
              <Field className='gap-2'>
                <FieldLabel>评估项类型</FieldLabel>
                <Select
                  value={item.type}
                  items={FORM_ITEM_TYPES}
                  disabled={!editable}
                  onValueChange={value => {
                    const type = value as PerfFormItemType

                    patchItem(index, { type, config: createDefaultItemConfig(type) })
                  }}
                >
                  <SelectTrigger className='w-full'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FORM_ITEM_TYPES.map(option => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field className='gap-2'>
                <FieldLabel>标题</FieldLabel>
                <Input
                  value={item.title}
                  disabled={!editable}
                  placeholder='请输入评估项标题'
                  onChange={event => patchItem(index, { title: event.target.value })}
                />
              </Field>
              <Field className='gap-2'>
                <FieldLabel>占位提示</FieldLabel>
                <Input
                  value={item.placeholder ?? ''}
                  disabled={!editable}
                  onChange={event => patchItem(index, { placeholder: event.target.value })}
                />
              </Field>
              <Field className='gap-2'>
                <FieldLabel>填写要求</FieldLabel>
                <label className='flex h-9 items-center gap-2 text-sm'>
                  <Checkbox
                    checked={item.required}
                    disabled={!editable}
                    onCheckedChange={checked => patchItem(index, { required: checked === true })}
                  />
                  必填
                </label>
              </Field>
              <Field className='gap-2 md:col-span-2'>
                <FieldLabel>说明</FieldLabel>
                <Textarea
                  value={item.description ?? ''}
                  disabled={!editable}
                  onChange={event => patchItem(index, { description: event.target.value })}
                />
              </Field>
              {(item.type === 'SHORT_TEXT' || item.type === 'LONG_TEXT' || item.type === 'MARKDOWN') && (
                <div className='grid gap-3 md:col-span-2 md:grid-cols-2'>
                  <Field className='gap-2'>
                    <FieldLabel>最少字数</FieldLabel>
                    <Input
                      type='number'
                      min={0}
                      value={item.config?.minLength ?? ''}
                      disabled={!editable}
                      onChange={event => patchItemConfig(index, { minLength: numericConfigValue(event.target.value) })}
                    />
                  </Field>
                  <Field className='gap-2'>
                    <FieldLabel>最多字数</FieldLabel>
                    <Input
                      type='number'
                      min={0}
                      value={item.config?.maxLength ?? ''}
                      disabled={!editable}
                      onChange={event => patchItemConfig(index, { maxLength: numericConfigValue(event.target.value) })}
                    />
                  </Field>
                  <Field className='gap-2 md:col-span-2'>
                    <FieldLabel>默认内容</FieldLabel>
                    <Textarea
                      value={item.config?.defaultValue ?? ''}
                      disabled={!editable}
                      placeholder={item.type === 'MARKDOWN' ? '可填写 Markdown 引导结构' : '可选'}
                      onChange={event => patchItemConfig(index, { defaultValue: event.target.value })}
                    />
                  </Field>
                </div>
              )}
              {(item.type === 'SINGLE_SELECT' || item.type === 'MULTI_SELECT') && (
                <div className='grid gap-3 md:col-span-2 md:grid-cols-2'>
                  <Field className='gap-2 md:col-span-2'>
                    <FieldLabel>选项（每行 value|显示名称）</FieldLabel>
                    <Textarea
                      value={(item.config?.options ?? []).map(option => `${option.value}|${option.label}`).join('\n')}
                      disabled={!editable}
                      placeholder={'EXCELLENT|优秀\nGOOD|良好'}
                      onChange={event =>
                        patchItemConfig(index, {
                          options: event.target.value
                            .split('\n')
                            .filter(line => line.trim() !== '')
                            .map(line => {
                              const [rawValue, ...rawLabel] = line.split('|')
                              const value = rawValue.trim()

                              return { value, label: rawLabel.join('|').trim() || value }
                            })
                        })
                      }
                    />
                  </Field>
                  {item.type === 'MULTI_SELECT' && (
                    <>
                      <Field className='gap-2'>
                        <FieldLabel>最少选择数</FieldLabel>
                        <Input
                          type='number'
                          min={0}
                          value={item.config?.minSelections ?? ''}
                          disabled={!editable}
                          onChange={event =>
                            patchItemConfig(index, { minSelections: numericConfigValue(event.target.value) })
                          }
                        />
                      </Field>
                      <Field className='gap-2'>
                        <FieldLabel>最多选择数</FieldLabel>
                        <Input
                          type='number'
                          min={0}
                          value={item.config?.maxSelections ?? ''}
                          disabled={!editable}
                          onChange={event =>
                            patchItemConfig(index, { maxSelections: numericConfigValue(event.target.value) })
                          }
                        />
                      </Field>
                    </>
                  )}
                </div>
              )}
              {item.type === 'ATTACHMENT' && (
                <div className='grid gap-3 md:col-span-2 md:grid-cols-3'>
                  <Field className='gap-2'>
                    <FieldLabel>最多文件数</FieldLabel>
                    <Input
                      type='number'
                      min={1}
                      value={item.config?.maxFiles ?? ''}
                      disabled={!editable}
                      onChange={event => patchItemConfig(index, { maxFiles: numericConfigValue(event.target.value) })}
                    />
                  </Field>
                  <Field className='gap-2'>
                    <FieldLabel>单文件上限（MB）</FieldLabel>
                    <Input
                      type='number'
                      min={1}
                      value={item.config?.maxSizeMb ?? ''}
                      disabled={!editable}
                      onChange={event => patchItemConfig(index, { maxSizeMb: numericConfigValue(event.target.value) })}
                    />
                  </Field>
                  <Field className='gap-2'>
                    <FieldLabel>允许扩展名</FieldLabel>
                    <Input
                      value={(item.config?.allowedExtensions ?? []).join(', ')}
                      disabled={!editable}
                      placeholder='pdf, pptx'
                      onChange={event =>
                        patchItemConfig(index, {
                          allowedExtensions: event.target.value
                            .split(/[,，]/)
                            .map(value => value.trim())
                            .filter(Boolean)
                        })
                      }
                    />
                  </Field>
                </div>
              )}
              {item.type === 'LINK' && (
                <div className='grid gap-3 md:col-span-2 md:grid-cols-2'>
                  <Field className='gap-2'>
                    <FieldLabel>链接最大长度</FieldLabel>
                    <Input
                      type='number'
                      min={1}
                      value={item.config?.maxLength ?? ''}
                      disabled={!editable}
                      onChange={event => patchItemConfig(index, { maxLength: numericConfigValue(event.target.value) })}
                    />
                  </Field>
                  <Field className='gap-2'>
                    <FieldLabel>允许协议</FieldLabel>
                    <div className='flex h-9 items-center gap-4'>
                      {(['http', 'https'] as const).map(protocol => (
                        <label key={protocol} className='flex items-center gap-2 text-sm'>
                          <Checkbox
                            checked={(item.config?.allowedProtocols ?? []).includes(protocol)}
                            disabled={!editable}
                            onCheckedChange={checked => {
                              const current = item.config?.allowedProtocols ?? []

                              patchItemConfig(index, {
                                allowedProtocols:
                                  checked === true
                                    ? [...new Set([...current, protocol])]
                                    : current.filter(value => value !== protocol)
                              })
                            }}
                          />
                          {protocol}
                        </label>
                      ))}
                    </div>
                  </Field>
                </div>
              )}
              {editable && (
                <div className='flex justify-end gap-1 md:col-span-2'>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    disabled={index === 0}
                    onClick={() => moveItem(index, -1)}
                    aria-label='上移评估项'
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    disabled={index === dimension.items.length - 1}
                    onClick={() => moveItem(index, 1)}
                    aria-label='下移评估项'
                  >
                    <ArrowDownIcon />
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    onClick={() =>
                      onChange({ ...dimension, items: normalizeOrder(dimension.items.filter((_, i) => i !== index)) })
                    }
                    aria-label='删除评估项'
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export default DimensionEditor
