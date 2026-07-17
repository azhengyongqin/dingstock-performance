'use client'

// 360°评估左侧参考区：被评估人信息 + 员工自评 / OKR Tab；
// 左右布局收起为侧轨，上下布局收起为顶部条。
import EmployeeBasicInfo from '@/components/shared/EmployeeBasicInfo'
import { ReferencePanelMotionRoot } from '@/components/shared/ReferencePanelCollapse'
import { useEvaluationSplitSideBySide } from '@/components/shared/EvaluationSplitLayout'
import { OkrReferenceContent, useParticipantOkrReference } from '@/components/shared/okr'
import ScrollableTabsList from '@/components/shared/ScrollableTabsList'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsTrigger } from '@/components/ui/tabs'
import {
  avatarUrlOf,
  type PerfConfigReviewerRelation,
  type PerfPeerSafeEmployeeProfile,
  type ParticipantOkrSnapshot,
  type PerfEvaluationItemResult
} from '@/lib/perf-api'

import SelfReviewReferenceContent from './self-review-reference-content'

export type PeerReferencePanelProps = {
  participantId: number
  okrPreviewData?: ParticipantOkrSnapshot
  employee: PerfPeerSafeEmployeeProfile | null
  relation?: PerfConfigReviewerRelation | null
  selfItems: PerfEvaluationItemResult[]
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
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
        </ScrollableTabsList>

        <ScrollArea className='h-0 min-h-0 flex-1'>
          <TabsContent value='info' className='px-4 py-5'>
            <EmployeeBasicInfo variant='peer' employee={employee} relation={relation} />
          </TabsContent>

          <TabsContent value='self' className='px-4 py-4'>
            <SelfReviewReferenceContent
              selfItems={selfItems}
              notice='仅展示员工已生效自评摘要，供填写 360° 时对照参考。'
            />
          </TabsContent>

          <TabsContent value='okr' className='space-y-5 px-4 py-4'>
            <OkrReferenceContent data={okr.data} loading={okr.loading} onSync={okr.sync} />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </ReferencePanelMotionRoot>
  )
}

export default PeerReferencePanel
