'use client'

import { toast } from 'sonner'

import { OkrReferenceContent } from '@/components/shared/okr'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { ParticipantOkrSnapshot } from '@/lib/perf-api'

const OKR_REFERENCE_SAMPLE = {
  participantId: 7,
  employeeOpenId: 'ou_component_preview',
  lastSyncedAt: '2026-07-16T10:00:00.000Z',
  sync: { status: 'running' },
  cycles: [
    {
      id: 'cycle-preview',
      tenantCycleId: 'tenant-cycle-preview',
      startTime: '1767225600000',
      endTime: '1782777600000',
      status: 1,
      score: null,
      objectives: [
        {
          id: 'objective-preview',
          position: 1,
          content: {
            blocks: [
              {
                block_element_type: 'paragraph',
                paragraph: {
                  elements: [{ paragraph_element_type: 'textRun', text_run: { text: '建立可复用的客户成功体系' } }]
                }
              }
            ]
          },
          notes: null,
          score: null,
          weight: 100,
          deadline: null,
          category: { id: 'category-preview', name: { zh: '业务目标' }, color: 'blue' },
          indicator: null,
          latestProgress: {
            id: 'progress-preview',
            content: null,
            progressPercent: 68,
            status: 1,
            createTime: '1000',
            updateTime: '1001'
          },
          keyResults: [
            {
              id: 'kr-preview',
              position: 1,
              content: {
                blocks: [
                  {
                    block_element_type: 'paragraph',
                    paragraph: {
                      elements: [
                        { paragraph_element_type: 'textRun', text_run: { text: '完成重点客户健康度看板并上线预警规则' } }
                      ]
                    }
                  }
                ]
              },
              score: null,
              weight: 100,
              deadline: null,
              indicator: null,
              latestProgress: null
            }
          ]
        }
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
