'use client'

// Third-party Imports
import type { RowData, Table as TanstackTable } from '@tanstack/react-table'
import { flexRender } from '@tanstack/react-table'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'

// Component Imports
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

// Util Imports
import { cn } from '@/lib/utils'

// 扩展 TanStack Table 的列 meta：允许列定义声明表头/单元格附加类名（如右对齐、定宽）
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    headClassName?: string // 表头单元格附加类名

    /** 数据单元格附加类名 */
    cellClassName?: string
  }
}

export interface DataTableProps<TData> {
  table: TanstackTable<TData> // useReactTable 创建的表格实例（分页/筛选/列显隐等变体由业务页配置）

  /** 无数据时的提示文案 */
  emptyText?: string
}

/**
 * 通用 Data Table 渲染组件（模板 Data Table 惯用法）：
 * 只负责按表格实例渲染表头与表体（含排序指示、行选中态、空态），
 * 分页、工具栏、列显隐等由 datatable 目录下的配套组件组合实现。
 */
export function DataTable<TData>({ table, emptyText = '暂无数据' }: DataTableProps<TData>) {
  const columnCount = table.getAllColumns().length

  return (
    <div className='overflow-x-auto'>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map(headerGroup => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <TableHead
                  key={header.id}
                  style={{ width: header.getSize() !== 150 ? `${header.getSize()}px` : undefined }}
                  className={cn('text-muted-foreground', header.column.columnDef.meta?.headClassName)}
                >
                  {header.isPlaceholder ? null : header.column.getCanSort() ? (
                    <div
                      className='flex h-full cursor-pointer items-center gap-2 select-none'
                      onClick={header.column.getToggleSortingHandler()}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          header.column.getToggleSortingHandler()?.(event)
                        }
                      }}
                      tabIndex={0}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {{
                        asc: <ChevronUpIcon className='size-4 shrink-0 opacity-60' aria-hidden='true' />,
                        desc: <ChevronDownIcon className='size-4 shrink-0 opacity-60' aria-hidden='true' />
                      }[header.column.getIsSorted() as string] ?? null}
                    </div>
                  ) : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map(row => (
              <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                {row.getVisibleCells().map(cell => (
                  <TableCell key={cell.id} className={cell.column.columnDef.meta?.cellClassName}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columnCount} className='text-muted-foreground h-24 text-center'>
                {emptyText}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
