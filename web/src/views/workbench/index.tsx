'use client'

// React Imports
import { useCallback, useEffect, useState } from 'react'

// Next Imports
import Link from 'next/link'

// Third-party Imports
import {
  ArrowRightIcon,
  BarChart3Icon,
  CalendarRangeIcon,
  CheckIcon,
  FilePenIcon,
  ListTodoIcon,
  SlidersHorizontalIcon,
  UsersIcon
} from 'lucide-react'

// Component Imports
import PageHeader from '@/components/shared/PageHeader'
import { EmptyState, RequestErrorState } from '@/components/shared/RequestErrorState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

// Context Imports
import { useAuth, type NavRole } from '@/contexts/authContext'

// Util Imports
import { apiFetch } from '@/lib/api'

// ===== 页面内静态配置 =====

// 当前周期的六个阶段（评审启动 → 面谈闭环）
const CYCLE_STAGES = [
  { label: '评审启动', done: true },
  { label: '员工自评', done: true },
  { label: '评审打分', done: false, current: true },
  { label: 'AI 分析', done: false },
  { label: '确认申诉', done: false },
  { label: '面谈闭环', done: false }
]

// 快捷入口：roles 与 navConfig / ROUTE_ROLES 对齐；未声明 = 所有登录用户可见
const QUICK_LINKS: {
  icon: typeof FilePenIcon
  label: string
  href: string
  roles?: NavRole[]
}[] = [
  { icon: FilePenIcon, label: '员工自评', href: '/self-review' },
  { icon: ListTodoIcon, label: '评审任务', href: '/review-tasks' },
  { icon: UsersIcon, label: '团队看板', href: '/team-review', roles: ['LEADER', 'HR', 'ADMIN'] },
  { icon: SlidersHorizontalIcon, label: '绩效校准', href: '/calibrations', roles: ['HR', 'ADMIN'] },
  { icon: CalendarRangeIcon, label: '周期管理', href: '/cycles', roles: ['HR', 'ADMIN'] },
  { icon: BarChart3Icon, label: '绩效看板', href: '/dashboard', roles: ['HR', 'ADMIN'] }
]

// ===== 后端数据类型（GET /workbench/todos） =====

/** 当前登录人各类待办数量 */
type WorkbenchTodos = {
  pendingSelfReview: number
  pendingReviews: number
  pendingManagerReviews: number
  pendingConfirm: number
  pendingAppeals: number
}

/** 待办卡片配置：由待办数量拼装文案与跳转链接 */
type TodoCard = {
  role: string
  title: string
  count: number
  href: string
  urgent: boolean
}

// 把后端数量汇总转成待办卡片列表（数量为 0 的项直接隐藏；申诉仅数量 > 0 时展示）
const buildTodoCards = (todos: WorkbenchTodos): TodoCard[] => {
  const cards: TodoCard[] = [
    {
      role: '员工',
      title: '待完成的员工自评',
      count: todos.pendingSelfReview,
      href: '/self-review',
      urgent: true
    },
    {
      role: '评审员',
      title: '360° 评审任务待打分',
      count: todos.pendingReviews,
      href: '/review-tasks',
      urgent: true
    },
    {
      role: 'Leader',
      title: '上级评估任务待完成',
      count: todos.pendingManagerReviews,
      href: '/review-tasks',
      urgent: false
    },
    {
      role: '员工',
      title: '绩效结果待确认',
      count: todos.pendingConfirm,
      href: '/results',
      urgent: false
    },
    {
      role: 'HR',
      title: '申诉待处理',
      count: todos.pendingAppeals,
      href: '/appeals',
      urgent: false
    }
  ]

  return cards.filter(card => card.count > 0)
}

/**
 * 工作台：按角色的待办任务（真实后端 /workbench/todos）+ 当前周期进度（六阶段步骤条）+ 快捷入口。
 */
const Workbench = () => {
  const { hasAccess } = useAuth()

  // 待办数量数据
  const [todos, setTodos] = useState<WorkbenchTodos | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  // 按当前用户角色过滤快捷入口（与侧边栏可见性一致）
  const quickLinks = QUICK_LINKS.filter(link => hasAccess(link.roles))

  // 拉取待办汇总
  const fetchTodos = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const data = await apiFetch<WorkbenchTodos>('/workbench/todos')

      setTodos(data)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [])

  // 首次加载（放入宏任务，避免在 effect 中同步 setState）
  useEffect(() => {
    const initialLoad = setTimeout(() => void fetchTodos(), 0)

    return () => clearTimeout(initialLoad)
  }, [fetchTodos])

  const todoCards = todos ? buildTodoCards(todos) : []

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader title='工作台' description='当前绩效周期的待办任务、整体进度与快捷入口' />

      {/* 当前周期进度：六阶段步骤条 */}
      <Card>
        <CardHeader>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <div>
              <CardTitle>当前周期：2026 上半年绩效考核</CardTitle>
              <CardDescription className='mt-1'>时间窗口 2026-06-15 ~ 2026-08-15 · 参评 126 人</CardDescription>
            </div>
            <Badge className='bg-blue-500/10 text-blue-600 dark:text-blue-400'>进行中</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {/* 步骤条：完成态 / 当前态 / 未开始态 */}
          <ol className='flex flex-wrap items-center gap-y-4'>
            {CYCLE_STAGES.map((stage, index) => (
              <li key={stage.label} className='flex items-center'>
                <div className='flex items-center gap-2'>
                  <span
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium',
                      stage.done && 'bg-primary text-primary-foreground border-primary',
                      stage.current && 'border-primary text-primary',
                      !stage.done && !stage.current && 'text-muted-foreground'
                    )}
                  >
                    {stage.done ? <CheckIcon className='size-4' /> : index + 1}
                  </span>
                  <span
                    className={cn(
                      'text-sm whitespace-nowrap',
                      stage.current ? 'text-primary font-medium' : stage.done ? '' : 'text-muted-foreground'
                    )}
                  >
                    {stage.label}
                  </span>
                </div>
                {index < CYCLE_STAGES.length - 1 && (
                  <span className={cn('bg-border mx-3 h-px w-6 sm:w-10', stage.done && 'bg-primary')} />
                )}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className='grid gap-6 lg:grid-cols-3'>
        {/* 待办任务卡片列表 */}
        <Card className='lg:col-span-2'>
          <CardHeader>
            <CardTitle>我的待办</CardTitle>
            <CardDescription>按角色汇总的当前周期待办事项</CardDescription>
          </CardHeader>
          <CardContent className='flex flex-col gap-3'>
            {loading ? (

              // 加载态
              <>
                <Skeleton className='h-20 w-full' />
                <Skeleton className='h-20 w-full' />
              </>
            ) : error ? (
              <RequestErrorState error={error} size='card' onRetry={() => void fetchTodos()} />
            ) : todoCards.length === 0 ? (
              <EmptyState title='无待办' description='当前周期没有需要你处理的事项' size='card' />
            ) : (
              todoCards.map(task => (
                <div key={task.title} className='flex items-center justify-between gap-4 rounded-lg border p-4'>
                  <div className='flex flex-col gap-1'>
                    <div className='flex items-center gap-2'>
                      <Badge variant='outline'>{task.role}</Badge>
                      {task.urgent && <Badge className='bg-red-500/10 text-red-600 dark:text-red-400'>紧急</Badge>}
                    </div>
                    <span className='font-medium'>{task.title}</span>
                    <span className='text-muted-foreground text-sm'>共 {task.count} 项待处理</span>
                  </div>
                  <Button variant='ghost' size='sm' render={<Link href={task.href} />} nativeButton={false}>
                    去处理
                    <ArrowRightIcon />
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* 快捷入口：无任何可见项时整卡隐藏 */}
        {quickLinks.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>快捷入口</CardTitle>
              <CardDescription>常用功能一键直达</CardDescription>
            </CardHeader>
            <CardContent>
              <div className='grid grid-cols-2 gap-3'>
                {quickLinks.map(link => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className='hover:bg-muted flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors'
                  >
                    <link.icon className='text-primary size-6' />
                    <span className='text-sm'>{link.label}</span>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

export default Workbench
