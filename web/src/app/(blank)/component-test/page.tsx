'use client'

import { useState } from 'react'

import {
  CalendarClockIcon,
  CheckCircle2Icon,
  ComponentIcon,
  Layers3Icon,
  PanelLeftIcon,
  SlidersHorizontalIcon,
  UsersIcon
} from 'lucide-react'

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
import { cn } from '@/lib/utils'

type ComponentKey = 'date-time' | 'buttons' | 'form-controls' | 'feedback' | 'member-picker'

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

const ComponentPreview = ({ activeComponent }: { activeComponent: ComponentKey }) => {
  if (activeComponent === 'buttons') return <ButtonsPreview />
  if (activeComponent === 'form-controls') return <FormControlsPreview />
  if (activeComponent === 'feedback') return <FeedbackPreview />
  if (activeComponent === 'member-picker') return <MemberPickerPreview />

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
                  <button
                    key={item.key}
                    type='button'
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
                  </button>
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
