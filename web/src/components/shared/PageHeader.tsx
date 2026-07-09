import type { ReactNode } from 'react'

/**
 * 页面通用标题区：中文标题 + 说明文案 + 右侧操作区。
 */
const PageHeader = ({
  title,
  description,
  actions
}: {
  title: string
  description?: string
  actions?: ReactNode
}) => {
  return (
    <div className='mb-6 flex flex-wrap items-start justify-between gap-4'>
      <div className='flex flex-col gap-1'>
        <h1 className='text-2xl font-semibold'>{title}</h1>
        {description && <p className='text-muted-foreground text-sm'>{description}</p>}
      </div>
      {actions && <div className='flex items-center gap-2'>{actions}</div>}
    </div>
  )
}

export default PageHeader
