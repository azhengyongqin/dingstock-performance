'use client'

// React Imports
import { useId } from 'react'
import type { ReactNode } from 'react'

// Third-party Imports
import type { Table as TanstackTable } from '@tanstack/react-table'

// Component Imports
import SearchInput, { SEARCH_INPUT_PINYIN_PLACEHOLDER } from '@/components/shared/SearchInput'
import { Label } from '@/components/ui/label'

export interface DataTableToolbarProps<TData> {
  table: TanstackTable<TData> // useReactTable 创建的表格实例

  /** 指定后启用列级搜索：绑定该列的 columnFilter */
  searchColumn?: string

  /** 启用全局搜索（globalFilter），与 searchColumn 二选一 */
  enableGlobalSearch?: boolean

  /** 搜索框占位文案 */
  searchPlaceholder?: string

  /** 右侧插槽：筛选下拉、列显隐、导出按钮等 */
  children?: ReactNode
}

/**
 * 通用工具栏（模板 users-list 惯用法）：左侧搜索框 + 右侧筛选/操作插槽。
 * 未指定 searchColumn / enableGlobalSearch 时不渲染搜索框，仅作为筛选布局容器。
 */
export function DataTableToolbar<TData>({
  table,
  searchColumn,
  enableGlobalSearch = false,
  searchPlaceholder = SEARCH_INPUT_PINYIN_PLACEHOLDER,
  children
}: DataTableToolbarProps<TData>) {
  const id = useId()
  const showSearch = Boolean(searchColumn) || enableGlobalSearch

  // 当前搜索关键字：列筛选优先，其次全局筛选
  const searchValue = searchColumn
    ? ((table.getColumn(searchColumn)?.getFilterValue() as string) ?? '')
    : ((table.getState().globalFilter as string) ?? '')

  // 同步搜索关键字到列筛选 / 全局筛选，并重置回第一页
  const handleSearch = (value: string) => {
    if (searchColumn) {
      table.getColumn(searchColumn)?.setFilterValue(value || undefined)
    } else {
      table.setGlobalFilter(value)
    }

    // 搜索后回到第一页，避免过滤结果落在空页
    table.setPageIndex(0)
  }

  return (
    <div className='flex flex-wrap items-center gap-3 pb-4 sm:justify-between'>
      {showSearch && (
        <div className='w-full max-w-sm'>
          <Label htmlFor={`${id}-search`} className='sr-only'>
            搜索
          </Label>
          <SearchInput
            id={`${id}-search`}
            value={searchValue}
            onChange={handleSearch}
            placeholder={searchPlaceholder}
          />
        </div>
      )}

      {children && <div className='ml-auto flex flex-wrap items-center gap-2'>{children}</div>}
    </div>
  )
}
