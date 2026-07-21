// Config Imports
import themeConfig from '@/configs/themeConfig'

// Util Imports
import { cn } from '@/lib/utils'

/** 系统品牌 logo（public/branding） */
export const BRAND_LOGO_SRC = '/branding/dingstock-logo.png'

/** 飞书登录按钮 logo（public/branding） */
export const LARK_LOGIN_LOGO_SRC = '/branding/lark-logo.png'

const Logo = ({ className }: { className?: string }) => {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <img src={BRAND_LOGO_SRC} alt={themeConfig.templateName} className='size-8.5 rounded-md' />
      <span className='text-xl font-bold'>{themeConfig.templateName}</span>
    </div>
  )
}

export default Logo
