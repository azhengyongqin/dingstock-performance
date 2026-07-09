'use client'

// Third-party Imports
import type { ColumnDef } from '@tanstack/react-table'

// Component Imports
import { UserAvatar } from '@/components/shared/lark'

// Util Imports
import type { LarkUserBrief } from '@/lib/perf-api'
import { avatarUrlOf, formatDateTime } from '@/lib/perf-api'

/** 操作日志行 = 后端 GET /audit-logs 的 item */
export type AuditLogRow = {
  id: number
  operatorOpenId: string | null
  operator: LarkUserBrief | null
  action: string
  targetType: string | null
  targetId: string | number | null
  before: unknown
  after: unknown
  reason: string | null
  ip: string | null
  createdAt: string
}

/** 操作对象展示：targetType#targetId，缺失时显示 - */
export const formatTarget = (log: AuditLogRow): string =>
  log.targetType ? `${log.targetType}#${log.targetId ?? '-'}` : '-'

/**
 * 操作日志列定义（page-size-selector + export-button 变体）。
 * 后端分页场景下不做客户端排序，全部列 enableSorting: false。
 */
export const auditLogColumns: ColumnDef<AuditLogRow>[] = [
  {
    id: 'createdAt',
    header: '时间',
    enableSorting: false,
    cell: ({ row }) => (
      <span className='text-muted-foreground whitespace-nowrap'>{formatDateTime(row.original.createdAt)}</span>
    )
  },
  {
    id: 'operator',
    header: '操作人',
    enableSorting: false,
    cell: ({ row }) => {
      const { operator, operatorOpenId } = row.original

      return (
        <div className='flex items-center gap-2'>
          {/* 统一人员头像组件：点击弹出飞书成员名片 */}
          <UserAvatar
            openId={operator?.open_id ?? operatorOpenId}
            name={operator?.name}
            avatarUrl={avatarUrlOf(operator)}
            size='sm'
          />
          <span className='font-medium whitespace-nowrap'>{operator?.name ?? operatorOpenId ?? '-'}</span>
        </div>
      )
    }
  },
  {
    id: 'action',
    header: '操作类型',
    enableSorting: false,
    cell: ({ row }) => <span className='font-mono text-xs whitespace-nowrap'>{row.original.action}</span>
  },
  {
    id: 'target',
    header: '对象',
    enableSorting: false,
    cell: ({ row }) => (
      <span className='text-muted-foreground font-mono text-xs whitespace-nowrap'>{formatTarget(row.original)}</span>
    )
  },
  {
    id: 'reason',
    header: '原因',
    enableSorting: false,
    meta: { cellClassName: 'max-w-80' },
    cell: ({ row }) => (
      <span className='text-muted-foreground block max-w-80 truncate'>{row.original.reason ?? '-'}</span>
    )
  }
]
