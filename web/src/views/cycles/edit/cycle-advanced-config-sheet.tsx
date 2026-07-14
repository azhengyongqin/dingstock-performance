'use client'

import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { PerfConfigTemplateVersion, PerfCycleConfigSnapshot } from '@/lib/perf-api'
import ConfigTemplateEditor from '@/views/settings/templates/config-template-editor'

const toEditorValue = (snapshot: PerfCycleConfigSnapshot): PerfConfigTemplateVersion => ({
  id: snapshot.id,
  templateId: snapshot.source?.templateId ?? 0,
  name: snapshot.source?.name ?? `周期配置快照 v${snapshot.version}`,
  version: snapshot.version,
  status: 'PUBLISHED',
  updatedAt: '',
  stageModes: snapshot.stageModes,
  ratings: snapshot.ratings,
  constraintProfiles: snapshot.constraintProfiles,
  reviewerRelationWeights: snapshot.reviewerRelationWeights,
  formTemplateVersionIds: snapshot.forms.map(form => form.sourceFormTemplateVersionId),
  schedulePreset: { allowStageOverlap: snapshot.allowStageOverlap, stages: [] },
  notificationRules: snapshot.notificationRules
})

/** 保存后用内容指纹重建本地草稿，避免在 effect 中同步派生状态。 */
const advancedConfigKey = (snapshot: PerfCycleConfigSnapshot) =>
  JSON.stringify([snapshot.id, snapshot.ratings, snapshot.constraintProfiles, snapshot.reviewerRelationWeights])

const CycleAdvancedConfigSheet = ({
  open,
  onOpenChange,
  snapshot,
  editable,
  saving,
  onSave
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  snapshot: PerfCycleConfigSnapshot | null
  editable: boolean
  saving: boolean
  onSave: (value: PerfConfigTemplateVersion) => Promise<void>
}) => {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side='right' className='w-full gap-0 p-0 sm:max-w-5xl'>
        <SheetHeader className='border-b px-6 py-4'>
          <SheetTitle>高级配置</SheetTitle>
          <SheetDescription>调整周期自己的评级、约束和关系权重；不会回写来源模板或 D/M 表单。</SheetDescription>
        </SheetHeader>
        <ScrollArea className='min-h-0 flex-1'>
          <div className='flex flex-col gap-5 p-6'>
            {!snapshot ? (
              <div className='text-muted-foreground py-20 text-center text-sm'>请先保存基本信息以生成周期快照</div>
            ) : (
              <AdvancedConfigEditor
                key={advancedConfigKey(snapshot)}
                snapshot={snapshot}
                editable={editable}
                saving={saving}
                onSave={onSave}
              />
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}

const AdvancedConfigEditor = ({
  snapshot,
  editable,
  saving,
  onSave
}: {
  snapshot: PerfCycleConfigSnapshot
  editable: boolean
  saving: boolean
  onSave: (value: PerfConfigTemplateVersion) => Promise<void>
}) => {
  const [draft, setDraft] = useState(() => toEditorValue(snapshot))

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>快照来源</CardTitle>
          <CardDescription>
            {snapshot.source ? `${snapshot.source.name} · v${snapshot.source.version}` : '未记录来源版本'}；当前为周期配置 v
            {snapshot.version}
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-wrap gap-2'>
          {snapshot.forms.map(form => (
            <Badge key={form.id} variant='outline'>
              {form.jobLevelPrefix} · {form.name ?? form.content?.name ?? `表单版本 #${form.sourceFormTemplateVersionId}`}
            </Badge>
          ))}
        </CardContent>
      </Card>
      <ConfigTemplateEditor
        value={draft}
        candidates={[]}
        editable={editable}
        visibleSections={['ratings', 'constraints', 'relations']}
        onChange={setDraft}
      />
      {editable && (
        <div className='flex justify-end border-t pt-4'>
          <Button disabled={saving} onClick={() => void onSave(draft)}>
            保存高级配置
          </Button>
        </div>
      )}
    </>
  )
}

export default CycleAdvancedConfigSheet
