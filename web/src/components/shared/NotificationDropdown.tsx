import type { ReactElement } from 'react'

import { BellRingIcon, CalendarClockIcon, FilePenIcon, SlidersHorizontalIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

type Props = {
  trigger: ReactElement
  defaultOpen?: boolean
  align?: 'start' | 'center' | 'end'
}

// 静态占位通知数据（框架阶段，后续接入飞书通知/站内信）
const MOCK_NOTIFICATIONS = [
  {
    icon: FilePenIcon,
    title: '员工自评即将截止',
    description: '2026 H1 绩效周期自评窗口将于 3 天后关闭',
    time: '10 分钟前'
  },
  {
    icon: CalendarClockIcon,
    title: '评审任务已分配',
    description: '你有 4 条新的 360° 评估任务待处理',
    time: '1 小时前'
  },
  {
    icon: SlidersHorizontalIcon,
    title: '校准会议提醒',
    description: '研发一部绩效校准会议定于本周五 14:00',
    time: '昨天'
  }
]

/**
 * 顶栏通知下拉（静态占位版）。
 */
const NotificationDropdown = ({ trigger, defaultOpen, align = 'end' }: Props) => {
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent className='w-full max-w-xs sm:max-w-96' align={align || 'end'}>
        <DropdownMenuGroup>
          <DropdownMenuLabel className='flex items-center justify-between gap-6'>
            <span className='text-muted-foreground text-sm font-normal uppercase'>通知</span>
            <Badge variant='secondary' className='bg-primary/10 text-primary font-normal'>
              {MOCK_NOTIFICATIONS.length} 条新通知
            </Badge>
          </DropdownMenuLabel>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {MOCK_NOTIFICATIONS.map((notification, index) => (
          <DropdownMenuItem key={index} className='items-start gap-3 px-2 py-3'>
            <div className='bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-full'>
              <notification.icon className='size-4.5' />
            </div>
            <div className='flex w-full flex-col items-start gap-0.5'>
              <span className='text-sm font-medium'>{notification.title}</span>
              <span className='text-muted-foreground text-sm'>{notification.description}</span>
              <span className='text-muted-foreground text-xs'>{notification.time}</span>
            </div>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        <DropdownMenuItem className='justify-center gap-2'>
          <BellRingIcon className='size-4' />
          <span>查看全部通知</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default NotificationDropdown
