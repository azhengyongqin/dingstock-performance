// React Imports
import type { ForwardRefExoticComponent, RefAttributes } from 'react'

// Third-party Imports
import {
  BadgeCheckIcon,
  BarChart3Icon,
  CalendarRangeIcon,
  FilePenIcon,
  FileSpreadsheetIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  ListTodoIcon,
  MessageSquareWarningIcon,
  NetworkIcon,
  ScrollTextIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  UsersIcon
} from 'lucide-react'
import type { LucideProps } from 'lucide-react'

// 命令面板（⌘K）搜索数据：与 navConfig 中的业务路由保持一致
export type SearchData = {
  title: string
  data: {
    icon: ForwardRefExoticComponent<Omit<LucideProps, 'ref'> & RefAttributes<SVGSVGElement>>
    name: string
    href: string
    shortcut?: string
    tags?: string[]
    openInNewTab?: boolean
  }[]
}

export const searchData: SearchData[] = [
  {
    title: '工作台',
    data: [
      {
        icon: LayoutDashboardIcon,
        name: '工作台',
        href: '/workbench',
        tags: ['workbench', 'home', '待办', '首页']
      }
    ]
  },
  {
    title: '绩效周期',
    data: [
      {
        icon: CalendarRangeIcon,
        name: '周期列表',
        href: '/cycles',
        tags: ['cycle', '周期', '考核', '绩效计划']
      }
    ]
  },
  {
    title: '团队评审',
    data: [
      {
        icon: UsersIcon,
        name: '团队看板',
        href: '/team-review',
        tags: ['team', '团队', '进度']
      },
      {
        icon: SlidersHorizontalIcon,
        name: '绩效校准',
        href: '/calibrations',
        tags: ['calibration', '校准', '等级分布']
      }
    ]
  },
  {
    title: '我的绩效',
    data: [
      {
        icon: FilePenIcon,
        name: '员工自评',
        href: '/self-review',
        tags: ['self review', '自评', 'OKR', '总结']
      },
      {
        icon: BadgeCheckIcon,
        name: '结果确认',
        href: '/results',
        tags: ['result', '结果', '确认', '申诉']
      },
      {
        icon: HistoryIcon,
        name: '个人绩效档案',
        href: '/profile/performance',
        tags: ['history', '档案', '历史绩效']
      }
    ]
  },
  {
    title: '评审任务',
    data: [
      {
        icon: ListTodoIcon,
        name: '任务列表',
        href: '/review-tasks',
        tags: ['review task', '评审', '待办任务', '360']
      }
    ]
  },
  {
    title: '数据看板',
    data: [
      {
        icon: BarChart3Icon,
        name: '绩效看板',
        href: '/dashboard',
        tags: ['dashboard', '看板', '统计', '图表']
      },
      {
        icon: FileSpreadsheetIcon,
        name: '报表导出',
        href: '/reports',
        tags: ['report', '报表', '导出', 'excel']
      }
    ]
  },
  {
    title: '系统管理',
    data: [
      {
        icon: NetworkIcon,
        name: '组织架构',
        href: '/settings/organization',
        tags: ['organization', '部门', '成员', '飞书同步']
      },
      {
        icon: MessageSquareWarningIcon,
        name: '申诉处理',
        href: '/appeals',
        tags: ['appeal', '申诉', '面谈']
      },
      {
        icon: SettingsIcon,
        name: '系统配置',
        href: '/settings',
        tags: ['settings', '配置', '飞书', '通知']
      },
      {
        icon: ScrollTextIcon,
        name: '操作日志',
        href: '/audit-logs',
        tags: ['audit', '日志', '审计']
      }
    ]
  }
]
