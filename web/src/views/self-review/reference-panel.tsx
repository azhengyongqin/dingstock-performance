'use client'

// 自评页左侧参考区：员工信息 + OKR / 复盘 / 日志 Tab，支持收起为窄轨。
import { ChevronLeftIcon, ChevronRightIcon, EyeIcon } from 'lucide-react'

import { UserAvatar } from '@/components/shared/lark'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { REFERENCE_LOGS, REFERENCE_OKR, REFERENCE_REVIEWS } from './reference-mock-data'
import { useEmployeeBrief } from './use-employee-brief'

export type ReferencePanelProps = {
  employeeOpenId: string
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}

const ReferencePanel = ({ employeeOpenId, collapsed, onCollapsedChange }: ReferencePanelProps) => {
  const { brief, loading } = useEmployeeBrief(employeeOpenId)

  if (collapsed) {
    return (
      <div className='flex h-full min-h-72 w-12 flex-col items-center gap-3 py-4'>
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
    <div className='flex h-full flex-col'>
      <div className='flex items-center gap-3 px-4 py-4'>
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

      <Tabs defaultValue='okr' className='gap-0'>
        <div className='flex items-center justify-between gap-2 border-y px-3 pt-2'>
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

        <ScrollArea className='h-[min(62vh,560px)]'>
          <TabsContent value='okr' className='space-y-5 px-4 py-4'>
            {REFERENCE_OKR.map(objective => (
              <div key={objective.id} className='space-y-3'>
                <div className='flex items-start gap-2.5'>
                  <span className='bg-primary text-primary-foreground mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold'>
                    {objective.label}
                  </span>
                  <div className='min-w-0 flex-1 space-y-2'>
                    <div className='flex items-start justify-between gap-2'>
                      <p className='text-sm font-medium'>{objective.title}</p>
                      <span className='text-muted-foreground shrink-0 text-xs'>总权重：{objective.totalWeight}%</span>
                    </div>
                    <Progress value={objective.progress} className='w-full' />
                  </div>
                </div>
                <ul className='divide-border ml-8 divide-y'>
                  {objective.keyResults.map(kr => (
                    <li key={kr.id} className='flex items-start justify-between gap-3 py-2.5 text-sm'>
                      <p className='text-muted-foreground min-w-0'>
                        <span className='text-foreground font-medium'>{kr.label}</span> {kr.content}
                        {kr.mentions?.map(name => (
                          <span key={name} className='text-primary ml-1'>
                            @{name}
                          </span>
                        ))}
                      </p>
                      <span className='text-muted-foreground shrink-0 text-xs'>{kr.weight}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className='text-muted-foreground text-center text-[11px]'>暂为占位数据，接入飞书 OKR 后替换</p>
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
