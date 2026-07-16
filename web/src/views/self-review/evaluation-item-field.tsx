'use client'

// 单个评估项渲染分发：按 PerfFormItemType 映射到唯一一种 shadcn ui 基础组件，禁手写原生控件。
import { PlusIcon, Trash2Icon } from 'lucide-react'

import { RatingSelector } from '@/components/shared/RatingSelector'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldError, FieldTitle } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { PerfConfigTemplateRating, PerfEvalFormItem, PerfPerformanceLevel } from '@/lib/perf-api'

import { asAttachmentRows, asStringArray, type AttachmentRow, type EvaluationItemAnswer } from './evaluation-form-types'

type FieldProps = {
  item: PerfEvalFormItem
  answer?: EvaluationItemAnswer
  onChange: (answer: EvaluationItemAnswer) => void
  disabled?: boolean
}

/** RATING：时间轴胶囊选择器；标题/必填由外层 EvaluationItemField 统一渲染 */
const RatingItemField = ({
  item,
  answer,
  onChange,
  disabled,
  ratings
}: FieldProps & { ratings?: PerfConfigTemplateRating[] }) => (
  <RatingSelector
    aria-label={item.title}
    value={answer?.rawLevel ?? null}
    onChange={rawLevel => onChange({ rawLevel })}
    disabled={disabled}
    ratings={ratings}
  />
)

const ScoreField = ({ item, answer, onChange, disabled }: FieldProps) => (
  <Input
    aria-label={item.title}
    type='number'
    inputMode='decimal'
    min={0}
    max={100}
    step={0.01}
    placeholder={item.placeholder || '请输入 0-100 的分数，最多两位小数'}
    value={answer?.rawScoreText ?? ''}
    disabled={disabled}
    onChange={event => onChange({ rawScoreText: event.target.value })}
  />
)

const ShortTextField = ({ item, answer, onChange, disabled }: FieldProps) => (
  <Input
    aria-label={item.title}
    placeholder={item.placeholder ?? undefined}
    maxLength={item.config?.maxLength}
    value={typeof answer?.value === 'string' ? answer.value : ''}
    disabled={disabled}
    onChange={event => onChange({ value: event.target.value })}
  />
)

const LongTextField = ({ item, answer, onChange, disabled }: FieldProps) => (
  <Textarea
    aria-label={item.title}
    rows={4}
    placeholder={item.placeholder ?? undefined}
    maxLength={item.config?.maxLength}
    value={typeof answer?.value === 'string' ? answer.value : ''}
    disabled={disabled}
    onChange={event => onChange({ value: event.target.value })}
  />
)

const MarkdownField = ({ item, answer, onChange, disabled }: FieldProps) => (
  <div className='flex flex-col gap-1'>
    <Textarea
      aria-label={item.title}
      rows={6}
      placeholder={item.placeholder ?? undefined}
      value={typeof answer?.value === 'string' ? answer.value : ''}
      disabled={disabled}
      onChange={event => onChange({ value: event.target.value })}
    />
    <FieldDescription>支持 Markdown 语法</FieldDescription>
  </div>
)

const SingleSelectField = ({ item, answer, onChange, disabled }: FieldProps) => {
  const options = item.config?.options ?? []
  const value = typeof answer?.value === 'string' ? answer.value : null

  return (
    <Select
      value={value}
      onValueChange={next => {
        if (typeof next === 'string') onChange({ value: next })
      }}
      disabled={disabled}
    >
      <SelectTrigger aria-label={item.title} className='w-full'>
        <SelectValue placeholder={item.placeholder || '请选择'} />
      </SelectTrigger>
      <SelectContent>
        {options.map(option => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const MultiSelectField = ({ item, answer, onChange, disabled }: FieldProps) => {
  const options = item.config?.options ?? []
  const selected = asStringArray(answer?.value)

  const toggle = (value: string, checked: boolean) => {
    const next = checked ? [...selected, value] : selected.filter(candidate => candidate !== value)

    onChange({ value: next })
  }

  return (
    <div className='flex flex-col gap-2'>
      {options.map(option => {
        const htmlId = `${item.key}-${option.value}`
        const checked = selected.includes(option.value)

        return (

          // 同 RATING：控件与 Label 为兄弟关系，避免无障碍名称重复计入控件自身内容。
          <div key={option.value} className='flex items-center gap-2.5'>
            <Checkbox
              id={htmlId}
              checked={checked}
              disabled={disabled}
              onCheckedChange={next => toggle(option.value, next === true)}
            />
            <Label htmlFor={htmlId} className='font-normal'>
              {option.label}
            </Label>
          </div>
        )
      })}
    </div>
  )
}

const AttachmentField = ({ item, answer, onChange, disabled }: FieldProps) => {
  const rows = asAttachmentRows(answer?.value)
  const maxFiles = item.config?.maxFiles
  const reachedMax = typeof maxFiles === 'number' && rows.length >= maxFiles

  const update = (nextRows: AttachmentRow[]) => onChange({ value: nextRows })
  const addRow = () => update([...rows, { name: '', url: '' }])
  const removeRow = (index: number) => update(rows.filter((_, rowIndex) => rowIndex !== index))

  const updateRow = (index: number, patch: Partial<AttachmentRow>) =>
    update(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)))

  return (
    <div className='flex flex-col gap-2'>
      {rows.map((row, index) => (
        <div key={index} className='flex items-center gap-2'>
          <Input
            aria-label={`${item.title} 附件 ${index + 1} 名称`}
            placeholder='附件名称'
            value={row.name}
            disabled={disabled}
            onChange={event => updateRow(index, { name: event.target.value })}
          />
          <Input
            aria-label={`${item.title} 附件 ${index + 1} 链接`}
            placeholder='https://...'
            value={row.url}
            disabled={disabled}
            onChange={event => updateRow(index, { url: event.target.value })}
          />
          <Button
            type='button'
            variant='ghost'
            size='icon-sm'
            aria-label={`删除附件 ${index + 1}`}
            disabled={disabled}
            onClick={() => removeRow(index)}
          >
            <Trash2Icon />
          </Button>
        </div>
      ))}
      <Button type='button' variant='outline' size='sm' disabled={disabled || reachedMax} onClick={addRow}>
        <PlusIcon />
        添加附件
      </Button>
      {typeof maxFiles === 'number' && <FieldDescription>最多添加 {maxFiles} 个附件</FieldDescription>}
    </div>
  )
}

const LinkField = ({ item, answer, onChange, disabled }: FieldProps) => (
  <Input
    aria-label={item.title}
    type='url'
    placeholder={item.placeholder || 'https://...'}
    value={typeof answer?.value === 'string' ? answer.value : ''}
    disabled={disabled}
    onChange={event => onChange({ value: event.target.value })}
  />
)

export type EvaluationItemFieldProps = FieldProps & {
  error?: string
  ratings?: PerfConfigTemplateRating[]
}

/** 单个评估项：标题/必填标记/说明 + 对应控件 + 就地校验错误 */
const EvaluationItemField = ({ item, answer, onChange, disabled, error, ratings }: EvaluationItemFieldProps) => (
  <Field data-invalid={!!error} className='gap-2'>
    <div className='flex flex-col gap-1'>
      <FieldTitle>
        {item.title}
        {item.required && (
          <span aria-hidden className='text-destructive ml-1'>
            *
          </span>
        )}
      </FieldTitle>
      {item.description && <FieldDescription>{item.description}</FieldDescription>}
    </div>
    {item.type === 'RATING' && (
      <RatingItemField item={item} answer={answer} onChange={onChange} disabled={disabled} ratings={ratings} />
    )}
    {item.type === 'SCORE' && <ScoreField item={item} answer={answer} onChange={onChange} disabled={disabled} />}
    {item.type === 'SHORT_TEXT' && <ShortTextField item={item} answer={answer} onChange={onChange} disabled={disabled} />}
    {item.type === 'LONG_TEXT' && <LongTextField item={item} answer={answer} onChange={onChange} disabled={disabled} />}
    {item.type === 'MARKDOWN' && <MarkdownField item={item} answer={answer} onChange={onChange} disabled={disabled} />}
    {item.type === 'SINGLE_SELECT' && (
      <SingleSelectField item={item} answer={answer} onChange={onChange} disabled={disabled} />
    )}
    {item.type === 'MULTI_SELECT' && (
      <MultiSelectField item={item} answer={answer} onChange={onChange} disabled={disabled} />
    )}
    {item.type === 'ATTACHMENT' && <AttachmentField item={item} answer={answer} onChange={onChange} disabled={disabled} />}
    {item.type === 'LINK' && <LinkField item={item} answer={answer} onChange={onChange} disabled={disabled} />}
    {error && <FieldError>{error}</FieldError>}
  </Field>
)

export default EvaluationItemField
