import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { PerfConfigTemplateVersion, PerfFormTemplateVersionSummary } from '@/lib/perf-api'

import ConfigTemplateEditor from './config-template-editor'

const version: PerfConfigTemplateVersion = {
  id: 10,
  templateId: 1,
  name: '标准配置',
  version: 1,
  status: 'DRAFT',
  updatedAt: '2026-07-14T10:00:00.000Z',
  ratings: [
    { symbol: 'S', name: '卓越', minScore: '90', maxScore: '100', mappingScore: '95' },
    { symbol: 'A', name: '优秀', minScore: '80', maxScore: '90', mappingScore: '85' },
    { symbol: 'B', name: '良好', minScore: '60', maxScore: '80', mappingScore: '70' },
    { symbol: 'C', name: '待改进', minScore: '0', maxScore: '60', mappingScore: '50' }
  ],
  reviewerRelationWeights: { ORG_OWNER: '30', PROJECT_OWNER: '30', PEER: '25', CROSS_DEPT: '15' },
  formTemplateVersionIds: [],
  schedulePreset: {
    allowStageOverlap: true,
    stages: [
      { stage: 'SELF', startOffsetMinutes: 0, reminderDeadlineOffsetMinutes: 4320 },
      { stage: 'PEER', startOffsetMinutes: 1440, reminderDeadlineOffsetMinutes: 7200 },
      { stage: 'MANAGER', startOffsetMinutes: 4320, reminderDeadlineOffsetMinutes: 10080 }
    ]
  },
  notificationRules: {
    stages: ['SELF', 'PEER', 'MANAGER'].map(stage => ({
      stage: stage as 'SELF' | 'PEER' | 'MANAGER',
      taskOpened: { enabled: true, recipient: 'ASSIGNEE' as const, ccLeader: true, ccHr: false },
      reminder: {
        enabled: true,
        recipient: 'ASSIGNEE' as const,
        ccLeader: true,
        ccHr: false,
        frequency: { type: 'DAILY_AFTER_DEADLINE' as const }
      }
    }))
  }
}

const candidates = [
  { id: 101, templateId: 11, name: 'D 表单', version: 2, status: 'PUBLISHED', jobLevelPrefix: 'D', updatedAt: '' },
  { id: 102, templateId: 12, name: 'M 表单', version: 3, status: 'PUBLISHED', jobLevelPrefix: 'M', updatedAt: '' },
  { id: 103, templateId: 13, name: 'D 草稿', version: 1, status: 'DRAFT', jobLevelPrefix: 'D', updatedAt: '' }
] as PerfFormTemplateVersionSummary[]

// Base UI Select 触发器在同一 jsdom 文档内以鼠标点击方式打开时，指针捕获状态可能被同一 worker 内
// 早先打开过的 Select 残留污染导致再次点击无法展开；用键盘 Enter 展开是等价且更稳定的用户交互方式
// （同款 helper 见 cycle-setup-editor.test.tsx）。
const openFormBindingSelect = async (user: ReturnType<typeof userEvent.setup>) => {
  screen.getByRole('combobox', { name: 'D 职级表单版本' }).focus()
  await user.keyboard('{Enter}')
}

describe('ConfigTemplateEditor', () => {
  it('允许周期高级配置只暴露评级区间与关系权重，不把表单绑定和日程变成默认入口', () => {
    render(
      <ConfigTemplateEditor
        value={version}
        candidates={candidates}
        editable
        visibleSections={['ratings', 'relations']}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByRole('tab', { name: '评级区间' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '关系权重' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '表单绑定' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '日程通知' })).not.toBeInTheDocument()
  })

  it('不再展示管理员可配置的阶段模式与约束档位', () => {
    render(<ConfigTemplateEditor value={version} candidates={candidates} editable onChange={vi.fn()} />)

    expect(screen.queryByText('阶段结果模式')).not.toBeInTheDocument()
    expect(screen.queryByText('等级约束')).not.toBeInTheDocument()
    expect(screen.getByText('S/A/B/C 评级')).toBeInTheDocument()
  })

  it('D/M 绑定槽仅展示匹配前缀的已发布表单', async () => {
    const user = userEvent.setup()

    render(<ConfigTemplateEditor value={version} candidates={candidates} editable onChange={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: '表单绑定' }))
    await openFormBindingSelect(user)

    expect(screen.getByText('D 表单 · v2')).toBeInTheDocument()
    expect(screen.queryByText('M 表单 · v3')).not.toBeInTheDocument()
    expect(screen.queryByText('D 草稿 · v1')).not.toBeInTheDocument()
    await user.click(screen.getByText('D 表单 · v2'))
  })

  it('旧 D 绑定已归档时，改选新版本不会把旧 ID 留在提交值中', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    const value: PerfConfigTemplateVersion = {
      ...version,
      formTemplateVersionIds: [90, 102],
      formBindings: [
        { formTemplateVersionId: 90, jobLevelPrefix: 'D', status: 'ARCHIVED' },
        { formTemplateVersionId: 102, jobLevelPrefix: 'M', status: 'PUBLISHED' }
      ]
    }

    const view = render(<ConfigTemplateEditor value={value} candidates={candidates} editable onChange={onChange} />)

    await user.click(screen.getByRole('tab', { name: '表单绑定' }))
    await openFormBindingSelect(user)
    await user.click(screen.getByRole('option', { name: 'D 表单 · v2' }))

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ formTemplateVersionIds: [102, 101] }))

    const nextValue = onChange.mock.lastCall?.[0] as PerfConfigTemplateVersion

    view.rerender(<ConfigTemplateEditor value={nextValue} candidates={candidates} editable onChange={onChange} />)
    expect(screen.getByRole('combobox', { name: 'D 职级表单版本' })).toHaveTextContent('D 表单 · v2')
  })
})
