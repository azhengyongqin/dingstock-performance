'use client'

// 自评页左侧参考区：员工信息 + OKR / 复盘 / 日志 Tab；Tab 内容区独立滚动。
import { ChevronLeftIcon, ChevronRightIcon, EyeIcon } from 'lucide-react'

import { UserAvatar } from '@/components/shared/lark'
import { OkrReferenceContent, useParticipantOkr } from '@/components/shared/okr'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { REFERENCE_LOGS, REFERENCE_REVIEWS } from './reference-mock-data'
import { useEmployeeBrief } from './use-employee-brief'

export type ReferencePanelProps = {
  participantId: number
  employeeOpenId: string
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}

const ReferencePanel = ({ participantId, employeeOpenId, collapsed, onCollapsedChange }: ReferencePanelProps) => {
  const { brief, loading } = useEmployeeBrief(employeeOpenId)
  const okr = useParticipantOkr(participantId)

  if (collapsed) {
    return (
      <div className='flex h-full w-12 flex-col items-center gap-3 py-4'>
        <Button
          type='button'
          size='icon'
          variant='ghost'
          aria-label='展开参考区'
          onClick={() => onCollapsedChange(false)}
        >
          <ChevronRightIcon className='size-4' />
        </Button>
        <UserAvatar openId={employeeOpenId} name={brief?.name} avatarUrl={brief?.avatarUrl} size='sm' />
        <span className='text-muted-foreground text-[10px] tracking-widest' style={{ writingMode: 'vertical-rl' }}>
          参考资料
        </span>
      </div>
    )
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex shrink-0 items-center gap-3 px-4 py-4'>
        <UserAvatar openId={employeeOpenId} name={brief?.name} avatarUrl={brief?.avatarUrl} size='lg' />
        <div className='min-w-0 flex-1'>
          <p className='truncate text-base font-semibold'>{loading ? '加载中…' : (brief?.name ?? '员工')}</p>
          <p className='text-muted-foreground truncate text-xs'>{brief?.jobTitle || employeeOpenId}</p>
        </div>
        <Button
          type='button'
          size='icon'
          variant='ghost'
          aria-label='收起参考区'
          onClick={() => onCollapsedChange(true)}
        >
          <ChevronLeftIcon className='size-4' />
        </Button>
      </div>

      <Tabs defaultValue='okr' className='flex min-h-0 flex-1 flex-col gap-0'>
        <div className='flex shrink-0 items-center justify-between gap-2 border-y px-3 pt-2'>
          <TabsList variant='line' className='h-10'>
            <TabsTrigger value='okr'>OKR 内容</TabsTrigger>
            <TabsTrigger value='review'>复盘记录</TabsTrigger>
            <TabsTrigger value='log'>绩效日志</TabsTrigger>
          </TabsList>
          <Button type='button' variant='ghost' size='sm' className='text-muted-foreground shrink-0 text-xs'>
            <EyeIcon className='size-3.5' />
            OKR 详情
          </Button>
        </div>

        <ScrollArea className='h-0 min-h-0 flex-1'>
          <TabsContent value='okr' className='space-y-5 px-4 py-4'>
            <OkrReferenceContent data={okr.data} loading={okr.loading} error={okr.error} onRetry={okr.retry} />
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
    </div>
  )
}

export default ReferencePanel
