'use client'

import CalendarLogo from '@/components/shared/CalendarLogo'
import FeishuCalendarLinkButton from '@/components/shared/FeishuCalendarLinkButton'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/** component-test：日历 logo + 飞书日程入口 */
const FeishuCalendarLinkButtonPreview = () => (
  <div className='grid gap-6'>
    <Card>
      <CardHeader>
        <CardTitle>CalendarLogo</CardTitle>
        <CardDescription>青绿顶栏 + 蓝底，中间为当天日期（方案 A）</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-wrap items-end gap-6'>
        {[16, 20, 28, 40].map(size => (
          <div key={size} className='flex flex-col items-center gap-2'>
            <CalendarLogo size={size} />
            <span className='text-muted-foreground text-[10px]'>{size}px</span>
          </div>
        ))}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>FeishuCalendarLinkButton</CardTitle>
        <CardDescription>日程入口：CalendarLogo + hover「打开飞书日程」</CardDescription>
      </CardHeader>
      <CardContent className='flex items-center gap-3'>
        <FeishuCalendarLinkButton href='https://applink.feishu.cn/client/calendar/event/detail?calendarId=demo&eventId=demo' />
        <FeishuCalendarLinkButton
          href='https://applink.feishu.cn/client/calendar/event/detail?calendarId=demo&eventId=demo'
          sizeClassName='h-7'
          logoSize={14}
        />
        <span className='text-muted-foreground text-xs'>左 h-8 / 右 h-7</span>
      </CardContent>
    </Card>
  </div>
)

export default FeishuCalendarLinkButtonPreview
