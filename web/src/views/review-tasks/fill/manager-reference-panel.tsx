'use client'

// 上级评估左侧参考区：被评估人信息 + 自评 / OKR / 360° / 历史 Tab，支持收起为窄轨。
import { ChevronLeftIcon, ChevronRightIcon, EyeIcon } from 'lucide-react'

import { UserAvatar } from '@/components/shared/lark'
import { OkrReferenceContent, useParticipantOkrReference } from '@/components/shared/okr'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  avatarUrlOf,
  type LarkUserBrief,
  type ParticipantOkrSnapshot,
  type PerfEvaluationItemResult,
  type PerfManagerStageResult
} from '@/lib/perf-api'

export type ManagerReferencePanelProps = {
  participantId: number
  okrPreviewData?: ParticipantOkrSnapshot
  employee: LarkUserBrief | null
  selfItems: PerfEvaluationItemResult[]
  peerResult: (PerfManagerStageResult & { inputSummary?: unknown }) | null
  managerResult: PerfManagerStageResult | null
  history: Array<{
    finalLevel: string
    promotionResult?: string | null
    participant: { cycle: { id: number; name: string } }
  }>
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

const ManagerReferencePanel = ({
  employee,
  participantId,
  okrPreviewData,
  selfItems,
  peerResult,
  managerResult,
  history,
  collapsed,
  onCollapsedChange
}: ManagerReferencePanelProps) => {
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
          <p className='text-muted-foreground truncate text-xs'>{employee?.job_title || openId || '—'}</p>
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

      {/* 系统计算结果始终可见，避免藏在 Tab 内影响提交后反馈 */}
      {managerResult?.status === 'READY' && (
        <div className='flex shrink-0 flex-wrap gap-2 border-t px-4 py-3'>
          <Badge variant='outline'>综合分 {managerResult.compositeScore}</Badge>
          <Badge variant='outline'>初始等级 {managerResult.initialLevel}</Badge>
          <Badge>阶段等级 {managerResult.stageLevel}</Badge>
        </div>
      )}

      <Tabs defaultValue='self' className='flex min-h-0 flex-1 flex-col gap-0'>
        <div className='flex shrink-0 items-center justify-between gap-2 border-y px-3 pt-2'>
          <TabsList variant='line' className='h-10'>
            <TabsTrigger value='self'>员工自评</TabsTrigger>
            <TabsTrigger value='okr'>OKR</TabsTrigger>
            <TabsTrigger value='peer'>360°评估</TabsTrigger>
            <TabsTrigger value='more'>更多</TabsTrigger>
          </TabsList>
          <Button type='button' variant='ghost' size='sm' className='text-muted-foreground shrink-0 text-xs'>
            <EyeIcon className='size-3.5' />
            OKR 详情
          </Button>
        </div>

        <ScrollArea className='h-0 min-h-0 flex-1'>
          <TabsContent value='self' className='space-y-3 px-4 py-4'>
            <p className='text-muted-foreground text-xs'>员工材料仅供参考，不参与上级阶段二次加权。</p>
            {selfItems.length > 0 ? (
              selfItems.map(item => (
                <article key={item.id} className='rounded-lg border px-3 py-3'>
                  <p className='text-muted-foreground mb-1 text-[11px]'>{item.itemKey}</p>
                  <p className='text-sm whitespace-pre-wrap'>{resultValue(item)}</p>
                </article>
              ))
            ) : (
              <p className='text-muted-foreground text-sm'>员工尚无生效自评</p>
            )}
          </TabsContent>

          <TabsContent value='okr' className='space-y-5 px-4 py-4'>
            <OkrReferenceContent data={okr.data} loading={okr.loading} onSync={okr.sync} />
          </TabsContent>

          <TabsContent value='peer' className='space-y-3 px-4 py-4'>
            <p className='text-muted-foreground text-xs'>仅展示汇总结果，不把 360°等级再次合入权威等级。</p>
            {peerResult?.status === 'READY' ? (
              <>
                <div className='flex flex-wrap gap-2'>
                  <Badge variant='outline'>综合分 {peerResult.compositeScore}</Badge>
                  <Badge variant='outline'>阶段等级 {peerResult.stageLevel}</Badge>
                  <Badge variant='outline'>{peerResult.reviewerCount} 人有效</Badge>
                </div>
                <ul className='divide-border divide-y'>
                  {peerResult.dimensions.map(dimension => (
                    <li key={dimension.id} className='flex items-center justify-between gap-3 py-2.5 text-sm'>
                      <span>{dimension.name}</span>
                      <span className='text-muted-foreground'>
                        {dimension.score} · {dimension.level}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className='text-muted-foreground text-sm'>暂无有效 360°结果</p>
            )}
          </TabsContent>

          <TabsContent value='more' className='space-y-3 px-4 py-4'>
            <p className='text-sm font-medium'>历史绩效</p>
            {history.length > 0 ? (
              <ul className='divide-border divide-y'>
                {history.map(item => (
                  <li key={item.participant.cycle.id} className='flex items-center justify-between gap-3 py-2.5 text-sm'>
                    <span className='truncate'>{item.participant.cycle.name}</span>
                    <div className='flex shrink-0 items-center gap-2'>
                      <Badge variant='outline'>{item.finalLevel}</Badge>
                      {item.promotionResult && <Badge variant='secondary'>{item.promotionResult}</Badge>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className='text-muted-foreground text-sm'>暂无历史绩效记录</p>
            )}
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  )
}

export default ManagerReferencePanel
