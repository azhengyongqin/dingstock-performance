'use client'

// Third-party Imports
import type { Table as TanstackTable } from '@tanstack/react-table'
import { Columns3Icon, RefreshCcwIcon } from 'lucide-react'

// Component Imports
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

export interface DataTableViewOptionsProps<TData> {
  table: TanstackTable<TData> // useReactTable 创建的表格实例（需管理 columnVisibility 状态）
}

// 取列的展示名：优先字符串表头，兜底列 id
const getColumnLabel = (column: { id: string; columnDef: { header?: unknown } }) =>
  typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id

/**
 * 列显隐下拉（模板 column-visibility 变体惯用法）：
 * 勾选控制各列显示/隐藏，底部提供一键重置。
 */
export function DataTableViewOptions<TData>({ table }: DataTableViewOptionsProps<TData>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant='outline' />}>
        <Columns3Icon />
        列显示
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-44'>
        {/* Base UI 约束：GroupLabel（DropdownMenuLabel）必须位于 DropdownMenuGroup 内 */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>切换列显示</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {table
            .getAllColumns()
            .filter(column => column.getCanHide())
            .map(column => (
              <DropdownMenuCheckboxItem
                key={column.id}
                checked={column.getIsVisible()}
                onCheckedChange={value => column.toggleVisibility(!!value)}
                closeOnClick={false}
              >
                {getColumnLabel(column)}
              </DropdownMenuCheckboxItem>
            ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => table.resetColumnVisibility()}>
          <RefreshCcwIcon className='size-4' />
          重置
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
