'use client'

// React Imports
import { useEffect, useMemo, useRef, useState } from 'react'

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

const HALF_HOUR_MS = 30 * 60 * 1000

/**
 * 取「当前时刻之后」最近的半点或整点（:00 / :30）。
 * 例：21:14 → 21:30；21:45 → 22:00；恰在半点则再往后推一格。
 */
export const ceilToNextHalfHour = (date: Date = new Date()): Date => {
  const next = new Date(date)
  const minutes = next.getMinutes()

  const onHalfHourMark =
    (minutes === 0 || minutes === 30) && next.getSeconds() === 0 && next.getMilliseconds() === 0

  next.setSeconds(0, 0)

  if (onHalfHourMark) {
    // 已在半点/整点：严格往后一格，避免默认落到「现在」
    if (minutes === 0) next.setMinutes(30)
    else next.setHours(next.getHours() + 1, 0, 0, 0)
  } else if (minutes < 30) {
    next.setMinutes(30)
  } else {
    next.setHours(next.getHours() + 1, 0, 0, 0)
  }

  return next
}

/**
 * 预约类默认区间：开始 = 下一半点，结束 = 开始 + durationMinutes（默认 30 分钟）。
 */
export const createDefaultDateTimeRange = (
  now: Date = new Date(),
  durationMinutes = 30
): DateTimeRangeValue => {
  const from = ceilToNextHalfHour(now)
  const to = new Date(from.getTime() + Math.max(durationMinutes, 1) * 60 * 1000)

  return {
    from: formatDateTimeValue(from),
    to: formatDateTimeValue(to)
  }
}

/** 保证结束严格晚于开始；否则把结束推到开始后 30 分钟 */
const ensureRangeOrder = (from: string, to: string): DateTimeRangeValue => {
  const fromDate = parseDateTimeValue(from)
  const toDate = parseDateTimeValue(to)

  if (!fromDate || !toDate) return { from, to }

  if (toDate.getTime() > fromDate.getTime()) return { from, to }

  return {
    from,
    to: formatDateTimeValue(new Date(fromDate.getTime() + HALF_HOUR_MS))
  }
}

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

type DayTimeSlot = {
  hours: number
  minutes: number
  label: string
}

/** 按步长生成当天 HH:mm 列表；当前值若不在步长上则插入，避免选中项消失 */
const buildDayTimeSlots = (minuteStep: number, selected?: Date): DayTimeSlot[] => {
  const step = Math.min(Math.max(Math.trunc(minuteStep) || 30, 1), 60)
  const slots = new Map<string, DayTimeSlot>()

  for (let minutesOfDay = 0; minutesOfDay < 24 * 60; minutesOfDay += step) {
    const hours = Math.floor(minutesOfDay / 60)
    const minutes = minutesOfDay % 60
    const label = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`

    slots.set(`${hours}:${minutes}`, { hours, minutes, label })
  }

  if (selected) {
    const hours = selected.getHours()
    const minutes = selected.getMinutes()
    const key = `${hours}:${minutes}`

    if (!slots.has(key)) {
      slots.set(key, {
        hours,
        minutes,
        label: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
      })
    }
  }

  return [...slots.values()].sort((a, b) => a.hours * 60 + a.minutes - (b.hours * 60 + b.minutes))
}

type RangeTimePanelProps = {
  title: string
  value: Date | undefined
  minuteStep: number

  /** 弹层打开等时机变化时重滚到选中项中间 */
  scrollToken?: boolean
  onChange: (hours: number, minutes: number) => void
}

/**
 * 合并时分的单列时间列表（如图：00:00 / 00:30 …）；
 * 选中项在可滚动时尽量滚到视口垂直中间（两端不够则贴边）。
 */
const RangeTimePanel = ({ title, value, minuteStep, scrollToken, onChange }: RangeTimePanelProps) => {
  const listRef = useRef<HTMLDivElement>(null)
  const selectedKey = value ? `${value.getHours()}:${value.getMinutes()}` : null

  const slots = useMemo(() => {
    if (!selectedKey) return buildDayTimeSlots(minuteStep)

    const [hours, minutes] = selectedKey.split(':').map(Number)
    const selected = new Date()

    selected.setHours(hours, minutes, 0, 0)

    return buildDayTimeSlots(minuteStep, selected)
  }, [minuteStep, selectedKey])

  useEffect(() => {
    if (!selectedKey) return

    const frame = requestAnimationFrame(() => {
      const list = listRef.current
      const selectedEl = list?.querySelector<HTMLElement>('[data-slot="time-slot"][data-selected="true"]')
      const viewport = list?.closest('[data-slot="scroll-area-viewport"]') as HTMLElement | null

      if (!selectedEl || !viewport) return

      const viewportRect = viewport.getBoundingClientRect()
      const selectedRect = selectedEl.getBoundingClientRect()

      const delta =
        selectedRect.top + selectedRect.height / 2 - (viewportRect.top + viewportRect.height / 2)

      if (Math.abs(delta) < 1) return

      // 只滚时间列表视口，避免带动弹层/页面；两端不够时由浏览器自然贴边
      viewport.scrollTop += delta
    })

    return () => cancelAnimationFrame(frame)
  }, [selectedKey, scrollToken])

  return (
    <div className='flex min-w-0 flex-col gap-2 overflow-hidden p-2 lg:h-full'>
      <div className='text-muted-foreground px-1 text-xs font-medium'>{title}</div>
      <ScrollArea className='h-34 min-w-[5.5rem] overflow-hidden rounded-md border lg:h-full'>
        <div ref={listRef} className='flex flex-col p-1'>
          {slots.map(slot => {
            const selected = selectedKey === `${slot.hours}:${slot.minutes}`

            return (
              <Button
                key={slot.label}
                type='button'
                size='sm'
                variant={selected ? 'default' : 'ghost'}
                disabled={!value}
                data-slot='time-slot'
                data-selected={selected ? 'true' : undefined}
                className='h-8 w-full shrink-0 justify-start px-2.5 font-normal tabular-nums'
                onClick={() => onChange(slot.hours, slot.minutes)}
              >
                {slot.label}
              </Button>
            )
          })}
        </div>
      </ScrollArea>
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
  minuteStep = 30,
  startPlaceholder = '开始时间',
  endPlaceholder = '结束时间',
  numberOfMonths = 2
}: DateTimeRangePickerProps) => {
  const [open, setOpen] = useState(false)
  const fromDate = parseDateTimeValue(value.from)
  const toDate = parseDateTimeValue(value.to)
  const selected: DateRange | undefined = fromDate || toDate ? { from: fromDate, to: toDate } : undefined

  const label =
    fromDate && toDate
      ? `${format(fromDate, 'yyyy-MM-dd HH:mm')} 至 ${format(toDate, 'yyyy-MM-dd HH:mm')}`
      : fromDate
        ? `${format(fromDate, 'yyyy-MM-dd HH:mm')} 至 结束时间`
        : placeholder

  const handleRangeSelect = (range: DateRange | undefined) => {
    const nextFrom = range?.from ? new Date(range.from) : undefined
    const nextTo = range?.to ? new Date(range.to) : undefined

    // 首次落时分：用「下一半点」；已有值则保留用户调过的时分
    const defaultStart = ceilToNextHalfHour()

    if (nextFrom) {
      if (fromDate) {
        nextFrom.setHours(fromDate.getHours(), fromDate.getMinutes(), 0, 0)
      } else {
        nextFrom.setHours(defaultStart.getHours(), defaultStart.getMinutes(), 0, 0)
      }
    }

    if (nextTo) {
      if (toDate) {
        nextTo.setHours(toDate.getHours(), toDate.getMinutes(), 0, 0)
      } else if (nextFrom) {
        const defaultEnd = new Date(nextFrom.getTime() + HALF_HOUR_MS)

        nextTo.setHours(defaultEnd.getHours(), defaultEnd.getMinutes(), 0, 0)
      } else {
        nextTo.setHours(defaultStart.getHours(), defaultStart.getMinutes(), 0, 0)
      }
    }

    const from = nextFrom ? formatDateTimeValue(nextFrom) : ''
    const to = nextTo ? formatDateTimeValue(nextTo) : ''

    onChange(ensureRangeOrder(from, to))
  }

  const handleTimeSelect = (side: 'from' | 'to', hours: number, minutes: number) => {
    const base = side === 'from' ? fromDate : toDate

    if (!base) return

    const nextDate = new Date(base)

    nextDate.setHours(hours, minutes, 0, 0)

    if (side === 'from') {
      onChange(
        ensureRangeOrder(formatDateTimeValue(nextDate), value.to || formatDateTimeValue(nextDate))
      )

      return
    }

    onChange(
      ensureRangeOrder(value.from || formatDateTimeValue(nextDate), formatDateTimeValue(nextDate))
    )
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
              minuteStep={minuteStep}
              scrollToken={open}
              onChange={(hours, minutes) => handleTimeSelect('from', hours, minutes)}
            />
            <RangeTimePanel
              title={endPlaceholder}
              value={toDate}
              minuteStep={minuteStep}
              scrollToken={open}
              onChange={(hours, minutes) => handleTimeSelect('to', hours, minutes)}
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
