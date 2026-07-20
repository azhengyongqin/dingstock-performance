'use client'

import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type {
  ActivePerfCycleDimensionOverride,
  PerfConfigTemplateVersion,
  PerfCycleConfigSnapshot
} from '@/lib/perf-api'
import ConfigTemplateEditor from '@/views/settings/templates/config-template-editor'

const toEditorValue = (snapshot: PerfCycleConfigSnapshot): PerfConfigTemplateVersion => ({
  id: snapshot.id,
  templateId: snapshot.source?.templateId ?? 0,
  name: snapshot.source?.name ?? `周期配置快照 v${snapshot.version}`,
  version: snapshot.version,
  status: 'PUBLISHED',
  updatedAt: '',
  ratings: snapshot.ratings,
  reviewerRelationWeights: snapshot.reviewerRelationWeights,
  formTemplateVersionIds: snapshot.forms.map(form => form.sourceFormTemplateVersionId),
  schedulePreset: { allowStageOverlap: snapshot.allowStageOverlap, stages: [] },
  notificationRules: snapshot.notificationRules
})

/** 保存后用内容指纹重建本地草稿，避免在 effect 中同步派生状态。 */
const advancedConfigKey = (snapshot: PerfCycleConfigSnapshot) =>
  JSON.stringify([snapshot.id, snapshot.ratings, snapshot.reviewerRelationWeights])

const CycleAdvancedConfigSheet = ({
  open,
  onOpenChange,
  snapshot,
  editable,
  active = false,
  saving,
  onSave
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  snapshot: PerfCycleConfigSnapshot | null
  editable: boolean
  active?: boolean
  saving: boolean
  onSave: (value: PerfConfigTemplateVersion, dimensions: ActivePerfCycleDimensionOverride[]) => Promise<void>
}) => {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side='right' className='w-full gap-0 p-0 sm:max-w-5xl'>
        <SheetHeader className='border-b px-6 py-4'>
          <SheetTitle>高级配置</SheetTitle>
          <SheetDescription>调整周期自己的评级区间和关系权重；不会回写来源模板或 D/M 表单。</SheetDescription>
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
                active={active}
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
  active,
  saving,
  onSave
}: {
  snapshot: PerfCycleConfigSnapshot
  editable: boolean
  active: boolean
  saving: boolean
  onSave: (value: PerfConfigTemplateVersion, dimensions: ActivePerfCycleDimensionOverride[]) => Promise<void>
}) => {
  const [draft, setDraft] = useState(() => toEditorValue(snapshot))

  const [dimensions, setDimensions] = useState<ActivePerfCycleDimensionOverride[]>(() =>
    snapshot.forms.flatMap(form => {
      const content = form.content as
        | { subforms?: Array<{ dimensions?: Array<{ key: string; weight?: string; isCore?: boolean }> }> }
        | undefined

      return (content?.subforms ?? []).flatMap(subform =>
        (subform.dimensions ?? []).flatMap(dimension =>
          dimension.weight == null
            ? []
            : [
                {
                  jobLevelPrefix: form.jobLevelPrefix,
                  dimensionKey: dimension.key,
                  weight: String(dimension.weight),
                  isCore: Boolean(dimension.isCore)
                }
              ]
        )
      )
    })
  )

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>快照来源</CardTitle>
          <CardDescription>
            {snapshot.source ? `${snapshot.source.name} · v${snapshot.source.version}` : '未记录来源版本'}
            ；当前为周期配置 v{snapshot.version}
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-wrap gap-2'>
          {snapshot.forms.map(form => (
            <Badge key={form.id} variant='outline'>
              {form.jobLevelPrefix} ·{' '}
              {form.name ?? form.content?.name ?? `表单版本 #${form.sourceFormTemplateVersionId}`}
            </Badge>
          ))}
        </CardContent>
      </Card>
      <ConfigTemplateEditor
        value={draft}
        candidates={[]}
        editable={editable}
        visibleSections={['ratings', 'relations']}
        onChange={setDraft}
      />
      {active && dimensions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>维度计算配置</CardTitle>
            <CardDescription>只调整稳定维度的权重和核心标记；不会增删维度或评估项。</CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            {dimensions.map((dimension, index) => (
              <div
                key={`${dimension.jobLevelPrefix}:${dimension.dimensionKey}`}
                className='grid gap-3 sm:grid-cols-[1fr_160px_120px] sm:items-center'
              >
                <span className='text-sm'>
                  {dimension.jobLevelPrefix} · {dimension.dimensionKey}
                </span>
                <Input
                  aria-label={`${dimension.dimensionKey} 权重`}
                  type='number'
                  min='0'
                  max='100'
                  step='0.01'
                  value={dimension.weight}
                  onChange={event =>
                    setDimensions(current =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, weight: event.target.value } : item
                      )
                    )
                  }
                />
                <label className='flex items-center gap-2 text-sm'>
                  <Checkbox
                    checked={dimension.isCore}
                    onCheckedChange={checked =>
                      setDimensions(current =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, isCore: checked === true } : item
                        )
                      )
                    }
                  />
                  核心维度
                </label>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {editable && (
        <div className='flex justify-end border-t pt-4'>
          <Button disabled={saving} onClick={() => void onSave(draft, dimensions)}>
            {active ? '预览影响并继续' : '保存高级配置'}
          </Button>
        </div>
      )}
    </>
  )
}

export default CycleAdvancedConfigSheet
