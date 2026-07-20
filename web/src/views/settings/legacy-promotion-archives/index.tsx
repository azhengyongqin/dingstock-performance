'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import type { PaginationState } from '@tanstack/react-table'
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { Loader2Icon, ShieldAlertIcon } from 'lucide-react'

import { DataTable, DataTablePagination } from '@/components/datatable'
import PageHeader from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ApiError } from '@/lib/api'
import {
  formatDateTime,
  getLegacyPromotionArchives,
  type PerfLegacyPromotionArchive,
  type PerfLegacyPromotionArchiveEntry
} from '@/lib/perf-api'

import { createLegacyPromotionArchiveColumns, LEGACY_PROMOTION_SOURCE_LABEL } from './legacy-promotion-archive-columns'

const ArchiveEntry = ({ entry }: { entry: PerfLegacyPromotionArchiveEntry }) => {
  if (entry.kind === 'TEXT') {
    return (
      <div className='space-y-1 rounded-lg border p-3'>
        <p className='text-muted-foreground text-xs'>{entry.label}</p>
        {/* 历史 Markdown 也按纯文本展示，禁止旧内容注入 HTML。 */}
        <p className='break-words whitespace-pre-wrap'>{entry.content}</p>
      </div>
    )
  }

  const label = entry.kind === 'ATTACHMENT' ? entry.name : entry.label
  const url = entry.url

  return (
    <div className='flex items-center justify-between gap-3 rounded-lg border p-3'>
      <span className='min-w-0 truncate'>{label}</span>
      <Button variant='outline' size='sm' render={<a href={url} target='_blank' rel='noreferrer' />}>
        安全打开
      </Button>
    </div>
  )
}

/** 仅消费后端白名单结构，绝不 stringify 或递归渲染归档原始 JSON。 */
export const LegacyPromotionArchiveDetails = ({ archive }: { archive: PerfLegacyPromotionArchive }) => {
  const payload = archive.payload

  return (
    <div className='space-y-5'>
      <div className='bg-muted/50 grid gap-3 rounded-lg p-4 sm:grid-cols-2'>
        <div>
          <p className='text-muted-foreground text-xs'>绩效周期</p>
          <p className='font-medium'>{archive.cycle.name}</p>
        </div>
        <div>
          <p className='text-muted-foreground text-xs'>参与人</p>
          <p className='font-medium'>{archive.participant.employee.name ?? archive.participant.employee.openId}</p>
        </div>
        <div>
          <p className='text-muted-foreground text-xs'>归档来源</p>
          <Badge variant='outline'>{LEGACY_PROMOTION_SOURCE_LABEL[archive.source.type]}</Badge>
        </div>
        <div>
          <p className='text-muted-foreground text-xs'>来源时间</p>
          <p>{formatDateTime(archive.source.createdAt)}</p>
        </div>
      </div>

      {payload.kind === 'EVALUATION_ANSWER' ? (
        <div className='grid gap-3 text-sm sm:grid-cols-2'>
          <p>阶段：{payload.stage ?? '-'}</p>
          <p>提交状态：{payload.status ?? '-'}</p>
          <p>字段类型：{payload.fieldType ?? '-'}</p>
          <p>原始评级：{payload.rating ?? '-'}</p>
          <p>原始分数：{payload.score ?? '-'}</p>
          <p>计算分：{payload.calculationScore ?? '-'}</p>
        </div>
      ) : (
        <p className='text-muted-foreground text-sm'>历史结果版本：{payload.version ?? '-'}</p>
      )}

      <div className='space-y-2'>
        <p className='font-medium'>归档内容</p>
        {payload.entries.length > 0 ? (
          payload.entries.map((entry, index) => <ArchiveEntry key={`${entry.kind}-${index}`} entry={entry} />)
        ) : (
          <p className='text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm'>
            此归档没有可安全展示的内容
          </p>
        )}
      </div>
    </div>
  )
}

const LegacyPromotionArchives = () => {
  const [items, setItems] = useState<PerfLegacyPromotionArchive[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [selected, setSelected] = useState<PerfLegacyPromotionArchive | null>(null)
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 })

  const fetchArchives = useCallback(async (page: number, pageSize: number) => {
    setLoading(true)
    setError(null)

    try {
      const data = await getLegacyPromotionArchives(page, pageSize)

      setItems(data.items)
      setTotal(data.total)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 403) setForbidden(true)
      else setError(cause instanceof Error ? cause.message : '无法加载旧晋升答案归档。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchArchives(pagination.pageIndex + 1, pagination.pageSize)
  }, [fetchArchives, pagination])

  const columns = useMemo(() => createLegacyPromotionArchiveColumns(setSelected), [])

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: items,
    columns,
    state: { pagination },
    onPaginationChange: setPagination,
    manualPagination: true,
    rowCount: total,
    getRowId: row => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    enableSorting: false
  })

  if (forbidden) {
    return (
      <div className='flex flex-col gap-6'>
        <PageHeader title='旧晋升答案归档' description='从旧绩效表单链退出、等待后续迁移的只读历史内容' />
        <Card>
          <CardContent className='text-muted-foreground flex flex-col items-center gap-2 py-12 text-sm'>
            <ShieldAlertIcon className='size-6' />仅 HR 或 Admin 可以查看旧晋升答案归档
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader title='旧晋升答案归档' description='旧晋升内容仅供只读核对，不参与新版绩效模板、提交或计算' />

      <Card>
        <CardContent>
          {loading ? (
            <div className='text-muted-foreground flex items-center justify-center gap-2 py-16'>
              <Loader2Icon className='size-4 animate-spin' />
              正在加载归档…
            </div>
          ) : error ? (
            <div className='text-destructive flex flex-col items-center gap-3 py-16 text-sm'>
              {error}
              <Button
                variant='outline'
                size='sm'
                onClick={() => void fetchArchives(pagination.pageIndex + 1, pagination.pageSize)}
              >
                重试
              </Button>
            </div>
          ) : (
            <DataTable table={table} emptyText='暂无旧晋升答案归档' />
          )}
          <DataTablePagination table={table} pageSizeOptions={[10, 20, 50, 100]} />
        </CardContent>
      </Card>

      <Dialog open={selected !== null} onOpenChange={open => !open && setSelected(null)}>
        <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>旧晋升归档内容</DialogTitle>
            <DialogDescription>只读安全投影；未知字段、内部标识和任意 JSON 不会展示。</DialogDescription>
          </DialogHeader>
          {selected && <LegacyPromotionArchiveDetails archive={selected} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default LegacyPromotionArchives
