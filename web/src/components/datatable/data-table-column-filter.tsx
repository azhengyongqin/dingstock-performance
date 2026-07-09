'use client'

// React Imports
import { useId } from 'react'

// Third-party Imports
import type { Column } from '@tanstack/react-table'

// Component Imports
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// Util Imports
import { cn } from '@/lib/utils'

export interface DataTableColumnFilterProps<TData> {
  column: Column<TData, unknown> | undefined // 需要筛选的列（列定义需配置 filterFn: 'equalsString'）

  /** 筛选器名称（用于「全部xx」占位与无障碍标签） */
  label: string

  /** 候选值列表（显式传入以保证业务语义顺序） */
  options: string[]

  /** 触发器附加类名 */
  className?: string
}

/**
 * 通用列筛选下拉（模板 filters 变体惯用法）：
 * 选择「全部」时清除该列筛选，否则按 equalsString 精确匹配。
 */
export function DataTableColumnFilter<TData>({ column, label, options, className }: DataTableColumnFilterProps<TData>) {
  const id = useId()

  if (!column) return null

  const filterValue = column.getFilterValue()

  return (
    <div className='flex items-center gap-2'>
      <Label htmlFor={`${id}-filter`} className='sr-only'>
        {label}
      </Label>
      <Select
        items={[{ label: `全部${label}`, value: 'all' }, ...options.map(option => ({ label: option, value: option }))]}
        value={filterValue?.toString() ?? 'all'}
        onValueChange={(value: string | null) => {
          column.setFilterValue(value === 'all' || value === null ? undefined : value)
        }}
      >
        <SelectTrigger id={`${id}-filter`} className={cn('w-fit whitespace-nowrap', className)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value='all'>全部{label}</SelectItem>
            {options.map(option => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}
