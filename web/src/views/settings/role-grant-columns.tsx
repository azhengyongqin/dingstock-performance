'use client'

// Third-party Imports
import type { ColumnDef } from '@tanstack/react-table'

// Component Imports
import { UserAvatar } from '@/components/shared/lark'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

// Util Imports
import type { LarkUserBrief } from '@/lib/perf-api'
import { avatarUrlOf, formatDateTime } from '@/lib/perf-api'

/** 角色授权行 = 后端 GET /role-grants 的 item */
export type RoleGrantRow = {
  id: number
  userOpenId: string
  role: 'HR' | 'ADMIN'
  orgScope: string[]
  grantedByOpenId: string | null
  createdAt: string
  user: LarkUserBrief | null
  grantedBy: LarkUserBrief | null
}

const roleBadgeClass: Record<RoleGrantRow['role'], string> = {
  ADMIN: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  HR: 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
}

const ROLE_LABEL: Record<RoleGrantRow['role'], string> = {
  ADMIN: '超级管理员',
  HR: 'HR'
}

/** 列定义工厂：撤销回调与部门名映射由页面注入 */
export const buildRoleGrantColumns = (ctx: {
  onRevoke: (row: RoleGrantRow) => void
  departmentNameOf: (id: string) => string
  canManage: boolean
}): ColumnDef<RoleGrantRow>[] => [
  {
    id: 'user',
    header: '被授权人',
    cell: ({ row }) => (
      <div className='flex items-center gap-2'>
        <UserAvatar
          openId={row.original.userOpenId}
          name={row.original.user?.name}
          avatarUrl={avatarUrlOf(row.original.user)}
          size='sm'
        />
        <span className='font-medium'>{row.original.user?.name ?? row.original.userOpenId}</span>
      </div>
    )
  },
  {
    id: 'role',
    accessorFn: row => ROLE_LABEL[row.role],
    header: '角色',
    cell: ({ row }) => (
      <Badge className={roleBadgeClass[row.original.role]}>{ROLE_LABEL[row.original.role]}</Badge>
    )
  },
  {
    id: 'orgScope',
    header: '组织范围',
    cell: ({ row }) =>
      row.original.orgScope.length === 0 ? (
        <span className='text-muted-foreground'>全局</span>
      ) : (
        <div className='flex max-w-80 flex-wrap gap-1'>
          {row.original.orgScope.map(id => (
            <Badge key={id} variant='outline'>
              {ctx.departmentNameOf(id)}
            </Badge>
          ))}
        </div>
      )
  },
  {
    id: 'grantedBy',
    header: '授权人',
    cell: ({ row }) =>
      row.original.grantedBy?.name ?? <span className='text-muted-foreground'>系统初始化</span>
  },
  {
    id: 'createdAt',
    header: '授权时间',
    cell: ({ row }) => <span className='text-muted-foreground'>{formatDateTime(row.original.createdAt)}</span>
  },
  {
    id: 'actions',
    header: '操作',
    enableSorting: false,
    meta: { headClassName: 'text-right', cellClassName: 'text-right' },
    cell: ({ row }) =>
      ctx.canManage ? (
        <Button variant='ghost' size='sm' className='text-destructive' onClick={() => ctx.onRevoke(row.original)}>
          撤销
        </Button>
      ) : null
  }
]
