'use client'

// Third-party Imports
import type { ColumnDef } from '@tanstack/react-table'

// Component Imports
import { UserAvatar } from '@/components/shared/lark'
import { Badge } from '@/components/ui/badge'

// ===== 后端数据类型（NestJS /contact 模块） =====

/** CoreHR 多语言名称 { lang, value }[]（lang 形如 zh-CN / en-US） */
type I18nName = { lang: string; value: string }[]

/** CoreHR 枚举对象 { enum_name, display[] } */
type CorehrEnum = { enum_name: string; display?: I18nName }

/**
 * 飞书人事员工详情（由 corehr.v2 employee.batchGet 同步，可能为 null：
 * 未开通飞书人事 / 该账号未录入 CoreHR / 应用缺 corehr:employee:read 权限）。
 * 仅声明表格用到的字段，完整字段见后端 LarkCorehrEmployee model。
 */
export type CorehrEmployee = {
  employee_number?: string | null
  employment_status?: CorehrEnum | null
  effective_date?: string | null
  department_id?: string | null
  job_level?: { name?: I18nName; level_order?: number } | null
  job_family?: { name?: I18nName } | null
  job?: { name?: I18nName } | null
  direct_manager_id?: string | null

  /** 后端根据 direct_manager_id 反查 lark_users 得到的姓名 */
  direct_manager_name?: string | null
  tenure?: string | null
  on_probation?: boolean | null
  probation_end_date?: string | null
}

/** 飞书用户（avatar / status 为 JSON 字段，可能是字符串或对象） */
export type LarkUser = {
  open_id: string
  user_id: string
  name: string
  en_name?: string
  email?: string
  mobile?: string
  avatar?: string | { avatar_72?: string; avatar_240?: string; avatar_640?: string; avatar_origin?: string }
  job_title?: string
  department_ids?: string[]
  status?: string | { is_activated?: boolean; is_resigned?: boolean; is_frozen?: boolean }
  corehr?: CorehrEmployee | null
}

/** 在职状态筛选候选值（来自 status JSON 的 is_resigned/is_activated 推导） */
export const MEMBER_STATUS_OPTIONS = ['在职', '离职']

// 解析可能是字符串的 JSON 字段
export const parseJsonField = <T,>(value: string | T | undefined): T | undefined => {
  if (value === undefined || value === null) return undefined

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return undefined
    }
  }

  return value as T
}

// CoreHR 多语言名称取值：优先中文，其次英文，兜底第一项
export const pickI18nName = (name?: I18nName | null): string | undefined => {
  if (!name?.length) return undefined

  return (
    name.find(item => item.lang.toLowerCase().startsWith('zh'))?.value ??
    name.find(item => item.lang.toLowerCase().startsWith('en'))?.value ??
    name[0]?.value
  )
}

// CoreHR 日期归一化：接口可能返回 "2024-02-01 00:00:00"，只取日期部分；"9999-12-31" 表示无固定期限
const formatCorehrDate = (date?: string | null): string | undefined => {
  if (!date) return undefined
  const day = date.split(' ')[0]

  return day.startsWith('9999') ? undefined : day
}

// 用户明细状态文案与样式（用于状态列 Badge 展示）
const getUserStatus = (user: LarkUser): { label: string; className: string } => {
  const status = parseJsonField<{ is_activated?: boolean; is_resigned?: boolean; is_frozen?: boolean }>(user.status)

  if (status?.is_resigned) return { label: '已离职', className: 'bg-muted text-muted-foreground' }
  if (status?.is_frozen) return { label: '已冻结', className: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' }
  if (status?.is_activated) return { label: '已激活', className: 'bg-green-500/10 text-green-600 dark:text-green-400' }

  return { label: '未激活', className: 'bg-muted text-muted-foreground' }
}

/** 在职/离职归一化：is_resigned 为离职，其余（含未激活）视为在职，供状态列筛选使用 */
export const getUserWorkStatus = (user: LarkUser): string => {
  const status = parseJsonField<{ is_resigned?: boolean }>(user.status)

  return status?.is_resigned ? '离职' : '在职'
}

// 取头像地址（优先 72px 小图）
const getAvatarUrl = (user: LarkUser): string | undefined => {
  const avatar = parseJsonField<{ avatar_72?: string; avatar_240?: string }>(user.avatar)

  return avatar?.avatar_72 ?? avatar?.avatar_240
}

// 次要文本单元格的统一渲染（空值显示 -）
const MutedCell = ({ value }: { value?: string | null }) => (
  <span className='text-muted-foreground whitespace-nowrap'>{value || '-'}</span>
)

/** 列定义工厂的上下文：部门名称由页面侧（已加载全量部门）提供 */
export type MemberColumnsContext = {
  getDepartmentName: (departmentId: string) => string | undefined
}

/**
 * 成员列表列定义（完整 users-list 模式 + column-visibility 变体：列较多，
 * 页面侧默认隐藏部分次要列并提供「列显示」下拉自选）。
 * CoreHR 详情列在 corehr 为 null 时统一显示 "-"，保证未开通飞书人事也可用。
 */
export const buildMemberTableColumns = (context: MemberColumnsContext): ColumnDef<LarkUser>[] => [
  {
    id: 'name',
    accessorKey: 'name',
    header: '成员',
    cell: ({ row }) => {
      const user = row.original
      const avatarUrl = getAvatarUrl(user)

      return (
        <div className='flex items-center gap-3'>
          {/* 统一人员头像组件：点击弹出飞书成员名片 */}
          <UserAvatar openId={user.open_id} name={user.name} avatarUrl={avatarUrl} className='size-8' />
          <div className='flex flex-col'>
            <span className='font-medium whitespace-nowrap'>{user.name}</span>
            {user.en_name && <span className='text-muted-foreground text-xs'>{user.en_name}</span>}
          </div>
        </div>
      )
    }
  },
  {
    id: 'employee_number',
    header: '工号',
    accessorFn: user => user.corehr?.employee_number ?? '',
    cell: ({ row }) => <MutedCell value={row.original.corehr?.employee_number} />
  },
  {
    id: 'department',
    header: '部门',
    enableSorting: false,

    // 优先 CoreHR 主属部门，兜底通讯录首个部门；ID 统一为 open_department_id
    accessorFn: user => {
      const departmentId = user.corehr?.department_id ?? user.department_ids?.[0]

      return departmentId ? (context.getDepartmentName(departmentId) ?? '') : ''
    },
    cell: ({ getValue }) => <MutedCell value={getValue<string>()} />
  },
  {
    id: 'job',
    header: '职务',
    enableSorting: false,

    // 优先 CoreHR 职务名称，兜底通讯录 job_title
    accessorFn: user => pickI18nName(user.corehr?.job?.name) ?? user.job_title ?? '',
    cell: ({ getValue }) => <MutedCell value={getValue<string>()} />
  },
  {
    id: 'job_level',
    header: '职级',
    accessorFn: user => user.corehr?.job_level?.level_order ?? -1,
    cell: ({ row }) => <MutedCell value={pickI18nName(row.original.corehr?.job_level?.name)} />
  },
  {
    id: 'job_family',
    header: '序列',
    enableSorting: false,
    accessorFn: user => pickI18nName(user.corehr?.job_family?.name) ?? '',
    cell: ({ getValue }) => <MutedCell value={getValue<string>()} />
  },
  {
    id: 'direct_manager',
    header: '直属上级',
    enableSorting: false,
    accessorFn: user => user.corehr?.direct_manager_name ?? '',
    cell: ({ getValue }) => <MutedCell value={getValue<string>()} />
  },
  {
    id: 'effective_date',
    header: '入职日期',
    accessorFn: user => formatCorehrDate(user.corehr?.effective_date) ?? '',
    cell: ({ getValue }) => <MutedCell value={getValue<string>()} />
  },
  {
    id: 'tenure',
    header: '司龄',
    accessorFn: user => Number(user.corehr?.tenure ?? -1),
    cell: ({ row }) => {
      const tenure = row.original.corehr?.tenure

      return <MutedCell value={tenure ? `${tenure} 年` : undefined} />
    }
  },
  {
    accessorKey: 'email',
    header: '邮箱',
    enableSorting: false,
    cell: ({ row }) => <MutedCell value={row.original.email} />
  },
  {
    accessorKey: 'mobile',
    header: '手机号',
    enableSorting: false,
    cell: ({ row }) => <MutedCell value={row.original.mobile} />
  },
  {
    id: 'status',

    // 归一化为「在职 / 离职」以支持状态筛选；Badge 仍展示明细状态
    accessorFn: user => getUserWorkStatus(user),
    header: '状态',
    filterFn: 'equalsString',
    enableSorting: false,
    cell: ({ row }) => {
      const user = row.original
      const status = getUserStatus(user)

      return (
        <div className='flex items-center gap-1.5'>
          <Badge className={status.className}>{status.label}</Badge>
          {user.corehr?.on_probation && (
            <Badge variant='outline' className='text-blue-600 dark:text-blue-400'>
              试用期
            </Badge>
          )}
        </div>
      )
    }
  }
]
