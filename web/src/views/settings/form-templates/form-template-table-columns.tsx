'use client'

import type { ColumnDef } from '@tanstack/react-table'

import type { PerfFormTemplateVersionStatus, PerfFormTemplateVersionSummary } from '@/lib/perf-api'
import { formatDateTime } from '@/lib/perf-api'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { FORM_TEMPLATE_STATUS_LABEL, JOB_LEVEL_PREFIX_LABEL } from './form-template-constants'

const statusClass: Record<PerfFormTemplateVersionStatus, string> = {
  DRAFT: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  PUBLISHED: 'bg-green-500/10 text-green-600 dark:text-green-400',
  ARCHIVED: 'bg-muted text-muted-foreground'
}

export type FormTemplateTableColumnsContext = {
  onOpen: (row: PerfFormTemplateVersionSummary) => void
  isAdmin: boolean
}

/** 版本列表列定义（filters 变体），与列表页面分离。 */
export const buildFormTemplateTableColumns = ({
  onOpen,
  isAdmin
}: FormTemplateTableColumnsContext): ColumnDef<PerfFormTemplateVersionSummary>[] => [
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
    id: 'jobLevelPrefix',
    accessorFn: row => JOB_LEVEL_PREFIX_LABEL[row.jobLevelPrefix],
    header: '职级前缀',
    filterFn: 'equalsString',
    cell: ({ row }) => <Badge variant='outline'>{JOB_LEVEL_PREFIX_LABEL[row.original.jobLevelPrefix]}</Badge>
  },
  {
    id: 'version',
    accessorFn: row => row.version,
    header: '版本',
    cell: ({ row }) => <span className='tabular-nums'>v{row.original.version}</span>
  },
  {
    id: 'status',
    accessorFn: row => FORM_TEMPLATE_STATUS_LABEL[row.status],
    header: '状态',
    filterFn: 'equalsString',
    cell: ({ row }) => (
      <Badge className={statusClass[row.original.status]}>{FORM_TEMPLATE_STATUS_LABEL[row.original.status]}</Badge>
    )
  },
  {
    id: 'sourceVersion',
    header: '来源版本',
    enableSorting: false,
    cell: ({ row }) => (
      <span className='text-muted-foreground'>
        {row.original.sourceVersionId ? `#${row.original.sourceVersionId}` : '-'}
      </span>
    )
  },
  {
    id: 'updatedAt',
    accessorKey: 'updatedAt',
    header: '更新时间',
    cell: ({ row }) => (
      <span className='text-muted-foreground whitespace-nowrap'>{formatDateTime(row.original.updatedAt)}</span>
    )
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
