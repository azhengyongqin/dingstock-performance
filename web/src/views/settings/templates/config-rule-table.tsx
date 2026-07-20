import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * 规则配置统一表格壳：表头与内容行共用同一 grid 模板，强制左对齐，避免表头/单元格错位。
 */
export const ConfigRuleSectionChrome = ({
  title,
  description,
  trailing
}: {
  title: string
  description: string
  trailing?: ReactNode
}) => (
  <div className='flex flex-wrap items-start justify-between gap-2'>
    <div>
      <h3 className='font-medium'>{title}</h3>
      <p className='text-muted-foreground text-sm'>{description}</p>
    </div>
    {trailing}
  </div>
)

const HEADER_ROW =
  'text-muted-foreground bg-muted/40 grid items-center gap-3 border-b px-3 py-2 text-left text-xs font-normal'

const BODY_ROW = 'grid items-center gap-3 px-3 py-2.5 text-left'

export const configRuleRowClassName = (gridClassName: string) => cn(BODY_ROW, gridClassName)

type ConfigRuleTableProps = {

  /** 与每一行完全相同的 grid-cols-*，保证表头与内容列对齐 */
  gridClassName: string
  headers: ReactNode[]
  children: ReactNode
}

export const ConfigRuleTable = ({ gridClassName, headers, children }: ConfigRuleTableProps) => (
  <div className='overflow-hidden rounded-lg border'>
    <div className={cn(HEADER_ROW, gridClassName)}>
      {headers.map((header, index) => (
        <div key={index} className='min-w-0 text-left'>
          {header}
        </div>
      ))}
    </div>
    <div className='divide-y'>{children}</div>
  </div>
)

/** 嵌套次要内容时用：外层负责纵向 padding，内层网格不再重复 py。 */
export const configRuleNestedRowClassName = (gridClassName: string) =>
  cn('grid items-center gap-3 text-left', gridClassName)
