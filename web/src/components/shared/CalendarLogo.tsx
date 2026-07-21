'use client'

/**
 * 日历 logo：青绿顶栏 + 蓝底，中间为当天（或指定日）的日期数字。
 */

import { cn } from '@/lib/utils'

export type CalendarLogoProps = {
  /** 展示用日期；默认今天 */
  date?: Date
  className?: string
  /** 边长 px，默认 16 */
  size?: number
}

const CalendarLogo = ({ date, className, size = 16 }: CalendarLogoProps) => {
  // 装饰性图标：以本地当天为准；服务端/客户端跨日边界可能差一天，数字节点忽略 hydration 警告
  const day = (date ?? new Date()).getDate()
  const r = Math.max(2, Math.round(size * 0.22))
  const headerH = Math.max(3, Math.round(size * 0.22))
  const fontSize = day >= 10 ? size * 0.42 : size * 0.48

  return (
    <span
      className={cn('inline-flex shrink-0 overflow-hidden', className)}
      style={{ width: size, height: size, borderRadius: r }}
      aria-hidden
    >
      <span className='flex size-full flex-col'>
        <span className='w-full shrink-0' style={{ height: headerH, background: '#14D1A0' }} />
        <span
          className='flex flex-1 items-center justify-center font-bold text-white tabular-nums'
          style={{ background: '#3875FF', fontSize, lineHeight: 1 }}
          suppressHydrationWarning
        >
          {day}
        </span>
      </span>
    </span>
  )
}

export default CalendarLogo
