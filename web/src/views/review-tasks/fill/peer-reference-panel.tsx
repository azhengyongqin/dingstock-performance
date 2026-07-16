'use client'

// 360°评估左侧参考区：被评估人信息 + 员工自评 / OKR Tab，支持收起为窄轨。
import { ChevronLeftIcon, ChevronRightIcon, EyeIcon } from 'lucide-react'

import { UserAvatar } from '@/components/shared/lark'
import EmployeeBasicInfo from '@/components/shared/EmployeeBasicInfo'
import { EvaluationAnswerContent } from '@/components/shared/markdown'
import { OkrReferenceContent, useParticipantOkrReference } from '@/components/shared/okr'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  avatarUrlOf,
  type PerfConfigReviewerRelation,
  type PerfPeerSafeEmployeeProfile,
  type ParticipantOkrSnapshot,
  type PerfEvaluationItemResult
} from '@/lib/perf-api'

export type PeerReferencePanelProps = {
  participantId: number
  okrPreviewData?: ParticipantOkrSnapshot
  employee: PerfPeerSafeEmployeeProfile | null
  relation?: PerfConfigReviewerRelation | null
  selfItems: PerfEvaluationItemResult[]
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}

const resultValue = (item: PerfEvaluationItemResult) => {
  if (item.rawLevel) return item.rawLevel
  if (item.rawScore != null) return String(item.rawScore)
  if (typeof item.value === 'string') return item.value
  if (Array.isArray(item.value)) return item.value.map(String).join('、')
  if (item.value != null) return JSON.stringify(item.value)

  return '—'
}

const PeerReferencePanel = ({
  employee,
  participantId,
  okrPreviewData,
  relation,
  selfItems,
  collapsed,
  onCollapsedChange
}: PeerReferencePanelProps) => {
  const openId = employee?.open_id
  const name = employee?.name ?? '被评估人'
  const okr = useParticipantOkrReference(participantId, okrPreviewData)

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
        <UserAvatar openId={openId} name={name} avatarUrl={avatarUrlOf(employee)} size='sm' />
        <span className='text-muted-foreground text-[10px] tracking-widest' style={{ writingMode: 'vertical-rl' }}>
          参考资料
        </span>
      </div>
    )
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex shrink-0 items-center gap-3 px-4 py-4'>
        <UserAvatar openId={openId} name={name} avatarUrl={avatarUrlOf(employee)} size='lg' />
        <div className='min-w-0 flex-1'>
          <p className='truncate text-base font-semibold'>{name}</p>
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

      <Tabs defaultValue='info' className='flex min-h-0 flex-1 flex-col gap-0'>
        <div className='flex shrink-0 items-center justify-between gap-2 overflow-x-auto border-y px-3 pt-2'>
          <TabsList variant='line' className='h-10 w-max min-w-full flex-nowrap'>
            <TabsTrigger value='info' className='shrink-0'>
              基本信息
            </TabsTrigger>
            <TabsTrigger value='self'>员工自评</TabsTrigger>
            <TabsTrigger value='okr'>OKR</TabsTrigger>
          </TabsList>
          <Button type='button' variant='ghost' size='sm' className='text-muted-foreground shrink-0 text-xs'>
            <EyeIcon className='size-3.5' />
            OKR 详情
          </Button>
        </div>

        <ScrollArea className='h-0 min-h-0 flex-1'>
          <TabsContent value='info' className='px-4 py-5'>
            <EmployeeBasicInfo variant='peer' employee={employee} relation={relation} />
          </TabsContent>

          <TabsContent value='self' className='space-y-3 px-4 py-4'>
            <p className='text-muted-foreground text-xs'>仅展示员工已生效自评摘要，供填写 360° 时对照参考。</p>
            {selfItems.length > 0 ? (
              selfItems.map(item => (
                <article key={item.id} className='rounded-lg border px-3 py-3'>
                  <p className='text-muted-foreground mb-1 text-[11px]'>{item.itemKey}</p>
                  <EvaluationAnswerContent type={item.itemType} value={resultValue(item)} />
                </article>
              ))
            ) : (
              <p className='text-muted-foreground text-sm'>员工尚无生效自评</p>
            )}
          </TabsContent>

          <TabsContent value='okr' className='space-y-5 px-4 py-4'>
            <OkrReferenceContent data={okr.data} loading={okr.loading} onSync={okr.sync} />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  )
}

export default PeerReferencePanel
