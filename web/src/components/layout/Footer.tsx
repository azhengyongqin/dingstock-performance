// Hook Imports
import { useSettings } from '@/hooks/use-settings'

// Config Imports
import themeConfig from '@/configs/themeConfig'

// Util Imports
import { cn } from '@/lib/utils'

/**
 * 页脚：版权信息。
 */
const Footer = () => {
  const { settings } = useSettings()

  return (
    <footer className='shrink-0'>
      <div
        className={cn(
          'text-muted-foreground mx-auto flex size-full items-center justify-between gap-3 px-4 py-3 max-sm:flex-col sm:gap-6 sm:px-6',
          settings.layout === 'compact' ? 'max-w-360' : 'w-full'
        )}
      >
        <p className='text-sm text-balance max-sm:text-center'>
          {`©${new Date().getFullYear()} ${themeConfig.templateName} · 员工绩效系统`}
        </p>
        <p className='text-sm max-sm:hidden'>基于飞书生态的绩效管理平台</p>
      </div>
    </footer>
  )
}

export default Footer
