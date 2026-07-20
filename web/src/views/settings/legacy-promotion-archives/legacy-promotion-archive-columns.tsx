'use client'

import type { ColumnDef } from '@tanstack/react-table'

import { UserAvatar } from '@/components/shared/lark'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { PerfLegacyPromotionArchive } from '@/lib/perf-api'
import { formatDateTime } from '@/lib/perf-api'

export const LEGACY_PROMOTION_SOURCE_LABEL: Record<PerfLegacyPromotionArchive['source']['type'], string> = {
  EVALUATION_ITEM_RESULT: '旧表单答案',
  RESULT_VERSION_SNAPSHOT: '历史结果快照'
}

/** 日志型归档列表使用后端分页，列定义与页面请求状态分离。 */
export const createLegacyPromotionArchiveColumns = (
  onView: (archive: PerfLegacyPromotionArchive) => void
): ColumnDef<PerfLegacyPromotionArchive>[] => [
  {
    id: 'cycle',
    header: '绩效周期',
    enableSorting: false,
    cell: ({ row }) => <span className='font-medium whitespace-nowrap'>{row.original.cycle.name}</span>
  },
  {
    id: 'participant',
    header: '参与人',
    enableSorting: false,
    cell: ({ row }) => {
      const employee = row.original.participant.employee

      return (
        <div className='flex items-center gap-2'>
          <UserAvatar
            openId={employee.openId}
            name={employee.name ?? undefined}
            avatarUrl={employee.avatarUrl}
            size='sm'
          />
          <span className='whitespace-nowrap'>{employee.name ?? employee.openId}</span>
        </div>
      )
    }
  },
  {
    id: 'source',
    header: '归档来源',
    enableSorting: false,
    cell: ({ row }) => <Badge variant='outline'>{LEGACY_PROMOTION_SOURCE_LABEL[row.original.source.type]}</Badge>
  },
  {
    id: 'summary',
    header: '内容摘要',
    enableSorting: false,
    meta: { cellClassName: 'max-w-80' },
    cell: ({ row }) => {
      const entry = row.original.payload.entries[0]
      const summary = entry?.kind === 'TEXT' ? entry.content : entry?.kind === 'LINK' ? entry.url : entry?.name

      return <span className='text-muted-foreground block max-w-80 truncate'>{summary ?? '无可展示内容'}</span>
    }
  },
  {
    id: 'archivedAt',
    header: '归档时间',
    enableSorting: false,
    cell: ({ row }) => (
      <span className='text-muted-foreground whitespace-nowrap'>{formatDateTime(row.original.archivedAt)}</span>
    )
  },
  {
    id: 'actions',
    header: '操作',
    enableSorting: false,
    cell: ({ row }) => (
      <Button variant='outline' size='sm' onClick={() => onView(row.original)}>
        查看归档内容
      </Button>
    )
  }
]
