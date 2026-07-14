'use client'

import type { ColumnDef } from '@tanstack/react-table'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { PerfConfigTemplateVersionStatus, PerfConfigTemplateVersionSummary } from '@/lib/perf-api'
import { formatDateTime } from '@/lib/perf-api'

import { mergeConfigTemplateIssues } from './config-template-utils'

export const CONFIG_TEMPLATE_STATUS_LABEL: Record<PerfConfigTemplateVersionStatus, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  ARCHIVED: '已归档'
}

export const CONFIG_TEMPLATE_STATUS_OPTIONS = Object.values(CONFIG_TEMPLATE_STATUS_LABEL)

const statusClass: Record<PerfConfigTemplateVersionStatus, string> = {
  DRAFT: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  PUBLISHED: 'bg-green-500/10 text-green-600 dark:text-green-400',
  ARCHIVED: 'bg-muted text-muted-foreground'
}

export const buildConfigTemplateTableColumns = ({
  onOpen,
  isAdmin
}: {
  onOpen: (row: PerfConfigTemplateVersionSummary) => void
  isAdmin: boolean
}): ColumnDef<PerfConfigTemplateVersionSummary>[] => [
  {
    id: 'name',
    accessorKey: 'name',
    header: '模板名称',
    cell: ({ row }) => (
      <Button variant='link' className='h-auto justify-start p-0 font-medium' onClick={() => onOpen(row.original)}>
        {row.original.name}
      </Button>
    )
  },
  {
    id: 'version',
    accessorKey: 'version',
    header: '版本',
    cell: ({ row }) => <span className='tabular-nums'>v{row.original.version}</span>
  },
  {
    id: 'status',
    accessorFn: row => CONFIG_TEMPLATE_STATUS_LABEL[row.status],
    header: '状态',
    filterFn: 'equalsString',
    cell: ({ row }) => (
      <Badge className={statusClass[row.original.status]}>{CONFIG_TEMPLATE_STATUS_LABEL[row.original.status]}</Badge>
    )
  },
  {
    id: 'coverage',
    header: '表单覆盖',
    enableSorting: false,
    cell: ({ row }) => {
      const prefixes = new Set(row.original.formBindings?.map(binding => binding.jobLevelPrefix) ?? [])

      return (
        <div className='flex gap-1'>
          {(['D', 'M'] as const).map(prefix => (
            <Badge key={prefix} variant={prefixes.has(prefix) ? 'default' : 'outline'}>{prefix}</Badge>
          ))}
        </div>
      )
    }
  },
  {
    id: 'availability',
    accessorFn: row => (row.available === false || row.isUsable === false ? '不可用' : '可用'),
    header: '可用性',
    filterFn: 'equalsString',
    cell: ({ row }) => {
      const unavailable = row.original.available === false || row.original.isUsable === false

      return (
        <Badge variant={unavailable ? 'destructive' : 'outline'}>
          {unavailable ? `不可用（${mergeConfigTemplateIssues(row.original).length}）` : '可用'}
        </Badge>
      )
    }
  },
  {
    id: 'sourceVersion',
    header: '来源',
    enableSorting: false,
    cell: ({ row }) => <span className='text-muted-foreground'>{row.original.sourceVersionId ? `#${row.original.sourceVersionId}` : '-'}</span>
  },
  {
    id: 'updatedAt',
    accessorKey: 'updatedAt',
    header: '更新时间',
    cell: ({ row }) => <span className='text-muted-foreground whitespace-nowrap'>{formatDateTime(row.original.updatedAt)}</span>
  },
  {
    id: 'actions',
    header: '操作',
    enableSorting: false,
    meta: { headClassName: 'text-right', cellClassName: 'text-right' },
    cell: ({ row }) => (
      <Button variant='ghost' size='sm' onClick={() => onOpen(row.original)}>
        {isAdmin && row.original.status === 'DRAFT' ? '编辑' : '查看'}
      </Button>
    )
  }
]
