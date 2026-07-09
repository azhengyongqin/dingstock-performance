'use client'

// Third-party Imports
import { BellIcon } from 'lucide-react'

// Component Imports
import ModeToggle from '@/components/layout/ModeToggle'
import NotificationDropdown from '@/components/shared/NotificationDropdown'
import ProfileDropdown from '@/components/shared/ProfileDropdown'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import CommandMenu from './CommandMenu'
import ThemeCustomizer from './ThemeCustomizer'

// Hook Imports
import { useSettings } from '@/hooks/use-settings'

// Util Imports
import { cn } from '@/lib/utils'

/**
 * 顶部导航栏：侧边栏开关 + 全局搜索 + 通知 + 主题切换 + 个人菜单。
 */
const Header = () => {
  const { settings, updateSettings } = useSettings()
  const { open, isMobile } = useSidebar()

  return (
    <header className='sticky top-0 z-50 shrink-0 px-4 before:absolute before:inset-0 before:rounded-t-xl before:mask-[linear-gradient(var(--card),var(--card)_18%,transparent_100%)] before:backdrop-blur-md sm:px-6'>
      <div
        className={cn(
          'bg-card relative z-51 mx-auto mt-3 flex w-full items-center justify-between rounded-xl border px-6 py-2',
          settings.layout === 'compact' ? 'max-w-348' : 'w-full'
        )}
      >
        <div className='flex items-center gap-1.5 sm:gap-4'>
          <SidebarTrigger
            className='[&_svg]:size-5!'
            onClick={() => {
              // 移动端时触发器只负责开关抽屉式侧边栏
              if (!isMobile) updateSettings({ sidebarOpen: !open })
            }}
          />
          <Separator orientation='vertical' className='hidden h-4! self-center! sm:block' />
          <CommandMenu />
        </div>
        <div className='flex items-center gap-1.5'>
          <NotificationDropdown
            trigger={
              <Button variant='ghost' size='icon' className='relative'>
                <BellIcon />
                <span className='bg-destructive absolute top-2 right-2.5 size-2 rounded-full' />
              </Button>
            }
          />
          <ModeToggle />
          <ThemeCustomizer />
          <ProfileDropdown />
        </div>
      </div>
    </header>
  )
}

export default Header
