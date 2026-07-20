'use client'

// 上级评估左侧参考区：被评估人信息 + 自评 / OKR / 360° / 历史 Tab；
// 左右布局收起为侧轨，上下布局收起为顶部条。
import EmployeeBasicInfo from '@/components/shared/EmployeeBasicInfo'
import { ReferencePanelMotionRoot } from '@/components/shared/ReferencePanelCollapse'
import { useEvaluationSplitSideBySide } from '@/components/shared/EvaluationSplitLayout'
import { OkrReferenceContent, useParticipantOkrReference } from '@/components/shared/okr'
import ScrollableTabsList from '@/components/shared/ScrollableTabsList'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsTrigger } from '@/components/ui/tabs'
import {
  avatarUrlOf,
  type PerfDetailedEmployeeProfile,
  type PerfEvaluationDimensionAnswer,
  type ParticipantOkrSnapshot,
  type PerfManagerStageResult,
  type PerfPeerStageResult
} from '@/lib/perf-api'

import PeerReviewAnalysisPanel from './peer-review-analysis-panel'
import SelfReviewReferenceContent from './self-review-reference-content'

export type ManagerReferencePanelProps = {
  participantId: number
  okrPreviewData?: ParticipantOkrSnapshot
  employee: PerfDetailedEmployeeProfile | null
  selfDimensionAnswers: PerfEvaluationDimensionAnswer[]
  peerResult: PerfPeerStageResult | null
  managerResult: PerfManagerStageResult | null
  history: Array<{
    finalLevel: string
    promotionResult?: string | null
    participant: { cycle: { id: number; name: string } }
  }>
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}

const ManagerReferencePanel = ({
  employee,
  participantId,
  okrPreviewData,
  selfDimensionAnswers,
  peerResult,
  managerResult,
  history,
  collapsed,
  onCollapsedChange
}: ManagerReferencePanelProps) => {
  const sideBySide = useEvaluationSplitSideBySide()
  const openId = employee?.open_id
  const name = employee?.name ?? '被评估人'
  const okr = useParticipantOkrReference(participantId, okrPreviewData)

  return (
    <ReferencePanelMotionRoot
      collapsed={collapsed}
      sideBySide={sideBySide}
      openId={openId}
      name={name}
      avatarUrl={avatarUrlOf(employee)}
      onCollapsedChange={onCollapsedChange}
    >
      {/* 系统计算结果始终可见，避免藏在 Tab 内影响提交后反馈 */}
      {managerResult?.status === 'READY' && (
        <div className='flex shrink-0 flex-wrap gap-2 border-t px-4 py-3'>
          <Badge variant='outline'>综合分 {managerResult.compositeScore}</Badge>
          <Badge variant='outline'>初始等级 {managerResult.initialLevel}</Badge>
          <Badge>阶段等级 {managerResult.stageLevel}</Badge>
        </div>
      )}

      <Tabs defaultValue='info' className='flex min-h-0 flex-1 flex-col gap-0 overflow-hidden'>
        <ScrollableTabsList>
          <TabsTrigger value='info' className='shrink-0'>
            基本信息
          </TabsTrigger>
          <TabsTrigger value='self' className='shrink-0'>
            员工自评
          </TabsTrigger>
          <TabsTrigger value='okr' className='shrink-0'>
            OKR
          </TabsTrigger>
          <TabsTrigger value='peer' className='shrink-0'>
            360°评估
          </TabsTrigger>
          <TabsTrigger value='more' className='shrink-0'>
            更多
          </TabsTrigger>
        </ScrollableTabsList>

        <ScrollArea className='h-0 min-h-0 flex-1'>
          <TabsContent value='info' className='px-4 py-5'>
            <EmployeeBasicInfo variant='detailed' employee={employee} />
          </TabsContent>

          <TabsContent value='self' className='px-4 py-4'>
            <SelfReviewReferenceContent
              selfDimensionAnswers={selfDimensionAnswers}
              notice='员工材料仅供参考，不参与上级阶段二次加权。'
            />
          </TabsContent>

          <TabsContent value='okr' className='space-y-5 px-4 py-4'>
            <OkrReferenceContent data={okr.data} loading={okr.loading} onSync={okr.sync} />
          </TabsContent>

          {/* 上间距交给面板内吸顶块，避免滚动后贴死 ScrollableTabsList */}
          <TabsContent value='peer' className='px-4 pt-0 pb-4'>
            {peerResult ? (
              <PeerReviewAnalysisPanel result={peerResult} />
            ) : (
              <p className='text-muted-foreground pt-4 text-sm'>暂无 360°评估数据</p>
            )}
          </TabsContent>

          <TabsContent value='more' className='space-y-3 px-4 py-4'>
            <p className='text-sm font-medium'>历史绩效</p>
            {history.length > 0 ? (
              <ul className='divide-border divide-y'>
                {history.map(item => (
                  <li
                    key={item.participant.cycle.id}
                    className='flex items-center justify-between gap-3 py-2.5 text-sm'
                  >
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
    </ReferencePanelMotionRoot>
  )
}

export default ManagerReferencePanel
