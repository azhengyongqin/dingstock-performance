'use client'

/**
 * 飞书日程入口：日历 logo（当天日期）+ hover 文案。
 */

import CalendarLogo from '@/components/shared/CalendarLogo'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type FeishuCalendarLinkButtonProps = {
  href: string
  className?: string
  /** 按钮高度类，默认 h-8（表格操作列） */
  sizeClassName?: string
  /** 日历 logo 边长 px，默认 16 */
  logoSize?: number
}

const FeishuCalendarLinkButton = ({
  href,
  className,
  sizeClassName = 'h-8',
  logoSize = 16
}: FeishuCalendarLinkButtonProps) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <Button
          variant='ghost'
          size='sm'
          className={cn(sizeClassName, 'px-1.5', className)}
          aria-label='打开飞书日程'
          render={<a href={href} target='_blank' rel='noreferrer' />}
          nativeButton={false}
        />
      }
    >
      <CalendarLogo size={logoSize} />
    </TooltipTrigger>
    <TooltipContent>打开飞书日程</TooltipContent>
  </Tooltip>
)

export default FeishuCalendarLinkButton
