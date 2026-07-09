// Next Imports
import Link from 'next/link'

// Component Imports
import { Button } from '@/components/ui/button'

// SVG Imports
import Icon404 from '@/assets/svg/404'

/**
 * 全局 404 页面。
 */
const NotFound = () => {
  return (
    <div className='flex h-screen w-screen flex-col items-center justify-center gap-9 p-6'>
      <Icon404 className='h-auto w-full sm:h-120 sm:w-146' />
      <div className='flex flex-col items-center gap-4 text-center'>
        <p className='text-muted-foreground text-xl sm:text-2xl'>抱歉，你访问的页面不存在</p>
        <Button className='rounded-full' render={<Link href='/workbench' />} nativeButton={false}>
          返回工作台
        </Button>
      </div>
    </div>
  )
}

export default NotFound
