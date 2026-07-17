'use client'

import { toast } from 'sonner'

import { OkrReferenceContent } from '@/components/shared/okr'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { ParticipantOkrSnapshot } from '@/lib/perf-api'

const makeObjective = (
  id: string,
  title: string,
  weight: number,
  progressPercent: number,
  keyResults: Array<{ id: string; text: string; weight: number }>
) => ({
  id,
  position: 1,
  content: {
    blocks: [
      {
        block_element_type: 'paragraph' as const,
        paragraph: {
          elements: [{ paragraph_element_type: 'textRun' as const, text_run: { text: title } }]
        }
      }
    ]
  },
  notes: null,
  score: null,
  weight,
  deadline: null,
  category: { id: `category-${id}`, name: { zh: '业务目标' }, color: 'blue' },
  indicator: null,
  latestProgress: {
    id: `progress-${id}`,
    content: null,
    progressPercent,
    status: 1,
    createTime: '1000',
    updateTime: '1001'
  },
  keyResults: keyResults.map((item, index) => ({
    id: item.id,
    position: index + 1,
    content: {
      blocks: [
        {
          block_element_type: 'paragraph' as const,
          paragraph: {
            elements: [{ paragraph_element_type: 'textRun' as const, text_run: { text: item.text } }]
          }
        }
      ]
    },
    score: null,
    weight: item.weight,
    deadline: null,
    indicator: null,
    latestProgress: null
  }))
})

/** 两周期样本，便于验证周期手风琴原型 */
const OKR_REFERENCE_SAMPLE = {
  participantId: 7,
  employeeOpenId: 'ou_component_preview',
  lastSyncedAt: '2026-07-16T10:00:00.000Z',
  sync: { status: 'running' },
  cycles: [
    {
      id: 'cycle-preview-current',
      tenantCycleId: 'tenant-cycle-preview-current',
      startTime: '1767225600000',
      endTime: '1782777600000',
      status: 1,
      score: null,
      objectives: [
        makeObjective('objective-preview-1', '创新方向调研：', 100, 40, [
          { id: 'kr-1', text: '截止 12月中旬与合作伙伴进行产品培训 @李健 @张锐', weight: 60 },
          { id: 'kr-2', text: '完成竞品分析报告并沉淀内部知识库', weight: 20 },
          { id: 'kr-3', text: '输出下一季度创新方向提案', weight: 20 }
        ]),
        makeObjective('objective-preview-2', '重点业务支撑：', 100, 72, [
          { id: 'kr-4', text: '完成绩效系统核心页面设计交付', weight: 50 },
          { id: 'kr-5', text: '建立设计走查节奏并闭环问题', weight: 50 }
        ])
      ]
    },
    {
      id: 'cycle-preview-prev',
      tenantCycleId: 'tenant-cycle-preview-prev',
      startTime: '1735689600000',
      endTime: '1751328000000',
      status: 2,
      score: null,
      objectives: [
        makeObjective('objective-preview-prev', '建立可复用的客户成功体系', 100, 68, [
          { id: 'kr-prev', text: '完成重点客户健康度看板并上线预警规则', weight: 100 }
        ])
      ]
    }
  ]
} satisfies ParticipantOkrSnapshot

const handlePreviewSync = () => toast.success('组件示例：已触发 OKR 同步')

const OkrReferencePreview = () => (
  <div className='grid items-start gap-4 xl:grid-cols-2'>
    <Card>
      <CardHeader>
        <CardTitle>首次同步骨架</CardTitle>
        <CardDescription>数据库无 OKR 时，同步结束前不闪烁空状态。</CardDescription>
      </CardHeader>
      <CardContent>
        <OkrReferenceContent loading />
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>缓存直出 + 后台刷新</CardTitle>
        <CardDescription>立即展示数据库快照，同时提示正在更新。</CardDescription>
      </CardHeader>
      <CardContent>
        <OkrReferenceContent data={OKR_REFERENCE_SAMPLE} onSync={handlePreviewSync} />
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>同步完成空状态</CardTitle>
        <CardDescription>没有可展示目标时统一显示无数据。</CardDescription>
      </CardHeader>
      <CardContent>
        <OkrReferenceContent
          data={{ ...OKR_REFERENCE_SAMPLE, sync: { status: 'success' }, cycles: [], lastSyncedAt: null }}
          onSync={handlePreviewSync}
        />
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>同步失败无数据</CardTitle>
        <CardDescription>接口错误仅供内部诊断，前端仍统一显示无数据。</CardDescription>
      </CardHeader>
      <CardContent>
        <OkrReferenceContent
          data={{
            ...OKR_REFERENCE_SAMPLE,
            sync: { status: 'failed', error: '飞书 OKR 权限不足，请联系管理员检查应用权限' },
            cycles: [],
            lastSyncedAt: null
          }}
          onSync={handlePreviewSync}
        />
      </CardContent>
    </Card>
  </div>
)

export default OkrReferencePreview
