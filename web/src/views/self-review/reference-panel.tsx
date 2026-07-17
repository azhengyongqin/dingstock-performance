'use client'

// 自评页左侧参考区：员工信息 + OKR / 复盘 / 日志 Tab；Tab 内容区独立滚动。
// 左右布局收起为侧轨，上下布局收起为顶部条。
import EmployeeBasicInfo from '@/components/shared/EmployeeBasicInfo'
import { ReferencePanelMotionRoot } from '@/components/shared/ReferencePanelCollapse'
import { useEvaluationSplitSideBySide } from '@/components/shared/EvaluationSplitLayout'
import { OkrReferenceContent, useParticipantOkr } from '@/components/shared/okr'
import ScrollableTabsList from '@/components/shared/ScrollableTabsList'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsTrigger } from '@/components/ui/tabs'
import { avatarUrlOf, type PerfDetailedEmployeeProfile } from '@/lib/perf-api'

import { REFERENCE_LOGS, REFERENCE_REVIEWS } from './reference-mock-data'

export type ReferencePanelProps = {
  participantId: number
  employee: PerfDetailedEmployeeProfile | null
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}

const ReferencePanel = ({ participantId, employee, collapsed, onCollapsedChange }: ReferencePanelProps) => {
  const sideBySide = useEvaluationSplitSideBySide()
  const okr = useParticipantOkr(participantId)
  const openId = employee?.open_id
  const name = employee?.name ?? '员工'

  return (
    <ReferencePanelMotionRoot
      collapsed={collapsed}
      sideBySide={sideBySide}
      openId={openId}
      name={name}
      avatarUrl={avatarUrlOf(employee)}
      onCollapsedChange={onCollapsedChange}
    >
      <Tabs defaultValue='info' className='flex min-h-0 flex-1 flex-col gap-0 overflow-hidden'>
        <ScrollableTabsList>
          <TabsTrigger value='info' className='shrink-0'>
            基本信息
          </TabsTrigger>
          <TabsTrigger value='okr' className='shrink-0'>
            OKR 内容
          </TabsTrigger>
          <TabsTrigger value='review' className='shrink-0'>
            复盘记录
          </TabsTrigger>
          <TabsTrigger value='log' className='shrink-0'>
            绩效日志
          </TabsTrigger>
        </ScrollableTabsList>

        <ScrollArea className='h-0 min-h-0 flex-1'>
          <TabsContent value='info' className='px-4 py-5'>
            <EmployeeBasicInfo variant='detailed' employee={employee} />
          </TabsContent>

          <TabsContent value='okr' className='space-y-5 px-4 py-4'>
            <OkrReferenceContent data={okr.data} loading={okr.loading} onSync={okr.sync} />
          </TabsContent>

          <TabsContent value='review' className='space-y-3 px-4 py-4'>
            {REFERENCE_REVIEWS.map(item => (
              <article key={item.id} className='rounded-lg border px-3 py-3'>
                <div className='mb-1 flex items-center justify-between gap-2'>
                  <h4 className='text-sm font-medium'>{item.title}</h4>
                  <span className='text-muted-foreground text-xs'>{item.updatedAt}</span>
                </div>
                <p className='text-muted-foreground text-sm'>{item.summary}</p>
              </article>
            ))}
          </TabsContent>

          <TabsContent value='log' className='space-y-3 px-4 py-4'>
            {REFERENCE_LOGS.map(item => (
              <article key={item.id} className='border-b px-1 py-3 last:border-0'>
                <div className='mb-1 flex items-center gap-2'>
                  <Badge variant='outline' className='text-[10px]'>
                    {item.weekLabel}
                  </Badge>
                  <span className='text-muted-foreground text-xs'>{item.date}</span>
                </div>
                <h4 className='text-sm font-medium'>{item.title}</h4>
                <p className='text-muted-foreground mt-1 text-sm'>{item.snippet}</p>
              </article>
            ))}
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </ReferencePanelMotionRoot>
  )
}

export default ReferencePanel
