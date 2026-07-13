import type { ReactNode } from 'react'

import Link from 'next/link'

import { ArrowLeftIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * 页面通用标题区：中文标题 + 说明文案 + 右侧操作区。
 */
const PageHeader = ({
  title,
  description,
  actions,
  backHref,
  backLabel = '返回'
}: {
  title: string
  description?: string
  actions?: ReactNode

  /** 表单型创建/编辑页使用固定目标返回，避免浏览器历史为空时无法离开页面。 */
  backHref?: string
  backLabel?: string
}) => {
  return (
    <div className='mb-6 flex flex-wrap items-start justify-between gap-4'>
      <div className='flex flex-col gap-1'>
        <h1 className='text-2xl font-semibold'>{title}</h1>
        {description && <p className='text-muted-foreground text-sm'>{description}</p>}
      </div>
      {(backHref || actions) && (
        <div className='flex items-center gap-2'>
          {backHref && (
            <Button variant='outline' render={<Link href={backHref} />} nativeButton={false}>
              <ArrowLeftIcon />
              {backLabel}
            </Button>
          )}
          {actions}
        </div>
      )}
    </div>
  )
}

export default PageHeader
