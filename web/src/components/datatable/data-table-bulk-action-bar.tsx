'use client'

// React Imports
import type { ReactNode } from 'react'

// Third-party Imports
import { XIcon } from 'lucide-react'

// Component Imports
import { Button } from '@/components/ui/button'

export interface DataTableBulkActionBarProps {
  selectedCount: number // 已选行数（为 0 时不渲染）

  /** 清除选择回调 */
  onClearSelection: () => void

  /** 批量操作按钮插槽 */
  children?: ReactNode
}

/**
 * 批量操作条（模板 user-bulk-action-bar 惯用法）：
 * 勾选行后出现，展示已选数量与批量操作入口。
 */
export function DataTableBulkActionBar({ selectedCount, onClearSelection, children }: DataTableBulkActionBarProps) {
  if (selectedCount === 0) return null

  return (
    <div className='bg-muted/50 flex flex-wrap items-center gap-3 rounded-md border px-4 py-2'>
      <span className='text-sm font-medium'>已选 {selectedCount} 项</span>

      {children}

      <Button variant='ghost' size='sm' onClick={onClearSelection}>
        <XIcon />
        清除选择
      </Button>
    </div>
  )
}
