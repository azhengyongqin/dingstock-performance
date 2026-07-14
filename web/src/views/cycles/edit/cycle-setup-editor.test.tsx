import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type {
  PerfConfigTemplateVersionSummary,
  PerfCyclePlan,
  PerfCycleSetupParticipant,
  PerfParticipantPrefixCheck,
  StartCheckItem
} from '@/lib/perf-api'

import CycleSetupEditor from './cycle-setup-editor'

vi.mock('@/components/shared/lark', () => ({
  LarkMemberSelector: () => <div>飞书选人</div>,
  UserAvatar: ({ name }: { name?: string }) => <div>{name}</div>
}))

const configTemplates: PerfConfigTemplateVersionSummary[] = [
  {
    id: 11,
    templateId: 1,
    name: '标准配置',
    version: 2,
    status: 'PUBLISHED',
    updatedAt: '2026-07-14T10:00:00.000Z',
    isUsable: true
  },
  {
    id: 12,
    templateId: 2,
    name: '未发布配置',
    version: 1,
    status: 'DRAFT',
    updatedAt: '2026-07-14T10:00:00.000Z',
    isUsable: false,
    unavailableReasons: [{ code: 'CONFIG_VERSION_DRAFT', message: '配置模板版本尚未发布' }]
  }
]

const participants: PerfCycleSetupParticipant[] = [
  {
    id: 101,
    cycleId: 8,
    employeeOpenId: 'ou_d',
    leaderOpenIdSnapshot: null,
    departmentIdSnapshot: null,
    isPromotionEnabled: false,
    status: 'PENDING_SELF_REVIEW',
    employee: { open_id: 'ou_d', name: '普通岗员工' },
    leader: null,
    departmentName: '研发部',
    jobLevelCodeSnapshot: 'D5',
    jobLevelPrefixSnapshot: 'D'
  },
  {
    id: 102,
    cycleId: 8,
    employeeOpenId: 'ou_bad',
    leaderOpenIdSnapshot: null,
    departmentIdSnapshot: null,
    isPromotionEnabled: true,
    status: 'PENDING_SELF_REVIEW',
    employee: { open_id: 'ou_bad', name: '缺失职级员工' },
    leader: null,
    departmentName: '产品部',
    jobLevelCodeSnapshot: null,
    jobLevelPrefixSnapshot: null
  }
]

const prefixChecks: PerfParticipantPrefixCheck[] = [
  {
    participantId: 101,
    employeeOpenId: 'ou_d',
    status: 'MATCHED',
    jobLevelCode: 'D5',
    jobLevelPrefix: 'D',
    formTemplateVersionId: 201,
    formTemplateName: 'D 普通岗表单',
    message: '已匹配 D 普通岗表单'
  },
  {
    participantId: 102,
    employeeOpenId: 'ou_bad',
    status: 'MISSING_JOB_LEVEL',
    jobLevelCode: null,
    jobLevelPrefix: null,
    message: '缺少职级，请先同步组织架构职级'
  }
]

const plan: PerfCyclePlan = {
  allowStageOverlap: true,
  stages: [
    { stage: 'SELF', startAt: '2026-08-01T01:00:00.000Z', reminderDeadlineAt: '2026-08-04T01:00:00.000Z' },
    { stage: 'PEER', startAt: '2026-08-02T01:00:00.000Z', reminderDeadlineAt: '2026-08-06T01:00:00.000Z' },
    { stage: 'MANAGER', startAt: '2026-08-04T01:00:00.000Z', reminderDeadlineAt: '2026-08-08T01:00:00.000Z' }
  ],
  notificationRules: {
    stages: ['SELF', 'PEER', 'MANAGER'].map(stage => ({
      stage: stage as 'SELF' | 'PEER' | 'MANAGER',
      taskOpened: { enabled: true, recipient: 'ASSIGNEE' as const, ccLeader: true, ccHr: false },
      reminder: {
        enabled: true,
        recipient: 'ASSIGNEE' as const,
        ccLeader: true,
        ccHr: false,
        frequency: { type: 'ONCE_AT_DEADLINE' as const }
      }
    }))
  }
}

const checkItems: StartCheckItem[] = [
  { key: 'participants.prefix', ok: false, message: '1 名参与者缺少职级', target: 'participants', actionLabel: '处理参与者' },
  { key: 'plan.complete', ok: true, message: '三类任务日程完整', target: 'plan' }
]

const createProps = () => ({
  status: 'DRAFT' as const,
  draft: { name: '2026 上半年绩效评定', configTemplateVersionId: '11', plannedStartAt: '2026-08-01T09:00' },
  configTemplates,
  sourceConfigLabel: '',
  participants,
  prefixChecks,
  plan,
  checkItems,
  checkOk: false,
  editable: true,
  saving: false,
  onDraftChange: vi.fn(),
  onSaveBasic: vi.fn(async () => true),
  onAddMember: vi.fn(),
  onAddDepartment: vi.fn(),
  onRemoveMember: vi.fn(),
  onTogglePromotion: vi.fn(),
  onPlanChange: vi.fn(),
  onSavePlan: vi.fn(async () => true),
  onRunChecks: vi.fn(),
  onSaveDraft: vi.fn(),
  onSchedule: vi.fn(),
  onReturnToDraft: vi.fn(),
  onOpenAdvanced: vi.fn()
})

describe('CycleSetupEditor', () => {
  it('固定展示四步，基本信息不再要求周期类型或考核期间日期', async () => {
    const user = userEvent.setup()

    render(<CycleSetupEditor {...createProps()} />)

    expect(screen.getAllByRole('button', { name: /基本信息|参与者|计划预览|启动检查/ })).toHaveLength(4)
    expect(screen.queryByText('周期类型')).not.toBeInTheDocument()
    expect(screen.queryByText('周期起止日期')).not.toBeInTheDocument()
    expect(screen.getByLabelText('周期名称')).toBeInTheDocument()
    expect(screen.getByLabelText('计划启动时间')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '高级配置' })).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: '配置模板版本' }))
    expect(screen.getByText('配置模板版本尚未发布')).toBeInTheDocument()
  })

  it('参与者步骤使用 D/M 匹配结果，异常不能手工覆盖', async () => {
    const user = userEvent.setup()

    render(<CycleSetupEditor {...createProps()} />)
    await user.click(screen.getByRole('button', { name: /参与者/ }))

    expect(screen.getByText('D 匹配 1 人')).toBeInTheDocument()
    expect(screen.getByText('M 匹配 0 人')).toBeInTheDocument()
    expect(screen.getByText('异常 1 人')).toBeInTheDocument()
    expect(screen.getByText('缺少职级，请先同步组织架构职级')).toBeInTheDocument()
    expect(screen.queryByText(/手动覆盖|兜底表单/)).not.toBeInTheDocument()
  })

  it('计划预览只展示三类任务，并明确提醒时间是软截止', async () => {
    const user = userEvent.setup()

    render(<CycleSetupEditor {...createProps()} />)
    await user.click(screen.getByRole('button', { name: /计划预览/ }))

    expect(screen.getByText('员工自评')).toBeInTheDocument()
    expect(screen.getByText('360°评估')).toBeInTheDocument()
    expect(screen.getByText('上级评估')).toBeInTheDocument()
    expect(screen.getByText(/填写提醒时间是软截止/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '编辑通知' })).toHaveLength(3)
  })

  it('启动问题可跳回对应步骤，未通过时不能设为待启动', async () => {
    const user = userEvent.setup()
    const props = createProps()

    props.checkItems = [
      {
        ...checkItems[0],
        issues: [
          { code: 'MISSING_JOB_LEVEL', path: 'participants.101', message: '普通岗员工缺少职级' },
          { code: 'NO_FORM', path: 'participants.102', message: '管理岗员工没有匹配表单' }
        ]
      }
    ]

    render(<CycleSetupEditor {...props} />)
    await user.click(screen.getByRole('button', { name: /启动检查/ }))

    expect(screen.getByText('1 名参与者缺少职级')).toBeInTheDocument()
    expect(screen.getByText('普通岗员工缺少职级')).toBeInTheDocument()
    expect(screen.getByText('管理岗员工没有匹配表单')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '设为待启动' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '处理参与者' }))
    expect(screen.getByText('D 匹配 1 人')).toBeInTheDocument()
  })

  it('DRAFT 可保存草稿，SCHEDULED 可退回草稿', async () => {
    const user = userEvent.setup()
    const props = createProps()
    const view = render(<CycleSetupEditor {...props} />)

    await user.click(screen.getByRole('button', { name: /启动检查/ }))
    await user.click(screen.getByRole('button', { name: '保存草稿并退出' }))
    expect(props.onSaveDraft).toHaveBeenCalledOnce()

    view.rerender(<CycleSetupEditor {...props} status='SCHEDULED' />)
    expect(screen.getByRole('button', { name: '退回草稿' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '退回草稿' }))
    expect(props.onReturnToDraft).toHaveBeenCalledOnce()
  })
})
