'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import Link from 'next/link'

import type { ColumnFiltersState, PaginationState, SortingState } from '@tanstack/react-table'
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable
} from '@tanstack/react-table'
import { Loader2Icon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'

import { DataTable, DataTableColumnFilter, DataTablePagination, DataTableToolbar } from '@/components/datatable'
import PageHeader from '@/components/shared/PageHeader'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/contexts/authContext'
import { ApiError } from '@/lib/api'
import type { PerfConfigTemplateVersionSummary, PerfFormTemplateVersionSummary } from '@/lib/perf-api'
import {
  createPerfConfigTemplate,
  listPerfConfigTemplates,
  listPerfFormTemplates
} from '@/lib/perf-api'

import ConfigTemplateSheet from './config-template-sheet'
import {
  buildConfigTemplateTableColumns,
  CONFIG_TEMPLATE_STATUS_OPTIONS
} from './config-template-table-columns'

/** 新版配置模板管理：版本列表、Admin 生命周期维护，以及 HR 已发布版本只读查看。 */
const ConfigTemplateManager = () => {
  const { roles } = useAuth()
  const isAdmin = roles.includes('ADMIN')

  const [items, setItems] = useState<PerfConfigTemplateVersionSummary[]>([])
  const [formCandidates, setFormCandidates] = useState<PerfFormTemplateVersionSummary[]>([])
  const [selected, setSelected] = useState<PerfConfigTemplateVersionSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })

  const fetchItems = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [templates, forms] = await Promise.all([listPerfConfigTemplates(), listPerfFormTemplates()])

      setItems(templates.items ?? [])
      setFormCandidates(forms.items ?? [])
    } catch (requestError) {
      setError(
        requestError instanceof ApiError && requestError.status === 403
          ? '需要 HR 或超级管理员权限'
          : requestError instanceof Error
            ? requestError.message
            : '无法加载配置模板'
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const initialLoad = setTimeout(() => void fetchItems(), 0)

    return () => clearTimeout(initialLoad)
  }, [fetchItems])

  const columns = useMemo(() => buildConfigTemplateTableColumns({ onOpen: setSelected, isAdmin }), [isAdmin])

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: items,
    columns,
    state: { columnFilters, sorting, pagination },
    onColumnFiltersChange: setColumnFilters,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableSortingRemoval: false
  })

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error('模板名称不能为空')

      return
    }

    setCreating(true)

    try {
      const created = await createPerfConfigTemplate({
        name: name.trim(),
        description: description.trim() || undefined
      })

      toast.success('配置模板 v1 草稿已创建')
      setCreateOpen(false)
      setName('')
      setDescription('')
      await fetchItems()
      setSelected(created)
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : '创建失败')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='配置模板'
        description={isAdmin ? '版本化维护评级、计算约束、表单组合、相对日程和飞书通知规则' : '查看并选择可用于创建周期的已发布配置模板版本'}
        actions={isAdmin ? <Button onClick={() => setCreateOpen(true)}><PlusIcon />新建模板</Button> : undefined}
      />

      <Alert>
        <AlertTitle>新旧模板正在分阶段切换</AlertTitle>
        <AlertDescription>
          新版周期创建将在 Ticket 04 使用这里的已发布版本；当前生产周期仍读取旧 `/templates` 快照入口。
          <Button variant='link' className='h-auto px-1' render={<Link href='/settings/templates/legacy' />} nativeButton={false}>打开旧版模板管理</Button>
        </AlertDescription>
      </Alert>

      <Card>
        <CardContent>
          <DataTableToolbar table={table} searchColumn='name' searchPlaceholder='搜索配置模板名称'>
            <DataTableColumnFilter column={table.getColumn('status')} label='状态' options={CONFIG_TEMPLATE_STATUS_OPTIONS} />
            <DataTableColumnFilter column={table.getColumn('availability')} label='可用性' options={['可用', '不可用']} />
          </DataTableToolbar>

          {loading ? (
            <div className='text-muted-foreground flex items-center justify-center gap-2 py-16'><Loader2Icon className='size-4 animate-spin' />正在加载配置模板…</div>
          ) : error ? (
            <div className='text-destructive flex flex-col items-center gap-3 py-16 text-sm'>{error}<Button variant='outline' size='sm' onClick={() => void fetchItems()}>重试</Button></div>
          ) : (
            <DataTable table={table} emptyText='暂无可查看的配置模板版本' />
          )}

          <DataTablePagination table={table} />
        </CardContent>
      </Card>

      <ConfigTemplateSheet
        selected={selected}
        candidates={formCandidates}
        isAdmin={isAdmin}
        onClose={() => setSelected(null)}
        onChanged={() => void fetchItems()}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建配置模板</DialogTitle>
            <DialogDescription>创建后得到 v1 草稿，草稿可以不完整；通过全部发布校验后才能用于周期。</DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-4'>
            <Field className='gap-2'><FieldLabel>模板名称</FieldLabel><Input value={name} placeholder='如 标准半年度绩效配置' onChange={event => setName(event.target.value)} /></Field>
            <Field className='gap-2'><FieldLabel>模板说明</FieldLabel><Textarea value={description} placeholder='适用周期和规则说明（可选）' onChange={event => setDescription(event.target.value)} /></Field>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setCreateOpen(false)}>取消</Button>
            <Button disabled={creating} onClick={() => void handleCreate()}>{creating && <Loader2Icon className='animate-spin' />}创建草稿</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default ConfigTemplateManager
