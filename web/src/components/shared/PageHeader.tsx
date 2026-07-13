import type { ReactNode } from 'react'

import Link from 'next/link'

import { ChevronLeftIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * 页面通用标题区：普通页面展示标题；子页面传入 backHref 后切换为固定的上下文页眉。
 */
const PageHeader = ({
  title,
  description,
  actions,
  backHref,
  backLabel = '返回上级页面'
}: {
  title: string
  description?: string
  actions?: ReactNode

  /** 子页面的确定性上级路由；传入后页眉固定在主滚动容器顶部。 */
  backHref?: string
  backLabel?: string
}) => {
  if (backHref) {
    return (
      <div className='bg-background sticky top-0 z-20 -mx-4 px-4 pt-4 pb-2 sm:-mx-6 sm:px-6'>
        {/* 页眉外壳从滚动容器顶部开始固定，内部保留与普通页面一致的 16px 顶部视觉留白。 */}
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div className='flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1'>
            <Button
              className='-ml-2 h-8 px-2 text-sm font-medium'
              variant='ghost'
              render={<Link href={backHref} />}
              nativeButton={false}
            >
              <ChevronLeftIcon className='size-4' />
              {backLabel}
            </Button>
            <span className='text-muted-foreground text-sm'>/</span>
            <h1 className='text-lg font-semibold'>{title}</h1>
          </div>
          {actions && <div className='flex items-center gap-2'>{actions}</div>}
        </div>
        {description && <p className='text-muted-foreground mt-1 text-sm'>{description}</p>}
      </div>
    )
  }

  return (
    <div className='mt-4 mb-6 flex flex-wrap items-start justify-between gap-4'>
      <div className='flex flex-col gap-1'>
        <h1 className='text-2xl font-semibold'>{title}</h1>
        {description && <p className='text-muted-foreground text-sm'>{description}</p>}
      </div>
      {actions && <div className='flex items-center gap-2'>{actions}</div>}
    </div>
  )
}

export default PageHeader
