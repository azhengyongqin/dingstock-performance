import { BadgeCheckIcon, BriefcaseBusinessIcon, Building2Icon, CalendarDaysIcon, UsersIcon } from 'lucide-react'

import type {
  PerfConfigReviewerRelation,
  PerfDetailedEmployeeProfile,
  PerfPeerSafeEmployeeProfile
} from '@/lib/perf-api'

type EmployeeBasicInfoProps =
  | { variant: 'detailed'; employee: PerfDetailedEmployeeProfile | null }
  | {
      variant: 'peer'
      employee: PerfPeerSafeEmployeeProfile | null
      relation?: PerfConfigReviewerRelation | null
    }

const RELATION_LABEL: Record<PerfConfigReviewerRelation, string> = {
  ORG_OWNER: '组织负责人',
  PROJECT_OWNER: '项目负责人',
  PEER: '同部门同事',
  CROSS_DEPT: '跨部门协作方'
}

/** 参考模板 User Profile/About 的图标信息列表，空 CoreHR 字段统一显示“未同步”。 */
const EmployeeBasicInfo = (props: EmployeeBasicInfoProps) => {
  const { employee } = props

  const items = [
    { label: '部门', value: employee?.departmentPath, icon: Building2Icon },
    { label: '职务', value: employee?.jobTitle, icon: BriefcaseBusinessIcon },
    ...(props.variant === 'detailed'
      ? [{ label: '职级', value: props.employee?.jobLevel, icon: BadgeCheckIcon }]
      : []),
    ...(props.variant === 'detailed'
      ? [{ label: '入职日期', value: props.employee?.effectiveDate, icon: CalendarDaysIcon }]
      : []),
    ...(props.variant === 'peer' && props.relation
      ? [{ label: '评审关系', value: RELATION_LABEL[props.relation], icon: UsersIcon }]
      : [])
  ]

  return (
    <section className='space-y-3'>
      <p className='text-muted-foreground text-xs font-medium uppercase'>员工信息</p>
      <ul className='space-y-4'>
        {items.map(item => {
          const Icon = item.icon

          return (
            <li key={item.label} className='flex items-start gap-2'>
              <Icon className='mt-0.5 size-4 shrink-0' />
              <span className='shrink-0 text-sm font-medium'>{item.label}：</span>
              <span className='min-w-0 text-sm break-words'>{item.value || '未同步'}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default EmployeeBasicInfo
