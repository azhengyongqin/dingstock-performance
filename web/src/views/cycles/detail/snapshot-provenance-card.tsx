'use client'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CYCLE_SNAPSHOT_MANUALLY_MODIFIED_HINT, type PerfCycleConfigSnapshot } from '@/lib/perf-api'

type Props = {
  snapshot: PerfCycleConfigSnapshot | null
}

/**
 * 配置快照来源溯源展示：只表达“创建时/最近套用时已复制”这一一次性事实，
 * 不暗示与来源模板持续同步；`manuallyModified` 为 true 时额外提示当前配置可能已被手动调整。
 */
const SnapshotProvenanceCard = ({ snapshot }: Props) => {
  const source = snapshot?.source

  return (
    <Card>
      <CardHeader>
        <CardTitle>独立配置快照</CardTitle>
        <CardDescription>
          {source ? (
            <span className='flex flex-col gap-1'>
              <span>
                来源：{source.name} · v{source.version}
              </span>
              <span>创建时/最近套用时已复制为本周期独立配置快照，后续模板更新不会影响本周期。</span>
              {snapshot?.manuallyModified && (
                <span className='text-amber-600'>当前{CYCLE_SNAPSHOT_MANUALLY_MODIFIED_HINT}。</span>
              )}
            </span>
          ) : (
            '未记录来源配置模板版本。'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className='flex flex-wrap gap-2'>
        {snapshot?.forms.map(form => (
          <Badge key={form.id} variant='outline'>
            {form.jobLevelPrefix} · {form.name ?? form.content?.name ?? `表单版本 #${form.sourceFormTemplateVersionId}`}
          </Badge>
        ))}
      </CardContent>
    </Card>
  )
}

export default SnapshotProvenanceCard
