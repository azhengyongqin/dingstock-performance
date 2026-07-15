'use client'

import { useState } from 'react'

import {
  CalendarClockIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  ComponentIcon,
  FileStackIcon,
  HistoryIcon,
  Layers3Icon,
  PanelLeftIcon,
  SlidersHorizontalIcon,
  UsersIcon
} from 'lucide-react'
import { toast } from 'sonner'

import Header from '@/components/layout/Header'
import { LarkMemberPickerDialog, type LarkPickerMember } from '@/components/shared/lark'
import {
  DatePicker,
  DateRangePicker,
  DateTimePicker,
  DateTimeRangePicker,
  type DateRangeValue,
  type DateTimeRangeValue
} from '@/components/shared/DatePicker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type {
  PerfConfigTemplateVersion,
  PerfCycleConfigSnapshot,
  PerfCyclePlan,
  PerfCycleProgress,
  PerfCycleSetupParticipant,
  PerfFormTemplateVersion,
  PerfParticipantPrefixCheck
} from '@/lib/perf-api'
import CycleProgressDashboard from '@/views/cycles/detail/cycle-progress-dashboard'
import SnapshotProvenanceCard from '@/views/cycles/detail/snapshot-provenance-card'
import CycleSetupEditor, { type CycleSetupDraft } from '@/views/cycles/edit/cycle-setup-editor'
import FormTemplateEditor from '@/views/settings/form-templates/form-template-editor'
import ConfigTemplateEditor from '@/views/settings/templates/config-template-editor'

type ComponentKey =
  | 'date-time'
  | 'buttons'
  | 'form-controls'
  | 'feedback'
  | 'member-picker'
  | 'form-template'
  | 'config-template'
  | 'cycle-setup'
  | 'cycle-progress'
  | 'snapshot-provenance'

type ComponentMenuItem = {
  key: ComponentKey
  title: string
  description: string
  icon: typeof CalendarClockIcon
}

const COMPONENT_MENU: ComponentMenuItem[] = [
  {
    key: 'date-time',
    title: '日期时间',
    description: 'DatePicker / DateTimePicker',
    icon: CalendarClockIcon
  },
  {
    key: 'buttons',
    title: '按钮与标签',
    description: 'Button / Badge',
    icon: ComponentIcon
  },
  {
    key: 'form-controls',
    title: '表单控件',
    description: 'Input / Select / Field',
    icon: SlidersHorizontalIcon
  },
  {
    key: 'feedback',
    title: '反馈与占位',
    description: 'Progress / Skeleton',
    icon: Layers3Icon
  },
  {
    key: 'member-picker',
    title: '人员选择弹窗',
    description: 'LarkMemberPickerDialog',
    icon: UsersIcon
  },
  {
    key: 'form-template',
    title: '评估表单设计器',
    description: '四类子表单 / 维度 / 评估项',
    icon: FileStackIcon
  },
  {
    key: 'config-template',
    title: '配置模板编辑器',
    description: '评级 / 约束 / 绑定 / 日程通知',
    icon: SlidersHorizontalIcon
  },
  {
    key: 'cycle-setup',
    title: '周期四步创建',
    description: '基本信息 / 参与者 / 计划 / 检查',
    icon: ClipboardCheckIcon
  },
  {
    key: 'cycle-progress',
    title: '周期任务进度',
    description: '任务事实 / 缺失项 / 软截止',
    icon: CheckCircle2Icon
  },
  {
    key: 'snapshot-provenance',
    title: '配置快照溯源卡片',
    description: '来源模板展示 / 手动修改提示',
    icon: HistoryIcon
  }
]

const DateTimePreview = () => {
  const [date, setDate] = useState('2026-07-09')
  const [dateTime, setDateTime] = useState('2026-07-09T09:30')
  const [emptyDateTime, setEmptyDateTime] = useState('')
  const [fineDateTime, setFineDateTime] = useState('2026-07-09T18:17')
  const [dateRange, setDateRange] = useState<DateRangeValue>({ from: '2026-07-09', to: '2026-07-18' })

  const [dateTimeRange, setDateTimeRange] = useState<DateTimeRangeValue>({
    from: '2026-07-09T09:30',
    to: '2026-07-18T18:00'
  })

  return (
    <div className='grid gap-4 xl:grid-cols-2'>
      <Card>
        <CardHeader>
          <CardTitle>日期选择器</CardTitle>
          <CardDescription>保持 YYYY-MM-DD 字符串格式</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor='test-date'>周期日期</FieldLabel>
              <DatePicker id='test-date' value={date} onChange={setDate} />
              <FieldDescription>当前值：{date || '未选择'}</FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>日期时间选择器</CardTitle>
          <CardDescription>同一个弹层内选择日期、小时和分钟</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor='test-datetime'>评审开始时间</FieldLabel>
              <DateTimePicker id='test-datetime' value={dateTime} onChange={setDateTime} />
              <FieldDescription>当前值：{dateTime || '未选择'}</FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>空值状态</CardTitle>
          <CardDescription>首次选择日期默认补齐 00:00</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor='test-empty-datetime'>截止时间</FieldLabel>
              <DateTimePicker
                id='test-empty-datetime'
                value={emptyDateTime}
                onChange={setEmptyDateTime}
                placeholder='请选择截止时间'
              />
              <FieldDescription>当前值：{emptyDateTime || '未选择'}</FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>分钟步长与禁用态</CardTitle>
          <CardDescription>支持自定义分钟步长，也保留非步长分钟值</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor='test-fine-datetime'>15 分钟步长</FieldLabel>
              <DateTimePicker
                id='test-fine-datetime'
                value={fineDateTime}
                onChange={setFineDateTime}
                minuteStep={15}
              />
              <FieldDescription>当前值：{fineDateTime || '未选择'}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor='test-disabled-datetime'>禁用示例</FieldLabel>
              <DateTimePicker id='test-disabled-datetime' value='2026-07-09T12:00' onChange={() => {}} disabled />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>日期区间选择器</CardTitle>
          <CardDescription>基于 Calendar range 模式，输出 YYYY-MM-DD 区间</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor='test-date-range'>绩效窗口日期</FieldLabel>
              <DateRangePicker id='test-date-range' value={dateRange} onChange={setDateRange} />
              <FieldDescription>
                当前值：{dateRange.from || '未选择'} 至 {dateRange.to || '未选择'}
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>日期时间区间选择器</CardTitle>
          <CardDescription>组合两个 DateTimePicker，输出 YYYY-MM-DDTHH:mm 区间</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor='test-datetime-range-from'>评审起止时间</FieldLabel>
              <DateTimeRangePicker id='test-datetime-range' value={dateTimeRange} onChange={setDateTimeRange} />
              <FieldDescription>
                当前值：{dateTimeRange.from || '未选择'} 至 {dateTimeRange.to || '未选择'}
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
    </div>
  )
}

const ButtonsPreview = () => (
  <div className='grid gap-4 xl:grid-cols-2'>
    <Card>
      <CardHeader>
        <CardTitle>按钮状态</CardTitle>
        <CardDescription>用于检查不同主题下的按钮层级和 hover 可读性</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-wrap gap-2'>
        <Button>默认按钮</Button>
        <Button variant='secondary'>次级按钮</Button>
        <Button variant='outline'>描边按钮</Button>
        <Button variant='ghost'>弱按钮</Button>
        <Button variant='destructive'>危险按钮</Button>
        <Button disabled>禁用按钮</Button>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>标签状态</CardTitle>
        <CardDescription>用于检查状态色、边框和文字对比度</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-wrap gap-2'>
        <Badge>默认</Badge>
        <Badge variant='secondary'>次级</Badge>
        <Badge variant='outline'>描边</Badge>
        <Badge variant='destructive'>异常</Badge>
        <Badge variant='ghost'>弱化</Badge>
      </CardContent>
    </Card>
  </div>
)

const FormControlsPreview = () => {
  const [role, setRole] = useState('hr')

  return (
    <div className='grid gap-4 xl:grid-cols-2'>
      <Card>
        <CardHeader>
          <CardTitle>基础表单</CardTitle>
          <CardDescription>用于观察 Field、Input、Select 的布局节奏</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor='test-name'>员工姓名</FieldLabel>
              <Input id='test-name' defaultValue='张小潮' />
              <FieldDescription>示例输入框，后续可以继续补充 Textarea、Checkbox、Switch。</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor='test-role'>角色</FieldLabel>
              <Select value={role} onValueChange={value => value && setRole(value)}>
                <SelectTrigger id='test-role' className='w-full'>
                  <span>{role === 'hr' ? 'HR 管理员' : role === 'manager' ? '直属上级' : '普通员工'}</span>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectItem value='hr'>HR 管理员</SelectItem>
                  <SelectItem value='manager'>直属上级</SelectItem>
                  <SelectItem value='employee'>普通员工</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>表单结果</CardTitle>
          <CardDescription>用于确认控件变更后的受控值</CardDescription>
        </CardHeader>
        <CardContent className='text-muted-foreground flex min-h-38 flex-col justify-center gap-2 text-sm'>
          <CheckCircle2Icon className='text-primary size-5' />
          <span>当前角色：{role === 'hr' ? 'HR 管理员' : role === 'manager' ? '直属上级' : '普通员工'}</span>
        </CardContent>
      </Card>
    </div>
  )
}

const FeedbackPreview = () => (
  <div className='grid gap-4 xl:grid-cols-2'>
    <Card>
      <CardHeader>
        <CardTitle>进度反馈</CardTitle>
        <CardDescription>用于检查主色在进度条上的表现</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <div className='flex items-center justify-between text-sm'>
          <span>绩效周期配置完成度</span>
          <span className='text-muted-foreground'>68%</span>
        </div>
        <Progress value={68} />
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>骨架屏</CardTitle>
        <CardDescription>用于检查加载态在浅色和深色主题下是否自然</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>
        <Skeleton className='h-4 w-2/3' />
        <Skeleton className='h-4 w-full' />
        <Skeleton className='h-4 w-5/6' />
        <Skeleton className='h-24 w-full' />
      </CardContent>
    </Card>
  </div>
)

/** LarkMemberPickerDialog 示例：搜索添加 → 待确认区 取消/确认 → 已选成员列表移除 */
const MemberPickerPreview = () => {
  const [open, setOpen] = useState(false)

  const [members, setMembers] = useState<LarkPickerMember[]>([
    {
      openId: 'ou_d081669b3d00fa5912f3c0928cd5bef8',
      name: '郑亮',
      description: '研发主管',
      badge: '管理员',
      removable: false
    },
    { openId: 'ou_216b190da89a53a1d84a0e25886f8c41', name: '彭巧丽', description: '总监' },
    { openId: 'ou_3e2bbdc22e748a1d16c6a6fa408e7c8a', name: '赵俊(GT)', description: 'CEO' }
  ])

  const handleConfirm = (added: LarkPickerMember[]) => {
    setMembers(prev => [...prev, ...added])
  }

  return (
    <div className='grid gap-4 xl:grid-cols-2'>
      <Card>
        <CardHeader>
          <CardTitle>协作者管理式弹窗</CardTitle>
          <CardDescription>
            顶部飞书搜索（丰富用户信息、最近 10 条、保留搜索词、自适应宽度）→ 本次新增待确认区（取消/确认）→
            已选成员列表（可移除）
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => setOpen(true)}>打开人员选择弹窗</Button>
          <LarkMemberPickerDialog
            open={open}
            onOpenChange={setOpen}
            title='协作者管理'
            searchPlaceholder='添加协作者，可搜索用户'
            members={members}
            membersLabel='所有可编辑此表格（除表头）的用户'
            removeLabel='移除权限'
            onConfirm={handleConfirm}
            onRemoveMember={member => setMembers(prev => prev.filter(item => item.openId !== member.openId))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>当前受控值</CardTitle>
          <CardDescription>弹窗确认/移除后同步到业务方的成员列表</CardDescription>
        </CardHeader>
        <CardContent className='text-muted-foreground flex flex-col gap-1.5 text-sm'>
          {members.map(member => (
            <span key={member.openId}>
              {member.name}
              {member.badge ? `（${member.badge}）` : ''} — {member.description ?? member.openId}
            </span>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

const FORM_TEMPLATE_PREVIEW_VALUE: PerfFormTemplateVersion = {
  id: 9001,
  templateId: 900,
  name: 'D 普通岗评估表单',
  description: '组件实验台示例，不会调用后端或保存数据。',
  version: 1,
  status: 'DRAFT',
  jobLevelPrefix: 'D',
  sourceVersionId: null,
  updatedAt: '2026-07-14T12:00:00.000Z',
  subforms: [
    { type: 'SELF', title: '员工自评', sortOrder: 0, dimensions: [] },
    {
      type: 'PEER',
      title: '360°评估',
      sortOrder: 1,
      dimensions: [
        {
          kind: 'REGULAR',
          audience: 'REVIEWER',
          name: '工作贡献与责任担当',
          description: '仅评价同级协作中能够观察到的行为。',
          weight: 35,
          isCore: true,
          sortOrder: 0,
          items: [{ type: 'RATING', title: '请选择该维度评级', required: true, sortOrder: 0 }]
        }
      ]
    },
    { type: 'MANAGER', title: '上级评估', sortOrder: 2, dimensions: [] },
    { type: 'PROMOTION', title: '晋升评估', sortOrder: 3, dimensions: [] }
  ]
}

/** 业务级组件示例：可编辑草稿与已发布只读态并排验证。 */
const FormTemplateEditorPreview = () => {
  const [draft, setDraft] = useState(FORM_TEMPLATE_PREVIEW_VALUE)

  return (
    <div className='flex flex-col gap-4'>
      <Card>
        <CardHeader>
          <CardTitle>草稿编辑态</CardTitle>
          <CardDescription>验证四个 Tab、维度排序、核心标记与受控评估项编辑。</CardDescription>
        </CardHeader>
        <CardContent>
          <FormTemplateEditor value={draft} editable onChange={setDraft} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>已发布只读态</CardTitle>
          <CardDescription>发布版本不可原地修改，所有基础控件均为只读。</CardDescription>
        </CardHeader>
        <CardContent>
          <FormTemplateEditor value={{ ...draft, status: 'PUBLISHED' }} editable={false} onChange={() => {}} />
        </CardContent>
      </Card>
    </div>
  )
}

const CONFIG_TEMPLATE_PREVIEW_VALUE: PerfConfigTemplateVersion = {
  id: 9101,
  templateId: 910,
  name: '标准半年度配置',
  description: '组件实验台本地草稿，不会发起接口请求。',
  version: 1,
  status: 'DRAFT',
  updatedAt: '2026-07-14T12:00:00.000Z',
  stageModes: { SELF: 'DIRECT_RATING', PEER: 'WEIGHTED_RATING', MANAGER: 'WEIGHTED_SCORE', AI: 'DIRECT_RATING' },
  ratings: [
    { symbol: 'S', name: '卓越', minScore: '90', maxScore: '100', mappingScore: '95', commentRequired: true },
    { symbol: 'A', name: '优秀', minScore: '80', maxScore: '90', mappingScore: '85', commentRequired: false },
    { symbol: 'B', name: '良好', minScore: '60', maxScore: '80', mappingScore: '70', commentRequired: false },
    { symbol: 'C', name: '待改进', minScore: '0', maxScore: '60', mappingScore: '50', commentRequired: true }
  ],
  constraintProfiles: {
    WEIGHTED_RATING: [
      { id: 'rating-core-force', type: 'CORE_RATING_FORCE', enabled: true, triggerRating: 'C', targetLevel: 'C' },
      { id: 'rating-core-cap', type: 'CORE_RATING_CAP', enabled: true, triggerRating: 'B', targetLevel: 'B' },
      { id: 'rating-any-cap', type: 'ANY_RATING_CAP', enabled: true, triggerRating: 'C', targetLevel: 'B' }
    ],
    WEIGHTED_SCORE: [
      { id: 'score-core-force', type: 'CORE_SCORE_FORCE', enabled: true, threshold: '60', targetLevel: 'C' },
      { id: 'score-core-cap', type: 'CORE_SCORE_CAP', enabled: true, threshold: '80', targetLevel: 'B' },
      { id: 'score-any-cap', type: 'ANY_SCORE_CAP', enabled: true, threshold: '60', targetLevel: 'B' }
    ]
  },
  reviewerRelationWeights: { ORG_OWNER: '30', PROJECT_OWNER: '30', PEER: '25', CROSS_DEPT: '15' },
  formTemplateVersionIds: [9001],
  schedulePreset: {
    allowStageOverlap: true,
    stages: [
      { stage: 'SELF', startOffsetMinutes: 0, reminderDeadlineOffsetMinutes: 4320 },
      { stage: 'PEER', startOffsetMinutes: 1440, reminderDeadlineOffsetMinutes: 7200 },
      { stage: 'MANAGER', startOffsetMinutes: 4320, reminderDeadlineOffsetMinutes: 10080 }
    ]
  },
  notificationRules: {
    stages: (['SELF', 'PEER', 'MANAGER'] as const).map(stage => ({
      stage,
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

/** Ticket 03 业务组件示例：本地受控草稿与只读发布态并排，不访问后端。 */
const ConfigTemplateEditorPreview = () => {
  const [draft, setDraft] = useState(CONFIG_TEMPLATE_PREVIEW_VALUE)

  return (
    <div className='flex flex-col gap-4'>
      <Card>
        <CardHeader>
          <CardTitle>配置模板草稿态</CardTitle>
          <CardDescription>验证固定 S/A/B/C、阶段模式、约束、关系权重、表单绑定与日程通知。</CardDescription>
        </CardHeader>
        <CardContent>
          <ConfigTemplateEditor value={draft} candidates={[FORM_TEMPLATE_PREVIEW_VALUE]} editable onChange={setDraft} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>配置模板只读态</CardTitle>
          <CardDescription>模拟发布版本，确认受控配置不会原地修改。</CardDescription>
        </CardHeader>
        <CardContent>
          <ConfigTemplateEditor value={{ ...draft, status: 'PUBLISHED' }} candidates={[FORM_TEMPLATE_PREVIEW_VALUE]} editable={false} onChange={() => {}} />
        </CardContent>
      </Card>
    </div>
  )
}

const CYCLE_SETUP_PARTICIPANTS: PerfCycleSetupParticipant[] = [
  {
    id: 9201,
    cycleId: 920,
    employeeOpenId: 'ou_cycle_preview',
    leaderOpenIdSnapshot: null,
    departmentIdSnapshot: null,
    jobLevelCodeSnapshot: 'D5',
    jobLevelPrefixSnapshot: 'D',
    isPromotionEnabled: false,
    status: 'PENDING_SELF_REVIEW',
    employee: { open_id: 'ou_cycle_preview', name: '周期示例员工' },
    leader: null,
    departmentName: '研发部'
  }
]

const CYCLE_SETUP_PREFIX_CHECKS: PerfParticipantPrefixCheck[] = [
  {
    participantId: 9201,
    employeeOpenId: 'ou_cycle_preview',
    status: 'MATCHED',
    jobLevelCode: 'D5',
    jobLevelPrefix: 'D',
    formSnapshotId: 9301,
    formTemplateVersionId: 9001,
    formTemplateName: 'D 普通岗评估表单',
    message: '已匹配 D 普通岗评估表单'
  }
]

/**
 * Ticket 04 业务组件示例：完全使用本地受控状态，不访问周期接口。
 * sourceConfigLabel 固定非空以展示「已创建周期」的只读来源块，
 * 顶部开关驱动 snapshotManuallyModified，用来验证「重新套用模板」在未修改/已修改两种状态下的行为差异；
 * onReapplyTemplate 只 toast 提示并返回 true，不做真实覆盖，供人工验证覆盖确认弹窗与入口可达性。
 */
const CycleSetupPreview = () => {
  const [status, setStatus] = useState<'DRAFT' | 'SCHEDULED'>('DRAFT')
  const [snapshotManuallyModified, setSnapshotManuallyModified] = useState(false)

  const [draft, setDraft] = useState<CycleSetupDraft>({
    name: '2026 上半年绩效评定',
    configTemplateVersionId: String(CONFIG_TEMPLATE_PREVIEW_VALUE.id),
    plannedStartAt: '2026-08-01T09:00'
  })

  const [plan, setPlan] = useState<PerfCyclePlan>({
    allowStageOverlap: true,
    stages: [
      { stage: 'SELF', startAt: '2026-08-01T01:00:00.000Z', reminderDeadlineAt: '2026-08-04T01:00:00.000Z' },
      { stage: 'PEER', startAt: '2026-08-02T01:00:00.000Z', reminderDeadlineAt: '2026-08-06T01:00:00.000Z' },
      { stage: 'MANAGER', startAt: '2026-08-04T01:00:00.000Z', reminderDeadlineAt: '2026-08-08T01:00:00.000Z' }
    ],
    notificationRules: CONFIG_TEMPLATE_PREVIEW_VALUE.notificationRules
  })

  return (
    <div className='flex flex-col gap-4'>
      <Card>
        <CardHeader>
          <CardTitle>重新套用模板入口开关</CardTitle>
          <CardDescription>模拟「快照是否已被手动修改」，验证套用时静默替换 / 覆盖确认两种路径。</CardDescription>
        </CardHeader>
        <CardContent>
          <label className='flex items-center justify-between gap-3 rounded-md border p-3 text-sm'>
            当前快照已被手动修改（snapshotManuallyModified）
            <Switch checked={snapshotManuallyModified} onCheckedChange={checked => setSnapshotManuallyModified(Boolean(checked))} />
          </label>
        </CardContent>
      </Card>

      <CycleSetupEditor
        status={status}
        draft={draft}
        configTemplates={[{ ...CONFIG_TEMPLATE_PREVIEW_VALUE, isUsable: true }]}
        sourceConfigLabel={`${CONFIG_TEMPLATE_PREVIEW_VALUE.name} · v${CONFIG_TEMPLATE_PREVIEW_VALUE.version}`}
        snapshotManuallyModified={snapshotManuallyModified}
        participants={CYCLE_SETUP_PARTICIPANTS}
        prefixChecks={CYCLE_SETUP_PREFIX_CHECKS}
        plan={plan}
        checkItems={[
          { key: 'snapshot', ok: true, message: '周期配置与 D/M 表单快照完整' },
          { key: 'participants', ok: true, message: '参与者职级前缀均唯一匹配' },
          { key: 'plan', ok: true, message: '三类任务实际计划完整' }
        ]}
        checkOk
        editable
        saving={false}
        onDraftChange={setDraft}
        onSaveBasic={async () => true}
        onAddMember={() => {}}
        onAddDepartment={() => {}}
        onRemoveMember={() => {}}
        onTogglePromotion={() => {}}
        onPlanChange={setPlan}
        onSavePlan={async () => true}
        onRunChecks={() => {}}
        onSaveDraft={() => {}}
        onSchedule={() => setStatus('SCHEDULED')}
        onReturnToDraft={() => setStatus('DRAFT')}
        onOpenAdvanced={() => {}}
        onReapplyTemplate={async configTemplateVersionId => {
          toast.success(`已重新套用模板 #${configTemplateVersionId}（示例台不发起真实请求）`)
          setSnapshotManuallyModified(false)

          return true
        }}
      />
    </div>
  )
}

const CYCLE_PROGRESS_PREVIEW: PerfCycleProgress = {
  generatedAt: '2026-08-05T03:00:00.000Z',
  cycle: { id: 920, name: '2026 上半年绩效评定', status: 'ACTIVE', plannedStartAt: '2026-08-01T01:00:00.000Z' },
  totals: { participants: 1, tasks: 4, notStarted: 1, open: 2, submitted: 1, locked: 0 },
  stages: [],
  tasks: [
    {
      id: 9401,
      participantId: 9201,
      type: 'SELF',
      startAt: '2026-08-01T01:00:00.000Z',
      reminderDeadlineAt: '2026-08-04T01:00:00.000Z',
      openedAt: '2026-08-01T01:00:00.000Z',
      completedAt: '2026-08-03T02:00:00.000Z',
      status: 'COMPLETED'
    },
    {
      id: 9402,
      participantId: 9201,
      type: 'PEER',
      startAt: '2026-08-02T01:00:00.000Z',
      reminderDeadlineAt: '2026-08-04T01:00:00.000Z',
      openedAt: '2026-08-02T01:00:00.000Z',
      completedAt: null,
      status: 'OPEN'
    },
    {
      id: 9403,
      participantId: 9201,
      type: 'MANAGER',
      startAt: '2026-08-06T01:00:00.000Z',
      reminderDeadlineAt: '2026-08-08T01:00:00.000Z',
      openedAt: null,
      completedAt: null,
      status: 'WAITING'
    },
    {
      id: 9404,
      participantId: 9201,
      type: 'AI',
      startAt: null,
      reminderDeadlineAt: null,
      openedAt: '2026-08-03T01:00:00.000Z',
      completedAt: null,
      status: 'OPEN'
    }
  ],
  missingItems: [
    {
      code: 'TASK_INCOMPLETE',
      participantId: 9201,
      employeeOpenId: '周期示例员工',
      stage: 'PEER',
      message: 'PEER 任务尚未完成'
    },
    {
      code: 'TASK_NOT_OPEN',
      participantId: 9201,
      employeeOpenId: '周期示例员工',
      stage: 'MANAGER',
      message: 'MANAGER 任务尚未开放'
    }
  ],
  nextActions: [],
  startFailure: null,
  activationIssues: null,
  schedules: []
}

/** Ticket 05 业务组件示例：用固定任务事实同时展示硬开放门槛与软截止提醒。 */
const CycleProgressPreview = () => <CycleProgressDashboard progress={CYCLE_PROGRESS_PREVIEW} onNavigate={() => {}} />

const SNAPSHOT_PROVENANCE_PREVIEW_VALUE: PerfCycleConfigSnapshot = {
  id: 9501,
  cycleId: 920,
  version: 2,
  sourceConfigTemplateVersionId: CONFIG_TEMPLATE_PREVIEW_VALUE.id,
  source: {
    id: CONFIG_TEMPLATE_PREVIEW_VALUE.id,
    templateId: CONFIG_TEMPLATE_PREVIEW_VALUE.templateId,
    name: CONFIG_TEMPLATE_PREVIEW_VALUE.name,
    version: CONFIG_TEMPLATE_PREVIEW_VALUE.version
  },
  stageModes: CONFIG_TEMPLATE_PREVIEW_VALUE.stageModes,
  ratings: CONFIG_TEMPLATE_PREVIEW_VALUE.ratings,
  constraintProfiles: CONFIG_TEMPLATE_PREVIEW_VALUE.constraintProfiles,
  reviewerRelationWeights: CONFIG_TEMPLATE_PREVIEW_VALUE.reviewerRelationWeights,
  notificationRules: CONFIG_TEMPLATE_PREVIEW_VALUE.notificationRules,
  allowStageOverlap: CONFIG_TEMPLATE_PREVIEW_VALUE.schedulePreset.allowStageOverlap,
  forms: [{ id: 9301, jobLevelPrefix: 'D', sourceFormTemplateVersionId: 9001, name: 'D 普通岗评估表单' }],
  manuallyModified: false
}

/** Finding 2 补充示例：SnapshotProvenanceCard 有来源 + manuallyModified true/false 两种状态，以及无来源退化态。 */
const SnapshotProvenanceCardPreview = () => (
  <div className='grid gap-4 xl:grid-cols-3'>
    <div className='flex flex-col gap-2'>
      <p className='text-muted-foreground text-sm'>未手动修改</p>
      <SnapshotProvenanceCard snapshot={SNAPSHOT_PROVENANCE_PREVIEW_VALUE} />
    </div>
    <div className='flex flex-col gap-2'>
      <p className='text-muted-foreground text-sm'>已手动修改</p>
      <SnapshotProvenanceCard snapshot={{ ...SNAPSHOT_PROVENANCE_PREVIEW_VALUE, manuallyModified: true }} />
    </div>
    <div className='flex flex-col gap-2'>
      <p className='text-muted-foreground text-sm'>无来源退化态</p>
      <SnapshotProvenanceCard snapshot={{ ...SNAPSHOT_PROVENANCE_PREVIEW_VALUE, source: null }} />
    </div>
  </div>
)

const ComponentPreview = ({ activeComponent }: { activeComponent: ComponentKey }) => {
  if (activeComponent === 'buttons') return <ButtonsPreview />
  if (activeComponent === 'form-controls') return <FormControlsPreview />
  if (activeComponent === 'feedback') return <FeedbackPreview />
  if (activeComponent === 'member-picker') return <MemberPickerPreview />
  if (activeComponent === 'form-template') return <FormTemplateEditorPreview />
  if (activeComponent === 'config-template') return <ConfigTemplateEditorPreview />
  if (activeComponent === 'cycle-setup') return <CycleSetupPreview />
  if (activeComponent === 'cycle-progress') return <CycleProgressPreview />
  if (activeComponent === 'snapshot-provenance') return <SnapshotProvenanceCardPreview />

  return <DateTimePreview />
}

const ComponentTestPage = () => {
  const [activeComponent, setActiveComponent] = useState<ComponentKey>('date-time')
  const activeItem = COMPONENT_MENU.find(item => item.key === activeComponent) ?? COMPONENT_MENU[0]

  return (
    <div className='bg-muted/30 min-h-dvh'>
      <Header />
      <main className='px-4 py-6 sm:px-6'>
        <div className='mx-auto flex w-full max-w-7xl flex-col gap-5'>
        <div className='flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between'>
          <div className='flex flex-col gap-2'>
            <Badge variant='outline' className='w-fit'>
              Shared UI Lab
            </Badge>
            <div>
              <h1 className='text-2xl font-semibold tracking-normal'>组件测试实验台</h1>
              <p className='text-muted-foreground mt-1 max-w-2xl text-sm'>
                统一管理后续要测试的 shared / ui 组件，支持菜单切换和主题预览。
              </p>
            </div>
          </div>
        </div>

        <div className='grid min-h-[560px] gap-5 lg:grid-cols-[280px_1fr]'>
          <aside className='bg-card text-card-foreground h-fit rounded-xl border shadow-xs'>
            <div className='flex items-center gap-2 px-4 py-3'>
              <PanelLeftIcon className='text-muted-foreground size-4' />
              <span className='text-sm font-medium'>组件菜单</span>
            </div>
            <Separator />
            <nav className='flex flex-col gap-1 p-2'>
              {COMPONENT_MENU.map(item => {
                const Icon = item.icon
                const active = item.key === activeComponent

                return (
                  <Button
                    key={item.key}
                    type='button'
                    variant='ghost'
                    className={cn(
                      'hover:bg-muted flex w-full items-start gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                      active && 'bg-muted text-foreground'
                    )}
                    onClick={() => setActiveComponent(item.key)}
                  >
                    <Icon className={cn('text-muted-foreground mt-0.5 size-4 shrink-0', active && 'text-primary')} />
                    <span className='min-w-0 flex-1'>
                      <span className='block font-medium'>{item.title}</span>
                      <span className='text-muted-foreground mt-0.5 block truncate text-xs'>{item.description}</span>
                    </span>
                  </Button>
                )
              })}
            </nav>
          </aside>

          <section className='flex min-w-0 flex-col gap-4'>
            <div className='bg-card rounded-xl border px-4 py-3 shadow-xs'>
              <div className='flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between'>
                <div>
                  <h2 className='text-base font-medium'>{activeItem.title}</h2>
                  <p className='text-muted-foreground text-sm'>{activeItem.description}</p>
                </div>
                <Badge variant='secondary'>{activeComponent}</Badge>
              </div>
            </div>

            <ComponentPreview activeComponent={activeComponent} />
          </section>
        </div>
        </div>
      </main>
    </div>
  )
}

export default ComponentTestPage
