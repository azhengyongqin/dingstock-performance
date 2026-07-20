'use client'

import { useState, type SyntheticEvent } from 'react'

import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'

import type {
  PerfFormDimensionType,
  PerfFormFieldRequiredRule,
  PerfFormFieldType,
  PerfFormItemConfig,
  PerfFormScoringMethod,
  PerfFormTemplateDimension,
  PerfFormTemplateField,
  PerfPerformanceLevel
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

import { createDefaultFieldConfig, FORM_FIELD_TYPES } from './form-template-constants'
import {
  createClientKey,
  formRowKey,
  normalizeDimensionType,
  runReorderTransition,
  toViewTransitionName
} from './form-template-utils'

const DIMENSION_TYPES: { value: PerfFormDimensionType; label: string }[] = [
  { value: 'SCORING', label: '计分维度' },
  { value: 'NON_SCORING', label: '非计分维度' }
]

const SCORING_METHODS: { value: PerfFormScoringMethod; label: string }[] = [
  { value: 'RATING', label: '评级' },
  { value: 'SCORE', label: '0～100 分' }
]

const REQUIRED_RULES: { value: PerfFormFieldRequiredRule; label: string }[] = [
  { value: 'OPTIONAL', label: '选填' },
  { value: 'ALWAYS', label: '始终必填' },
  { value: 'CONDITIONAL', label: '按等级必填' }
]

const RATING_LEVELS: PerfPerformanceLevel[] = ['S', 'A', 'B', 'C']

const newField = (sortOrder: number): PerfFormTemplateField => ({
  type: 'MARKDOWN',
  title: '',
  requiredRule: 'OPTIONAL',
  requiredLevels: [],
  sortOrder,
  config: createDefaultFieldConfig('MARKDOWN'),
  clientKey: createClientKey()
})

const normalizeOrder = (fields: PerfFormTemplateField[]) =>
  fields.map((field, index) => ({ ...field, sortOrder: index }))

const numericConfigValue = (value: string) => (value === '' ? undefined : Number(value))

/** 阻止大纲行内控件点击冒泡到折叠触发区。 */
const stopRowControl = (event: SyntheticEvent) => event.stopPropagation()

type DimensionEditorProps = {
  dimension: PerfFormTemplateDimension
  editable: boolean
  onChange: (next: PerfFormTemplateDimension) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  canMoveUp: boolean
  canMoveDown: boolean
  defaultOpen?: boolean
  invalid?: boolean
  invalidProperties?: Set<string>
  invalidFields?: Map<number, Set<string>>
}

/** 维度标题行承载全部计分配置；展开区只保留说明和表单字段。 */
const DimensionEditor = ({
  dimension,
  editable,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  defaultOpen = false,
  invalid = false,
  invalidProperties,
  invalidFields
}: DimensionEditorProps) => {
  const [open, setOpen] = useState(defaultOpen)
  const [openFields, setOpenFields] = useState<Record<string, boolean>>({})
  const fieldsInvalid = invalidProperties?.has('fields') ?? false

  const patchField = (index: number, patch: Partial<PerfFormTemplateField>) =>
    onChange({
      ...dimension,
      fields: dimension.fields.map((field, fieldIndex) => (fieldIndex === index ? { ...field, ...patch } : field))
    })

  const patchFieldConfig = (index: number, patch: PerfFormItemConfig) =>
    patchField(index, { config: { ...(dimension.fields[index]?.config ?? {}), ...patch } })

  const moveField = (index: number, offset: -1 | 1) => {
    runReorderTransition(() => {
      const next = [...dimension.fields]
      const target = index + offset

      if (target < 0 || target >= next.length) return
      ;[next[index], next[target]] = [next[target], next[index]]
      onChange({ ...dimension, fields: normalizeOrder(next) })
    })
  }

  const changeDimensionType = (type: PerfFormDimensionType) => {
    if (type !== dimension.type) toast.info('已清理与新维度类型不兼容的计分或条件必填配置')
    onChange(normalizeDimensionType(dimension, type))
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn('overflow-hidden rounded-lg border', invalid && 'border-destructive ring-destructive/20 ring-2')}
    >
      <div
        className={cn(
          'bg-muted/40 flex flex-wrap items-center gap-2 border-b px-3 py-2',
          invalid && 'bg-destructive/5'
        )}
      >
        <CollapsibleTrigger className='text-muted-foreground hover:bg-muted flex size-8 shrink-0 items-center justify-center rounded-md'>
          <ChevronDownIcon className={cn('size-4 transition-transform', !open && '-rotate-90')} />
          <span className='sr-only'>{open ? '折叠维度' : '展开维度'}</span>
        </CollapsibleTrigger>

        <Input
          value={dimension.name}
          disabled={!editable}
          placeholder='维度名称'
          className='h-8 min-w-[8rem] flex-1 basis-36'
          aria-invalid={invalid || undefined}
          onClick={stopRowControl}
          onChange={event => onChange({ ...dimension, name: event.target.value })}
        />

        <div className='w-32 shrink-0' onClick={stopRowControl}>
          <Select
            value={dimension.type}
            items={DIMENSION_TYPES}
            disabled={!editable}
            onValueChange={value => changeDimensionType(value as PerfFormDimensionType)}
          >
            <SelectTrigger className='h-8 w-full' aria-invalid={invalidProperties?.has('type') || undefined}>
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
        </div>

        {dimension.type === 'SCORING' && (
          <div className='w-28 shrink-0' onClick={stopRowControl}>
            <Select
              value={dimension.scoringMethod ?? 'RATING'}
              items={SCORING_METHODS}
              disabled={!editable}
              onValueChange={value => onChange({ ...dimension, scoringMethod: value as PerfFormScoringMethod })}
            >
              <SelectTrigger className='h-8 w-full' aria-invalid={invalidProperties?.has('scoringMethod') || undefined}>
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
          </div>
        )}

        {dimension.type === 'SCORING' && (
          <div className='flex w-24 shrink-0 items-center gap-1' onClick={stopRowControl}>
            <Input
              type='number'
              min={0.01}
              max={100}
              step='0.01'
              aria-label='维度占比'
              className='h-8'
              aria-invalid={invalidProperties?.has('weight') || undefined}
              value={dimension.weight == null ? '' : String(dimension.weight)}
              disabled={!editable}
              onChange={event => onChange({ ...dimension, weight: event.target.value })}
            />
            <span className='text-muted-foreground text-xs'>%</span>
          </div>
        )}

        {dimension.type === 'SCORING' && (
          <label className='text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs' onClick={stopRowControl}>
            <Switch
              checked={dimension.isCore}
              disabled={!editable}
              onCheckedChange={checked => onChange({ ...dimension, isCore: Boolean(checked) })}
            />
            核心
          </label>
        )}

        <Badge variant={fieldsInvalid || invalid ? 'destructive' : 'secondary'} className='shrink-0 font-normal'>
          {dimension.fields.length} 个字段
        </Badge>

        {editable && (
          <div className='ml-auto flex shrink-0 items-center gap-0.5' onClick={stopRowControl}>
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
            <h4 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>表单字段</h4>
            {editable && (
              <Button
                variant='outline'
                size='sm'
                onClick={() =>
                  onChange({ ...dimension, fields: [...dimension.fields, newField(dimension.fields.length)] })
                }
              >
                <PlusIcon />
                添加表单字段
              </Button>
            )}
          </div>

          {dimension.fields.length === 0 && (
            <p className='text-muted-foreground rounded-md border border-dashed py-4 text-center text-sm'>
              暂无表单字段
            </p>
          )}

          <ul className={cn('divide-y rounded-md border', fieldsInvalid && 'border-destructive')}>
            {dimension.fields.map((field, index) => {
              const fieldKey = formRowKey(field, `field-${index}`)
              const fieldErrors = invalidFields?.get(index)
              const fieldInvalid = Boolean(fieldErrors)
              const fieldOpen = openFields[fieldKey] ?? fieldInvalid

              const supportsConditional =
                dimension.type === 'SCORING' && (field.type === 'LONG_TEXT' || field.type === 'MARKDOWN')

              return (
                <li
                  key={fieldKey}
                  style={{ viewTransitionName: toViewTransitionName('form-field', fieldKey) }}
                  className={cn(fieldInvalid && 'bg-destructive/5')}
                >
                  <Collapsible
                    open={fieldOpen}
                    onOpenChange={next => setOpenFields(previous => ({ ...previous, [fieldKey]: next }))}
                  >
                    <div className='flex flex-wrap items-center gap-2 px-2 py-1.5'>
                      <CollapsibleTrigger className='text-muted-foreground hover:bg-muted/50 flex size-7 shrink-0 items-center justify-center rounded-md'>
                        <ChevronDownIcon className={cn('size-3.5 transition-transform', !fieldOpen && '-rotate-90')} />
                        <span className='sr-only'>{fieldOpen ? '折叠表单字段' : '展开表单字段'}</span>
                      </CollapsibleTrigger>
                      <span
                        className={cn(
                          'text-muted-foreground w-4 shrink-0 text-center text-xs tabular-nums',
                          fieldInvalid && 'text-destructive'
                        )}
                      >
                        {index + 1}
                      </span>
                      <Input
                        value={field.title}
                        disabled={!editable}
                        placeholder='表单字段标题'
                        className='h-8 min-w-[8rem] flex-1 basis-36'
                        aria-invalid={fieldInvalid || undefined}
                        onClick={stopRowControl}
                        onChange={event => patchField(index, { title: event.target.value })}
                      />
                      <div className='w-32 shrink-0' onClick={stopRowControl}>
                        <Select
                          value={field.type}
                          items={FORM_FIELD_TYPES}
                          disabled={!editable}
                          onValueChange={value => {
                            const type = value as PerfFormFieldType

                            const keepConditional =
                              dimension.type === 'SCORING' && (type === 'LONG_TEXT' || type === 'MARKDOWN')

                            if (!keepConditional && field.requiredRule === 'CONDITIONAL')
                              toast.info('新字段类型不支持按等级必填，已改为选填')
                            patchField(index, {
                              type,
                              config: createDefaultFieldConfig(type),
                              ...(keepConditional ? {} : { requiredRule: 'OPTIONAL', requiredLevels: [] })
                            })
                          }}
                        >
                          <SelectTrigger
                            className='h-8 w-full'
                            aria-invalid={fieldErrors?.has('type') || fieldErrors?.has('config') || undefined}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FORM_FIELD_TYPES.map(option => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className='w-28 shrink-0' onClick={stopRowControl}>
                        <Select
                          value={field.requiredRule}
                          items={supportsConditional ? REQUIRED_RULES : REQUIRED_RULES.slice(0, 2)}
                          disabled={!editable}
                          onValueChange={value =>
                            patchField(index, {
                              requiredRule: value as PerfFormFieldRequiredRule,
                              requiredLevels: value === 'CONDITIONAL' ? field.requiredLevels : []
                            })
                          }
                        >
                          <SelectTrigger
                            className='h-8 w-full'
                            aria-invalid={fieldErrors?.has('requiredRule') || undefined}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(supportsConditional ? REQUIRED_RULES : REQUIRED_RULES.slice(0, 2)).map(option => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {editable && (
                        <div className='ml-auto flex shrink-0 items-center gap-0.5' onClick={stopRowControl}>
                          <Button
                            variant='ghost'
                            size='icon-sm'
                            disabled={index === 0}
                            onClick={() => moveField(index, -1)}
                            aria-label='上移表单字段'
                          >
                            <ArrowUpIcon />
                          </Button>
                          <Button
                            variant='ghost'
                            size='icon-sm'
                            disabled={index === dimension.fields.length - 1}
                            onClick={() => moveField(index, 1)}
                            aria-label='下移表单字段'
                          >
                            <ArrowDownIcon />
                          </Button>
                          <Button
                            variant='ghost'
                            size='icon-sm'
                            onClick={() =>
                              onChange({
                                ...dimension,
                                fields: normalizeOrder(dimension.fields.filter((_, fieldIndex) => fieldIndex !== index))
                              })
                            }
                            aria-label='删除表单字段'
                          >
                            <Trash2Icon />
                          </Button>
                        </div>
                      )}
                    </div>
                    <CollapsibleContent className='bg-muted/20 border-t px-3 py-3'>
                      <FieldAdvancedFields
                        field={field}
                        supportsConditional={supportsConditional}
                        editable={editable}
                        onChange={patch => patchField(index, patch)}
                        onConfigChange={patch => patchFieldConfig(index, patch)}
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

const FieldAdvancedFields = ({
  field,
  supportsConditional,
  editable,
  onChange,
  onConfigChange
}: {
  field: PerfFormTemplateField
  supportsConditional: boolean
  editable: boolean
  onChange: (patch: Partial<PerfFormTemplateField>) => void
  onConfigChange: (patch: PerfFormItemConfig) => void
}) => (
  <div className='grid gap-3 md:grid-cols-2'>
    <Field className='gap-1.5 md:col-span-2'>
      <FieldLabel>占位提示</FieldLabel>
      <Input
        value={field.placeholder ?? ''}
        disabled={!editable}
        onChange={event => onChange({ placeholder: event.target.value })}
      />
    </Field>
    <Field className='gap-1.5 md:col-span-2'>
      <FieldLabel>说明</FieldLabel>
      <Textarea
        value={field.description ?? ''}
        disabled={!editable}
        rows={2}
        onChange={event => onChange({ description: event.target.value })}
      />
    </Field>

    {supportsConditional && field.requiredRule === 'CONDITIONAL' && (
      <Field className='gap-1.5 md:col-span-2'>
        <FieldLabel>触发必填的维度等级</FieldLabel>
        <div className='flex flex-wrap gap-4'>
          {RATING_LEVELS.map(level => (
            <label key={level} className='flex items-center gap-2 text-sm'>
              <Checkbox
                checked={field.requiredLevels.includes(level)}
                disabled={!editable}
                onCheckedChange={checked =>
                  onChange({
                    requiredLevels:
                      checked === true
                        ? [...new Set([...field.requiredLevels, level])]
                        : field.requiredLevels.filter(current => current !== level)
                  })
                }
              />
              {level}
            </label>
          ))}
        </div>
      </Field>
    )}

    {(field.type === 'SHORT_TEXT' || field.type === 'LONG_TEXT' || field.type === 'MARKDOWN') && (
      <>
        <Field className='gap-1.5'>
          <FieldLabel>最少字数</FieldLabel>
          <Input
            type='number'
            min={0}
            value={field.config?.minLength ?? ''}
            disabled={!editable}
            onChange={event => onConfigChange({ minLength: numericConfigValue(event.target.value) })}
          />
        </Field>
        <Field className='gap-1.5'>
          <FieldLabel>最多字数</FieldLabel>
          <Input
            type='number'
            min={0}
            value={field.config?.maxLength ?? ''}
            disabled={!editable}
            onChange={event => onConfigChange({ maxLength: numericConfigValue(event.target.value) })}
          />
        </Field>
        <Field className='gap-1.5 md:col-span-2'>
          <FieldLabel>默认内容</FieldLabel>
          <Textarea
            value={field.config?.defaultValue ?? ''}
            disabled={!editable}
            rows={2}
            placeholder={field.type === 'MARKDOWN' ? '可填写 Markdown 引导结构' : '可选'}
            onChange={event => onConfigChange({ defaultValue: event.target.value })}
          />
        </Field>
      </>
    )}

    {(field.type === 'SINGLE_SELECT' || field.type === 'MULTI_SELECT') && (
      <>
        <Field className='gap-1.5 md:col-span-2'>
          <FieldLabel>选项（每行 value|显示名称）</FieldLabel>
          <Textarea
            value={(field.config?.options ?? []).map(option => `${option.value}|${option.label}`).join('\n')}
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
        {field.type === 'MULTI_SELECT' && (
          <>
            <Field className='gap-1.5'>
              <FieldLabel>最少选择数</FieldLabel>
              <Input
                type='number'
                min={0}
                value={field.config?.minSelections ?? ''}
                disabled={!editable}
                onChange={event => onConfigChange({ minSelections: numericConfigValue(event.target.value) })}
              />
            </Field>
            <Field className='gap-1.5'>
              <FieldLabel>最多选择数</FieldLabel>
              <Input
                type='number'
                min={0}
                value={field.config?.maxSelections ?? ''}
                disabled={!editable}
                onChange={event => onConfigChange({ maxSelections: numericConfigValue(event.target.value) })}
              />
            </Field>
          </>
        )}
      </>
    )}

    {field.type === 'ATTACHMENT' && (
      <>
        <Field className='gap-1.5'>
          <FieldLabel>最多文件数</FieldLabel>
          <Input
            type='number'
            min={1}
            value={field.config?.maxFiles ?? ''}
            disabled={!editable}
            onChange={event => onConfigChange({ maxFiles: numericConfigValue(event.target.value) })}
          />
        </Field>
        <Field className='gap-1.5'>
          <FieldLabel>单文件上限（MB）</FieldLabel>
          <Input
            type='number'
            min={1}
            value={field.config?.maxSizeMb ?? ''}
            disabled={!editable}
            onChange={event => onConfigChange({ maxSizeMb: numericConfigValue(event.target.value) })}
          />
        </Field>
        <Field className='gap-1.5 md:col-span-2'>
          <FieldLabel>允许扩展名</FieldLabel>
          <Input
            value={(field.config?.allowedExtensions ?? []).join(', ')}
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

    {field.type === 'LINK' && (
      <>
        <Field className='gap-1.5'>
          <FieldLabel>链接最大长度</FieldLabel>
          <Input
            type='number'
            min={1}
            value={field.config?.maxLength ?? ''}
            disabled={!editable}
            onChange={event => onConfigChange({ maxLength: numericConfigValue(event.target.value) })}
          />
        </Field>
        <Field className='gap-1.5'>
          <FieldLabel>允许协议</FieldLabel>
          <div className='flex h-9 items-center gap-4'>
            {(['http', 'https'] as const).map(protocol => (
              <label key={protocol} className='flex items-center gap-2 text-sm'>
                <Checkbox
                  checked={(field.config?.allowedProtocols ?? []).includes(protocol)}
                  disabled={!editable}
                  onCheckedChange={checked => {
                    const current = field.config?.allowedProtocols ?? []

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
