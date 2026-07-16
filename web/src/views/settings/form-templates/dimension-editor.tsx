'use client'

import { useState, type SyntheticEvent } from 'react'

import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  PlusIcon,
  Trash2Icon
} from 'lucide-react'
import type {
  PerfFormDimensionKind,
  PerfFormItemConfig,
  PerfFormItemType,
  PerfFormTemplateDimension,
  PerfFormTemplateItem
} from '@/lib/perf-api'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import { createDefaultItemConfig, FORM_ITEM_TYPES } from './form-template-constants'
import {
  createClientKey,
  formRowKey,
  normalizeDimensionKind,
  runReorderTransition,
  toViewTransitionName
} from './form-template-utils'

const DIMENSION_KINDS: { value: PerfFormDimensionKind; label: string }[] = [
  { value: 'REGULAR', label: '常规计分' },
  { value: 'TEXT', label: '非计分' }
]

const newItem = (sortOrder: number, kind: PerfFormDimensionKind): PerfFormTemplateItem => {
  const type: PerfFormItemType = kind === 'REGULAR' ? 'RATING' : 'MARKDOWN'

  return {
    type,
    title: '',
    required: true,
    sortOrder,
    config: createDefaultItemConfig(type),
    clientKey: createClientKey()
  } as PerfFormTemplateItem
}

const normalizeOrder = (items: PerfFormTemplateItem[]) =>
  items.map((item, index) => ({ ...item, sortOrder: index }))

const numericConfigValue = (value: string) => (value === '' ? undefined : Number(value))

/** 阻止大纲行内控件点击冒泡到折叠触发区。 */
const stopRowControl = (event: SyntheticEvent) => {
  event.stopPropagation()
}

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
  /** 首个维度默认展开，其余默认折叠 */
  defaultOpen?: boolean
}

/**
 * 单个维度：大纲行承载名称/类型/权重/核心等简编字段；
 * 展开区只放说明与评估项列表，评估项同理（标题/类型/必填在行内）。
 */
const DimensionEditor = ({
  dimension,
  editable,
  weighted,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  defaultOpen = false
}: DimensionEditorProps) => {
  const [open, setOpen] = useState(defaultOpen)
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({})

  const patchItem = (index: number, patch: Partial<PerfFormTemplateItem>) =>
    onChange({
      ...dimension,
      items: dimension.items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
    })

  const patchItemConfig = (index: number, patch: PerfFormItemConfig) =>
    patchItem(index, { config: { ...(dimension.items[index]?.config ?? {}), ...patch } })

  const moveItem = (index: number, offset: -1 | 1) => {
    runReorderTransition(() => {
      const next = [...dimension.items]
      const target = index + offset

      if (target < 0 || target >= next.length) return
      ;[next[index], next[target]] = [next[target], next[index]]
      onChange({ ...dimension, items: normalizeOrder(next) })
    })
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className='overflow-hidden rounded-lg border'>
      {/* 大纲行底色/边框对齐配置模板 ConfigRuleTable 表头 */}
      <div className='bg-muted/40 flex flex-wrap items-center gap-2 border-b px-3 py-2'>
        <CollapsibleTrigger className='text-muted-foreground hover:bg-muted flex size-8 shrink-0 items-center justify-center rounded-md'>
          <ChevronDownIcon
            className={cn('size-4 transition-transform', !open && '-rotate-90')}
          />
          <span className='sr-only'>{open ? '折叠维度' : '展开维度'}</span>
        </CollapsibleTrigger>

        <Input
          value={dimension.name}
          disabled={!editable}
          placeholder='维度名称'
          className='h-8 min-w-[8rem] flex-1 basis-40'
          onClick={stopRowControl}
          onChange={event => onChange({ ...dimension, name: event.target.value })}
        />

        {dimension.kind !== 'PROMOTION' && (
          <div className='w-28 shrink-0' onClick={stopRowControl}>
            <Select
              value={dimension.kind}
              items={DIMENSION_KINDS}
              disabled={!editable}
              onValueChange={value =>
                onChange(normalizeDimensionKind(dimension, value as PerfFormDimensionKind))
              }
            >
              <SelectTrigger className='h-8 w-full'>
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
          </div>
        )}

        {dimension.kind === 'REGULAR' && weighted && (
          <div className='flex w-24 shrink-0 items-center gap-1' onClick={stopRowControl}>
            <Input
              type='number'
              min={0}
              max={100}
              step='0.01'
              aria-label='维度权重'
              className='h-8'
              value={dimension.weight == null ? '' : String(dimension.weight)}
              disabled={!editable}
              onChange={event => onChange({ ...dimension, weight: event.target.value })}
            />
            <span className='text-muted-foreground text-xs'>%</span>
          </div>
        )}

        {dimension.kind === 'REGULAR' && weighted && (
          <label
            className='text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs'
            onClick={stopRowControl}
          >
            <Switch
              checked={dimension.isCore}
              disabled={!editable}
              onCheckedChange={checked => onChange({ ...dimension, isCore: Boolean(checked) })}
            />
            核心
          </label>
        )}

        <Badge variant='secondary' className='shrink-0 font-normal'>
          {dimension.items.length} 项
        </Badge>

        {editable && (
          <div className='ml-auto flex shrink-0 items-center gap-0.5' onClick={stopRowControl}>
            <Button
              variant='ghost'
              size='icon-sm'
              disabled={!canMoveUp}
              onClick={onMoveUp}
              aria-label='上移维度'
            >
              <ArrowUpIcon />
            </Button>
            <Button
              variant='ghost'
              size='icon-sm'
              disabled={!canMoveDown}
              onClick={onMoveDown}
              aria-label='下移维度'
            >
              <ArrowDownIcon />
            </Button>
            <Button variant='ghost' size='icon-sm' onClick={onRemove} aria-label='删除维度'>
              <Trash2Icon />
            </Button>
          </div>
        )}
      </div>

      <CollapsibleContent className='border-t'>
        <div className='flex flex-col gap-4 px-3 py-3'>
          <Field className='gap-1.5'>
            <FieldLabel>维度说明</FieldLabel>
            <Textarea
              value={dimension.description ?? ''}
              disabled={!editable}
              rows={2}
              placeholder='说明评价边界和填写提示'
              onChange={event => onChange({ ...dimension, description: event.target.value })}
            />
          </Field>

          <div className='flex items-center justify-between gap-3'>
            <h4 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
              评估项
            </h4>
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
            <p className='text-muted-foreground rounded-md border border-dashed py-4 text-center text-sm'>
              暂无评估项
            </p>
          )}

          <ul className='divide-y rounded-md border'>
            {dimension.items.map((item, index) => {
              const itemKey = formRowKey(item, `item-${index}`)
              const itemOpen = openItems[itemKey] ?? false

              return (
                <li
                  key={itemKey}
                  style={{ viewTransitionName: toViewTransitionName('form-item', itemKey) }}
                >
                  <Collapsible
                    open={itemOpen}
                    onOpenChange={next => setOpenItems(prev => ({ ...prev, [itemKey]: next }))}
                  >
                    <div className='flex flex-wrap items-center gap-2 px-2 py-1.5'>
                      <CollapsibleTrigger className='text-muted-foreground hover:bg-muted/50 flex size-7 shrink-0 items-center justify-center rounded-md'>
                        <ChevronDownIcon
                          className={cn('size-3.5 transition-transform', !itemOpen && '-rotate-90')}
                        />
                        <span className='sr-only'>{itemOpen ? '折叠评估项' : '展开评估项'}</span>
                      </CollapsibleTrigger>

                      <span className='text-muted-foreground w-4 shrink-0 text-center text-xs tabular-nums'>
                        {index + 1}
                      </span>

                      <Input
                        value={item.title}
                        disabled={!editable}
                        placeholder='评估项标题'
                        className='h-8 min-w-[8rem] flex-1 basis-36'
                        onClick={stopRowControl}
                        onChange={event => patchItem(index, { title: event.target.value })}
                      />

                      <div className='w-32 shrink-0' onClick={stopRowControl}>
                        <Select
                          value={item.type}
                          items={FORM_ITEM_TYPES}
                          disabled={!editable}
                          onValueChange={value => {
                            const type = value as PerfFormItemType

                            patchItem(index, { type, config: createDefaultItemConfig(type) })
                          }}
                        >
                          <SelectTrigger className='h-8 w-full'>
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
                      </div>

                      <label
                        className='flex shrink-0 items-center gap-1.5 text-xs'
                        onClick={stopRowControl}
                      >
                        <Checkbox
                          checked={item.required}
                          disabled={!editable}
                          onCheckedChange={checked =>
                            patchItem(index, { required: checked === true })
                          }
                        />
                        必填
                      </label>

                      {editable && (
                        <div
                          className='ml-auto flex shrink-0 items-center gap-0.5'
                          onClick={stopRowControl}
                        >
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
                              onChange({
                                ...dimension,
                                items: normalizeOrder(
                                  dimension.items.filter((_, itemIndex) => itemIndex !== index)
                                )
                              })
                            }
                            aria-label='删除评估项'
                          >
                            <Trash2Icon />
                          </Button>
                        </div>
                      )}
                    </div>

                    <CollapsibleContent className='bg-muted/20 border-t px-3 py-3'>
                      <ItemAdvancedFields
                        item={item}
                        editable={editable}
                        onChange={patch => patchItem(index, patch)}
                        onConfigChange={patch => patchItemConfig(index, patch)}
                      />
                    </CollapsibleContent>
                  </Collapsible>
                </li>
              )
            })}
          </ul>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

type ItemAdvancedFieldsProps = {
  item: PerfFormTemplateItem
  editable: boolean
  onChange: (patch: Partial<PerfFormTemplateItem>) => void
  onConfigChange: (patch: PerfFormItemConfig) => void
}

/** 展开后才出现的次要字段：占位、说明与类型专属配置。 */
const ItemAdvancedFields = ({
  item,
  editable,
  onChange,
  onConfigChange
}: ItemAdvancedFieldsProps) => (
  <div className='grid gap-3 md:grid-cols-2'>
    <Field className='gap-1.5 md:col-span-2'>
      <FieldLabel>占位提示</FieldLabel>
      <Input
        value={item.placeholder ?? ''}
        disabled={!editable}
        onChange={event => onChange({ placeholder: event.target.value })}
      />
    </Field>
    <Field className='gap-1.5 md:col-span-2'>
      <FieldLabel>说明</FieldLabel>
      <Textarea
        value={item.description ?? ''}
        disabled={!editable}
        rows={2}
        onChange={event => onChange({ description: event.target.value })}
      />
    </Field>

    {(item.type === 'SHORT_TEXT' || item.type === 'LONG_TEXT' || item.type === 'MARKDOWN') && (
      <>
        <Field className='gap-1.5'>
          <FieldLabel>最少字数</FieldLabel>
          <Input
            type='number'
            min={0}
            value={item.config?.minLength ?? ''}
            disabled={!editable}
            onChange={event =>
              onConfigChange({ minLength: numericConfigValue(event.target.value) })
            }
          />
        </Field>
        <Field className='gap-1.5'>
          <FieldLabel>最多字数</FieldLabel>
          <Input
            type='number'
            min={0}
            value={item.config?.maxLength ?? ''}
            disabled={!editable}
            onChange={event =>
              onConfigChange({ maxLength: numericConfigValue(event.target.value) })
            }
          />
        </Field>
        <Field className='gap-1.5 md:col-span-2'>
          <FieldLabel>默认内容</FieldLabel>
          <Textarea
            value={item.config?.defaultValue ?? ''}
            disabled={!editable}
            rows={2}
            placeholder={item.type === 'MARKDOWN' ? '可填写 Markdown 引导结构' : '可选'}
            onChange={event => onConfigChange({ defaultValue: event.target.value })}
          />
        </Field>
      </>
    )}

    {(item.type === 'SINGLE_SELECT' || item.type === 'MULTI_SELECT') && (
      <>
        <Field className='gap-1.5 md:col-span-2'>
          <FieldLabel>选项（每行 value|显示名称）</FieldLabel>
          <Textarea
            value={(item.config?.options ?? [])
              .map(option => `${option.value}|${option.label}`)
              .join('\n')}
            disabled={!editable}
            rows={3}
            placeholder={'EXCELLENT|优秀\nGOOD|良好'}
            onChange={event =>
              onConfigChange({
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
            <Field className='gap-1.5'>
              <FieldLabel>最少选择数</FieldLabel>
              <Input
                type='number'
                min={0}
                value={item.config?.minSelections ?? ''}
                disabled={!editable}
                onChange={event =>
                  onConfigChange({ minSelections: numericConfigValue(event.target.value) })
                }
              />
            </Field>
            <Field className='gap-1.5'>
              <FieldLabel>最多选择数</FieldLabel>
              <Input
                type='number'
                min={0}
                value={item.config?.maxSelections ?? ''}
                disabled={!editable}
                onChange={event =>
                  onConfigChange({ maxSelections: numericConfigValue(event.target.value) })
                }
              />
            </Field>
          </>
        )}
      </>
    )}

    {item.type === 'ATTACHMENT' && (
      <>
        <Field className='gap-1.5'>
          <FieldLabel>最多文件数</FieldLabel>
          <Input
            type='number'
            min={1}
            value={item.config?.maxFiles ?? ''}
            disabled={!editable}
            onChange={event =>
              onConfigChange({ maxFiles: numericConfigValue(event.target.value) })
            }
          />
        </Field>
        <Field className='gap-1.5'>
          <FieldLabel>单文件上限（MB）</FieldLabel>
          <Input
            type='number'
            min={1}
            value={item.config?.maxSizeMb ?? ''}
            disabled={!editable}
            onChange={event =>
              onConfigChange({ maxSizeMb: numericConfigValue(event.target.value) })
            }
          />
        </Field>
        <Field className='gap-1.5 md:col-span-2'>
          <FieldLabel>允许扩展名</FieldLabel>
          <Input
            value={(item.config?.allowedExtensions ?? []).join(', ')}
            disabled={!editable}
            placeholder='pdf, pptx'
            onChange={event =>
              onConfigChange({
                allowedExtensions: event.target.value
                  .split(/[,，]/)
                  .map(value => value.trim())
                  .filter(Boolean)
              })
            }
          />
        </Field>
      </>
    )}

    {item.type === 'LINK' && (
      <>
        <Field className='gap-1.5'>
          <FieldLabel>链接最大长度</FieldLabel>
          <Input
            type='number'
            min={1}
            value={item.config?.maxLength ?? ''}
            disabled={!editable}
            onChange={event =>
              onConfigChange({ maxLength: numericConfigValue(event.target.value) })
            }
          />
        </Field>
        <Field className='gap-1.5'>
          <FieldLabel>允许协议</FieldLabel>
          <div className='flex h-9 items-center gap-4'>
            {(['http', 'https'] as const).map(protocol => (
              <label key={protocol} className='flex items-center gap-2 text-sm'>
                <Checkbox
                  checked={(item.config?.allowedProtocols ?? []).includes(protocol)}
                  disabled={!editable}
                  onCheckedChange={checked => {
                    const current = item.config?.allowedProtocols ?? []

                    onConfigChange({
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
      </>
    )}
  </div>
)

export default DimensionEditor
