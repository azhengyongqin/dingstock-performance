'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

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

import { useAuth } from '@/contexts/authContext'
import { ApiError } from '@/lib/api'
import type { PerfFormTemplateVersionSummary, PerfJobLevelPrefix } from '@/lib/perf-api'
import { createPerfFormTemplate, listPerfFormTemplates } from '@/lib/perf-api'

import { DataTable, DataTableColumnFilter, DataTablePagination, DataTableToolbar } from '@/components/datatable'
import PageHeader from '@/components/shared/PageHeader'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

import FormTemplateSheet from './form-template-sheet'
import {
  FORM_TEMPLATE_STATUS_OPTIONS,
  JOB_LEVEL_PREFIX_LABEL,
  JOB_LEVEL_PREFIX_OPTIONS
} from './form-template-constants'
import { buildFormTemplateTableColumns } from './form-template-table-columns'

/** 版本化评估表单模板列表：filters DataTable + Admin 生命周期操作 + HR 已发布版本只读。 */
const FormTemplateManager = () => {
  const { roles } = useAuth()
  const isAdmin = roles.includes('ADMIN')

  const [items, setItems] = useState<PerfFormTemplateVersionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<PerfFormTemplateVersionSummary | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [jobLevelPrefix, setJobLevelPrefix] = useState<PerfJobLevelPrefix>('D')

  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })

  const fetchItems = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await listPerfFormTemplates()

      setItems(response.items ?? [])
    } catch (requestError) {
      setError(
        requestError instanceof ApiError && requestError.status === 403
          ? '需要 HR 或超级管理员权限'
          : requestError instanceof Error
            ? requestError.message
            : '无法加载评估表单模板'
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const initialLoad = setTimeout(() => void fetchItems(), 0)

    return () => clearTimeout(initialLoad)
  }, [fetchItems])

  const columns = useMemo(() => buildFormTemplateTableColumns({ onOpen: setSelected, isAdmin }), [isAdmin])

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
      const created = await createPerfFormTemplate({
        name: name.trim(),
        description: description.trim() || undefined,
        jobLevelPrefix
      })

      toast.success('评估表单模板草稿已创建')
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
        title='评估表单模板'
        description={
          isAdmin
            ? '按职级前缀维护员工自评、360°评估、上级评估和晋升评估，并发布不可变版本'
            : '查看可用于配置模板的已发布评估表单版本（只读）'
        }
        actions={
          isAdmin ? (
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon />
              新建模板
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent>
          <DataTableToolbar table={table} searchColumn='name' searchPlaceholder='搜索模板名称'>
            <DataTableColumnFilter
              column={table.getColumn('jobLevelPrefix')}
              label='职级前缀'
              options={JOB_LEVEL_PREFIX_OPTIONS}
            />
            {isAdmin && (
              <DataTableColumnFilter
                column={table.getColumn('status')}
                label='状态'
                options={FORM_TEMPLATE_STATUS_OPTIONS}
              />
            )}
          </DataTableToolbar>

          {loading ? (
            <div className='text-muted-foreground flex items-center justify-center gap-2 py-16'>
              <Loader2Icon className='size-4 animate-spin' />
              正在加载评估表单模板…
            </div>
          ) : error ? (
            <div className='text-destructive flex flex-col items-center gap-3 py-16 text-sm'>
              {error}
              <Button variant='outline' size='sm' onClick={() => void fetchItems()}>
                重试
              </Button>
            </div>
          ) : (
            <DataTable table={table} emptyText='暂无可查看的评估表单模板版本' />
          )}

          <DataTablePagination table={table} />
        </CardContent>
      </Card>

      <FormTemplateSheet
        selected={selected}
        isAdmin={isAdmin}
        onClose={() => setSelected(null)}
        onChanged={() => void fetchItems()}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建评估表单模板</DialogTitle>
            <DialogDescription>创建后得到 v1 草稿，完善四类子表单并通过校验后才能发布。</DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-4'>
            <Field className='gap-2'>
              <FieldLabel>模板名称</FieldLabel>
              <Input
                value={name}
                placeholder='如 D 普通岗标准评估表单'
                onChange={event => setName(event.target.value)}
              />
            </Field>
            <Field className='gap-2'>
              <FieldLabel>职级前缀</FieldLabel>
              <Select
                value={jobLevelPrefix}
                items={Object.entries(JOB_LEVEL_PREFIX_LABEL).map(([value, label]) => ({ value, label }))}
                onValueChange={value => setJobLevelPrefix(value as PerfJobLevelPrefix)}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(JOB_LEVEL_PREFIX_LABEL) as [PerfJobLevelPrefix, string][]).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field className='gap-2'>
              <FieldLabel>模板说明</FieldLabel>
              <Textarea
                value={description}
                placeholder='说明适用范围和设计目标（可选）'
                onChange={event => setDescription(event.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button disabled={creating} onClick={() => void handleCreate()}>
              {creating && <Loader2Icon className='animate-spin' />}
              创建草稿
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default FormTemplateManager
