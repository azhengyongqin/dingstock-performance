// React Imports
import type { ReactNode } from 'react'

// Component Imports
import { Card, CardContent } from '@/components/ui/card'

// Util Imports
import { cn } from '@/lib/utils'

export type StatCardItem = {
  label: string
  value: ReactNode
  description?: ReactNode
  icon?: ReactNode
  iconClassName?: string
}

/**
 * 业务通用统计卡片行：模板 apps/users/list/user-stats-cards.tsx 的布局提取，
 * 替代各页面手写的 Card + text-2xl 统计块。
 */
export function StatsCards({ items, className }: { items: StatCardItem[]; className?: string }) {
  return (
    <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2 lg:gap-6 xl:grid-cols-4', className)}>
      {items.map(item => (
        <Card key={item.label}>
          <CardContent className='flex flex-row items-start justify-between'>
            <div className='space-y-1'>
              <p className='text-muted-foreground text-sm font-medium'>{item.label}</p>
              <h4 className='text-2xl font-medium'>{item.value}</h4>
              {item.description && <p className='text-muted-foreground text-xs'>{item.description}</p>}
            </div>
            {item.icon && (
              <div
                className={cn(
                  'flex size-9.5 items-center justify-center rounded-md',
                  item.iconClassName ?? 'bg-primary/10 text-primary'
                )}
              >
                {item.icon}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
