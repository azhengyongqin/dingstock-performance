// Third-party Imports
import type * as Icon from 'lucide-react'

// Context Imports
import type { NavRole } from '@/contexts/authContext'

type IconName = keyof typeof Icon

export type MenuLeafSubItem = {
  label: string
  href: string
  activePath?: string
  badge?: string
  badgeClassName?: string
  target?: '_blank' | '_self' | '_parent' | '_top'

  /** 可见角色（HR/ADMIN 显式授权，LEADER 派生）；不声明 = 所有登录用户可见 */
  roles?: NavRole[]
}

export type MenuGroupSubItem = {
  label: string
  childItems: MenuLeafSubItem[]
  roles?: NavRole[]
}

export type MenuSubItem = MenuLeafSubItem | MenuGroupSubItem

export type MenuItem = {
  icon: IconName
  label: string

  /** 可见角色（HR/ADMIN 显式授权，LEADER 派生）；不声明 = 所有登录用户可见 */
  roles?: NavRole[]
} & (
  | {
      href: string

      /** 用于子路由（如详情页）时保持菜单高亮的前缀匹配路径 */
      activePath?: string
      badge?: string
      badgeClassName?: string
      childItems?: never
      target?: '_blank' | '_self' | '_parent' | '_top'
    }
  | { href?: never; badge?: never; childItems: MenuSubItem[] }
)

export type NavItem = {
  groupLabel?: string
  items: MenuItem[]
}

/**
 * 员工绩效系统侧边栏导航配置（唯一入口）。
 * 按角色视角分组：HR / Leader / 员工 / 评审员 / 管理员。
 */
export const navItems: NavItem[] = [
  {
    groupLabel: '工作台',
    items: [
      {
        icon: 'LayoutDashboard',
        label: '工作台',
        href: '/workbench'
      }
    ]
  },
  {
    groupLabel: '绩效周期',
    items: [
      {
        icon: 'CalendarRange',
        label: '周期列表',
        href: '/cycles',
        activePath: '/cycles',
        roles: ['HR', 'ADMIN']
      }
    ]
  },
  {
    groupLabel: '团队评审',
    items: [
      {
        icon: 'Users',
        label: '团队看板',
        href: '/team-review',
        roles: ['LEADER', 'HR', 'ADMIN']
      },
      {
        icon: 'SlidersHorizontal',
        label: '绩效校准',
        href: '/calibrations',
        roles: ['HR', 'ADMIN']
      }
    ]
  },
  {
    groupLabel: '我的绩效',
    items: [
      {
        icon: 'FilePen',
        label: '员工自评',
        href: '/self-review'
      },
      {
        icon: 'BadgeCheck',
        label: '结果确认',
        href: '/results'
      },
      {
        icon: 'History',
        label: '个人绩效档案',
        href: '/profile/performance'
      }
    ]
  },
  {
    groupLabel: '评审任务',
    items: [
      {
        icon: 'ListTodo',
        label: '任务列表',
        href: '/review-tasks'
      }
    ]
  },
  {
    groupLabel: '数据看板',
    items: [
      {
        icon: 'BarChart3',
        label: '绩效看板',
        href: '/dashboard',
        roles: ['HR', 'ADMIN']
      },
      {
        icon: 'FileSpreadsheet',
        label: '报表导出',
        href: '/reports',
        roles: ['HR', 'ADMIN']
      }
    ]
  },
  {
    groupLabel: '系统管理',
    items: [
      {
        icon: 'Network',
        label: '组织架构',
        href: '/settings/organization',
        roles: ['HR', 'ADMIN']
      },
      {
        icon: 'MessageSquareWarning',
        label: '申诉处理',
        href: '/appeals',
        roles: ['HR', 'ADMIN']
      },
      {
        icon: 'LayoutTemplate',
        label: '配置模板',
        href: '/settings/templates',
        roles: ['HR', 'ADMIN']
      },
      {
        icon: 'Settings',
        label: '系统配置',
        href: '/settings',
        roles: ['HR', 'ADMIN']
      },
      {
        icon: 'ScrollText',
        label: '操作日志',
        href: '/audit-logs',
        roles: ['HR', 'ADMIN']
      }
    ]
  }
]
