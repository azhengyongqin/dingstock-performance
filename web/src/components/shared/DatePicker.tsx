'use client'

// React Imports
import { useMemo, useState } from 'react'

// Third-party Imports
import { format } from 'date-fns'
import { CalendarIcon } from 'lucide-react'
import type { DateRange } from 'react-day-picker'

// Component Imports
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'

// Util Imports
import { cn } from '@/lib/utils'

/** 解析 'YYYY-MM-DD' 为本地时区 Date；非法值返回 undefined */
const parseDateValue = (value: string): Date | undefined => {
  if (!value) return undefined

  const date = new Date(`${value.slice(0, 10)}T00:00:00`)

  return Number.isNaN(date.getTime()) ? undefined : date
}

/** 解析 'YYYY-MM-DDTHH:mm' 为本地时区 Date；非法值返回 undefined */
const parseDateTimeValue = (value: string): Date | undefined => {
  if (!value) return undefined

  const [datePart, timePart = '00:00'] = value.split('T')
  const date = new Date(`${datePart}T${timePart.slice(0, 5)}`)

  return Number.isNaN(date.getTime()) ? undefined : date
}

/** 统一对外输出为业务表单使用的 'YYYY-MM-DDTHH:mm' 字符串 */
const formatDateTimeValue = (date: Date): string => format(date, "yyyy-MM-dd'T'HH:mm")

/** 统一对外输出为业务表单使用的 'YYYY-MM-DD' 字符串 */
const formatDateValue = (date: Date): string => format(date, 'yyyy-MM-dd')

/** 按分钟步长生成选项；额外保留当前值，避免非步长分钟打开后不可见 */
const buildMinuteOptions = (minuteStep: number, extraMinutes: number[] = []): number[] => {
  const step = Math.min(Math.max(Math.trunc(minuteStep) || 5, 1), 60)
  const options = Array.from({ length: Math.ceil(60 / step) }, (_, index) => index * step).filter(minute => minute < 60)

  extraMinutes.forEach(minute => {
    if (minute >= 0 && minute < 60 && !options.includes(minute)) {
      options.push(minute)
    }
  })

  return options.sort((a, b) => a - b)
}

export type DateRangeValue = {

  /** 'YYYY-MM-DD'；空字符串表示未选择 */
  from: string

  /** 'YYYY-MM-DD'；空字符串表示未选择 */
  to: string
}

export type DateTimeRangeValue = {

  /** 'YYYY-MM-DDTHH:mm'；空字符串表示未选择 */
  from: string

  /** 'YYYY-MM-DDTHH:mm'；空字符串表示未选择 */
  to: string
}

type DatePickerProps = {

  /** 'YYYY-MM-DD'；空字符串表示未选择 */
  value: string
  onChange: (value: string) => void
  id?: string
  placeholder?: string
  disabled?: boolean
}

/**
 * 业务通用日期选择器：模板 Popover + Calendar 组合的受控封装，
 * 替代原生 <input type='date'>，值保持 'YYYY-MM-DD' 字符串格式。
 */
export const DatePicker = ({ value, onChange, id, placeholder = '选择日期', disabled }: DatePickerProps) => {
  const [open, setOpen] = useState(false)
  const selected = parseDateValue(value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type='button'
            variant='outline'
            disabled={disabled}
            className={cn(
              'group bg-background hover:bg-background border-input w-full justify-between px-3 font-normal',
              !selected && 'text-muted-foreground'
            )}
          />
        }
      >
        <span className='truncate'>{selected ? format(selected, 'yyyy-MM-dd') : placeholder}</span>
        <CalendarIcon size={16} className='text-muted-foreground/80 shrink-0' aria-hidden='true' />
      </PopoverTrigger>
      <PopoverContent className='w-auto p-0' align='start'>
        <Calendar
          mode='single'
          selected={selected}
          defaultMonth={selected}
          captionLayout='dropdown'
          onSelect={date => {
            if (date) {
              onChange(format(date, 'yyyy-MM-dd'))
              setOpen(false)
            }
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

type DateRangePickerProps = {
  value: DateRangeValue
  onChange: (value: DateRangeValue) => void
  id?: string
  placeholder?: string
  disabled?: boolean
  numberOfMonths?: number
}

/**
 * 业务通用日期区间选择器：复用 Calendar 的 range 模式，
 * 值保持 { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }，便于提交给接口。
 */
export const DateRangePicker = ({
  value,
  onChange,
  id,
  placeholder = '选择日期区间',
  disabled,
  numberOfMonths = 2
}: DateRangePickerProps) => {
  const [open, setOpen] = useState(false)
  const fromDate = parseDateValue(value.from)
  const toDate = parseDateValue(value.to)
  const selected: DateRange | undefined = fromDate || toDate ? { from: fromDate, to: toDate } : undefined

  const label =
    fromDate && toDate
      ? `${formatDateValue(fromDate)} 至 ${formatDateValue(toDate)}`
      : fromDate
        ? `${formatDateValue(fromDate)} 至 结束日期`
        : placeholder

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type='button'
            variant='outline'
            disabled={disabled}
            className={cn(
              'group bg-background hover:bg-background border-input w-full justify-between px-3 font-normal',
              !fromDate && !toDate && 'text-muted-foreground'
            )}
          />
        }
      >
        <span className='truncate'>{label}</span>
        <CalendarIcon size={16} className='text-muted-foreground/80 shrink-0' aria-hidden='true' />
      </PopoverTrigger>
      <PopoverContent className='w-auto max-w-[calc(100vw-2rem)] overflow-hidden p-0' align='start'>
        <Calendar
          mode='range'
          selected={selected}
          defaultMonth={fromDate ?? toDate}
          numberOfMonths={numberOfMonths}
          captionLayout='dropdown'
          onSelect={range => {
            onChange({
              from: range?.from ? formatDateValue(range.from) : '',
              to: range?.to ? formatDateValue(range.to) : ''
            })
          }}
        />
        <div className='flex justify-between border-t p-2'>
          <Button type='button' variant='ghost' size='sm' onClick={() => onChange({ from: '', to: '' })}>
            清空
          </Button>
          <Button type='button' size='sm' onClick={() => setOpen(false)}>
            确定
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

type DateTimePickerProps = {

  /** 'YYYY-MM-DDTHH:mm'；空字符串表示未选择 */
  value: string
  onChange: (value: string) => void
  id?: string
  placeholder?: string
  disabled?: boolean
  minuteStep?: number
}

type DateTimeRangePickerProps = {
  value: DateTimeRangeValue
  onChange: (value: DateTimeRangeValue) => void
  id?: string
  placeholder?: string
  disabled?: boolean
  minuteStep?: number
  startPlaceholder?: string
  endPlaceholder?: string
  numberOfMonths?: number
}

/**
 * 业务通用日期时间选择器：复用 Calendar / Popover / ScrollArea 等基础 UI，
 * 在同一个弹层中完成日期、小时、分钟选择；值保持 'YYYY-MM-DDTHH:mm' 字符串格式。
 */
export const DateTimePicker = ({
  value,
  onChange,
  id,
  placeholder = '选择日期时间',
  disabled,
  minuteStep = 5
}: DateTimePickerProps) => {
  const [open, setOpen] = useState(false)
  const selected = parseDateTimeValue(value)

  const minuteOptions = useMemo(() => {
    return buildMinuteOptions(minuteStep, selected ? [selected.getMinutes()] : [])
  }, [minuteStep, selected])

  const commitDate = (nextDate: Date) => {
    onChange(formatDateTimeValue(nextDate))
  }

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return

    const nextDate = new Date(date)

    // 切换日期时保留已选时间；首次选择日期时默认 00:00，符合业务窗口录入习惯。
    nextDate.setHours(selected?.getHours() ?? 0, selected?.getMinutes() ?? 0, 0, 0)
    commitDate(nextDate)
  }

  const handleTimeChange = (type: 'hour' | 'minute', nextValue: number) => {
    const nextDate = selected ? new Date(selected) : new Date()

    if (type === 'hour') {
      nextDate.setHours(nextValue)
    } else {
      nextDate.setMinutes(nextValue)
    }

    nextDate.setSeconds(0, 0)
    commitDate(nextDate)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type='button'
            variant='outline'
            disabled={disabled}
            className={cn(
              'group bg-background hover:bg-background border-input w-full justify-between px-3 font-normal',
              !selected && 'text-muted-foreground'
            )}
          />
        }
      >
        <span className='truncate'>{selected ? format(selected, 'yyyy-MM-dd HH:mm') : placeholder}</span>
        <CalendarIcon size={16} className='text-muted-foreground/80 shrink-0' aria-hidden='true' />
      </PopoverTrigger>
      <PopoverContent className='w-auto max-w-[calc(100vw-2rem)] gap-0 p-0' align='start'>
        <div className='sm:flex'>
          <Calendar
            mode='single'
            selected={selected}
            defaultMonth={selected}
            captionLayout='dropdown'
            onSelect={handleDateSelect}
          />
          <div className='flex flex-col border-t sm:h-[300px] sm:flex-row sm:border-t-0 sm:border-l'>
            <ScrollArea className='w-64 sm:w-14'>
              <div className='flex p-2 sm:flex-col'>
                {Array.from({ length: 24 }, (_, hour) => hour).map(hour => (
                  <Button
                    key={hour}
                    type='button'
                    size='icon'
                    variant={selected?.getHours() === hour ? 'default' : 'ghost'}
                    className='aspect-square shrink-0 sm:w-full'
                    onClick={() => handleTimeChange('hour', hour)}
                  >
                    {hour.toString().padStart(2, '0')}
                  </Button>
                ))}
              </div>
              <ScrollBar orientation='horizontal' className='sm:hidden' />
            </ScrollArea>
            <ScrollArea className='w-64 border-t sm:w-14 sm:border-t-0 sm:border-l'>
              <div className='flex p-2 sm:flex-col'>
                {minuteOptions.map(minute => (
                  <Button
                    key={minute}
                    type='button'
                    size='icon'
                    variant={selected?.getMinutes() === minute ? 'default' : 'ghost'}
                    className='aspect-square shrink-0 sm:w-full'
                    onClick={() => handleTimeChange('minute', minute)}
                  >
                    {minute.toString().padStart(2, '0')}
                  </Button>
                ))}
              </div>
              <ScrollBar orientation='horizontal' className='sm:hidden' />
            </ScrollArea>
          </div>
        </div>
        <div className='flex items-center justify-between gap-2 border-t p-2'>
          <Button type='button' variant='ghost' size='sm' onClick={() => onChange('')}>
            清空
          </Button>
          <div className='flex gap-2'>
            <Button type='button' variant='outline' size='sm' onClick={() => commitDate(new Date())}>
              此刻
            </Button>
            <Button type='button' size='sm' onClick={() => setOpen(false)}>
              确定
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

type RangeTimePanelProps = {
  title: string
  value: Date | undefined
  minuteOptions: number[]
  onChange: (type: 'hour' | 'minute', value: number) => void
}

const RangeTimePanel = ({ title, value, minuteOptions, onChange }: RangeTimePanelProps) => {
  return (
    <div className='flex min-w-0 flex-col gap-2 overflow-hidden p-2 lg:h-full'>
      <div className='text-muted-foreground px-1 text-xs font-medium'>{title}</div>
      <div className='grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-hidden'>
        <ScrollArea className='h-34 w-14 overflow-hidden rounded-md border lg:h-full'>
          <div className='flex flex-col p-1'>
            {Array.from({ length: 24 }, (_, hour) => hour).map(hour => (
              <Button
                key={hour}
                type='button'
                size='icon-sm'
                variant={value?.getHours() === hour ? 'default' : 'ghost'}
                disabled={!value}
                className='w-full shrink-0'
                onClick={() => onChange('hour', hour)}
              >
                {hour.toString().padStart(2, '0')}
              </Button>
            ))}
          </div>
        </ScrollArea>
        <ScrollArea className='h-34 w-14 overflow-hidden rounded-md border lg:h-full'>
          <div className='flex flex-col p-1'>
            {minuteOptions.map(minute => (
              <Button
                key={minute}
                type='button'
                size='icon-sm'
                variant={value?.getMinutes() === minute ? 'default' : 'ghost'}
                disabled={!value}
                className='w-full shrink-0'
                onClick={() => onChange('minute', minute)}
              >
                {minute.toString().padStart(2, '0')}
              </Button>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

/**
 * 业务通用日期时间区间选择器：一个弹层内选择日期区间与起止时间，
 * 点击日期或时间只更新值，统一点击“确定”后关闭弹窗。
 */
export const DateTimeRangePicker = ({
  value,
  onChange,
  id,
  placeholder = '选择日期时间区间',
  disabled,
  minuteStep = 5,
  startPlaceholder = '开始时间',
  endPlaceholder = '结束时间',
  numberOfMonths = 2
}: DateTimeRangePickerProps) => {
  const [open, setOpen] = useState(false)
  const fromDate = parseDateTimeValue(value.from)
  const toDate = parseDateTimeValue(value.to)
  const selected: DateRange | undefined = fromDate || toDate ? { from: fromDate, to: toDate } : undefined

  const minuteOptions = useMemo(() => {
    const selectedMinutes = [fromDate?.getMinutes(), toDate?.getMinutes()].filter(
      (minute): minute is number => Number.isInteger(minute)
    )

    return buildMinuteOptions(minuteStep, selectedMinutes)
  }, [fromDate, minuteStep, toDate])

  const label =
    fromDate && toDate
      ? `${format(fromDate, 'yyyy-MM-dd HH:mm')} 至 ${format(toDate, 'yyyy-MM-dd HH:mm')}`
      : fromDate
        ? `${format(fromDate, 'yyyy-MM-dd HH:mm')} 至 结束时间`
        : placeholder

  const handleRangeSelect = (range: DateRange | undefined) => {
    const nextFrom = range?.from ? new Date(range.from) : undefined
    const nextTo = range?.to ? new Date(range.to) : undefined

    if (nextFrom) {
      nextFrom.setHours(fromDate?.getHours() ?? 0, fromDate?.getMinutes() ?? 0, 0, 0)
    }

    if (nextTo) {
      // 截止端首次选择时默认到当天最后一个分钟，符合“窗口截止时间”的业务直觉。
      nextTo.setHours(toDate?.getHours() ?? 23, toDate?.getMinutes() ?? 59, 0, 0)
    }

    onChange({
      from: nextFrom ? formatDateTimeValue(nextFrom) : '',
      to: nextTo ? formatDateTimeValue(nextTo) : ''
    })
  }

  const handleTimeChange = (side: 'from' | 'to', type: 'hour' | 'minute', nextValue: number) => {
    const base = side === 'from' ? fromDate : toDate

    if (!base) return

    const nextDate = new Date(base)

    if (type === 'hour') {
      nextDate.setHours(nextValue)
    } else {
      nextDate.setMinutes(nextValue)
    }

    nextDate.setSeconds(0, 0)
    onChange({ ...value, [side]: formatDateTimeValue(nextDate) })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type='button'
            variant='outline'
            disabled={disabled}
            className={cn(
              'group bg-background hover:bg-background border-input w-full justify-between px-3 font-normal',
              !fromDate && !toDate && 'text-muted-foreground'
            )}
          />
        }
      >
        <span className='truncate'>{label}</span>
        <CalendarIcon size={16} className='text-muted-foreground/80 shrink-0' aria-hidden='true' />
      </PopoverTrigger>
      <PopoverContent className='w-auto max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0' align='start'>
        <div className='overflow-hidden lg:flex lg:h-[344px]'>
          <Calendar
            mode='range'
            selected={selected}
            defaultMonth={fromDate ?? toDate}
            numberOfMonths={numberOfMonths}
            captionLayout='dropdown'
            onSelect={handleRangeSelect}
          />
          <div className='grid min-h-0 overflow-hidden border-t sm:grid-cols-2 lg:h-full lg:border-t-0 lg:border-l'>
            <RangeTimePanel
              title={startPlaceholder}
              value={fromDate}
              minuteOptions={minuteOptions}
              onChange={(type, nextValue) => handleTimeChange('from', type, nextValue)}
            />
            <RangeTimePanel
              title={endPlaceholder}
              value={toDate}
              minuteOptions={minuteOptions}
              onChange={(type, nextValue) => handleTimeChange('to', type, nextValue)}
            />
          </div>
        </div>
        <div className='flex justify-between border-t p-2'>
          <Button type='button' variant='ghost' size='sm' onClick={() => onChange({ from: '', to: '' })}>
            清空
          </Button>
          <Button type='button' size='sm' onClick={() => setOpen(false)}>
            确定
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
