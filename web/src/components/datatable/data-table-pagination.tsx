'use client'

// React Imports
import { useId } from 'react'

// Third-party Imports
import type { Table as TanstackTable } from '@tanstack/react-table'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'

// Component Imports
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem } from '@/components/ui/pagination'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// Hook Imports
import { usePagination } from '@/hooks/use-pagination'

export interface DataTablePaginationProps<TData> {
  table: TanstackTable<TData> // useReactTable 创建的表格实例（需启用 getPaginationRowModel）

  /** 传入选项即显示「每页条数」选择器（page-size-selector 变体） */
  pageSizeOptions?: number[]
}

/**
 * 通用分页组件（模板 Data Table 惯用法）：
 * 左侧展示条数信息（可选每页条数选择器），右侧为页码导航。
 */
export function DataTablePagination<TData>({ table, pageSizeOptions }: DataTablePaginationProps<TData>) {
  const id = useId()
  const { pageIndex, pageSize } = table.getState().pagination
  const totalRows = table.getRowCount()
  const from = totalRows === 0 ? 0 : pageIndex * pageSize + 1
  const to = Math.min((pageIndex + 1) * pageSize, totalRows)

  const { pages, showLeftEllipsis, showRightEllipsis } = usePagination({
    currentPage: pageIndex + 1,
    totalPages: Math.max(table.getPageCount(), 1),
    paginationItemsToDisplay: 3
  })

  return (
    <div className='flex flex-wrap items-center justify-between gap-3 pt-4 max-sm:flex-col'>
      <div className='flex items-center gap-4'>
        {pageSizeOptions && (
          <div className='flex items-center gap-2'>
            <Label htmlFor={`${id}-page-size`} className='text-muted-foreground text-sm font-normal whitespace-nowrap'>
              每页
            </Label>
            <Select
              items={pageSizeOptions.map(option => ({ label: String(option), value: String(option) }))}
              value={String(pageSize)}
              onValueChange={(value: string | null) => {
                if (value) {
                  table.setPageSize(Number(value))
                }
              }}
            >
              <SelectTrigger id={`${id}-page-size`} size='sm' className='w-fit whitespace-nowrap'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {pageSizeOptions.map(option => (
                    <SelectItem key={option} value={String(option)}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <span className='text-muted-foreground text-sm whitespace-nowrap'>条</span>
          </div>
        )}

        <p className='text-muted-foreground text-sm whitespace-nowrap' aria-live='polite'>
          第 <span>{from}</span> - <span>{to}</span> 条，共 <span>{totalRows}</span> 条
        </p>
      </div>

      <Pagination className='mx-0 w-fit'>
        <PaginationContent>
          <PaginationItem>
            <Button
              className='disabled:pointer-events-none disabled:opacity-50'
              variant='ghost'
              size='sm'
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label='上一页'
            >
              <ChevronLeftIcon aria-hidden='true' />
              <span className='max-sm:hidden'>上一页</span>
            </Button>
          </PaginationItem>

          {showLeftEllipsis && (
            <PaginationItem>
              <PaginationEllipsis />
            </PaginationItem>
          )}

          {pages.map(page => {
            const isActive = page === pageIndex + 1

            return (
              <PaginationItem key={page}>
                <Button
                  size='icon-sm'
                  className={`${!isActive && 'bg-primary/10 text-primary hover:bg-primary/20 focus-visible:ring-primary/20 dark:focus-visible:ring-primary/40'}`}
                  onClick={() => table.setPageIndex(page - 1)}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {page}
                </Button>
              </PaginationItem>
            )
          })}

          {showRightEllipsis && (
            <PaginationItem>
              <PaginationEllipsis />
            </PaginationItem>
          )}

          <PaginationItem>
            <Button
              className='disabled:pointer-events-none disabled:opacity-50'
              variant='ghost'
              size='sm'
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label='下一页'
            >
              <span className='max-sm:hidden'>下一页</span>
              <ChevronRightIcon aria-hidden='true' />
            </Button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  )
}
