// React Imports
import type { ReactNode } from 'react'

// Next Imports
import { cookies } from 'next/headers'
import type { Metadata } from 'next'

// Third-party Imports
import { NuqsAdapter } from 'nuqs/adapters/next/app'

// Type Imports
import type { Settings } from '@/contexts/settingsContext'

// Component Imports
import Providers from '@/components/Providers'
import { TooltipProvider } from '@/components/ui/tooltip'

// Util Imports
import { cn } from '@/lib/utils'

// Config Imports
import themeConfig from '@/configs/themeConfig'

// Font Imports
import { allFonts } from '@/utils/fonts'

// Style Imports
import 'katex/dist/katex.min.css'
import './globals.css'
import ScrollToTop from '@/components/layout/ScrollToTop'

export const metadata: Metadata = {
  title: '盯潮-绩效 · 员工绩效系统',
  description: '基于飞书生态的员工绩效系统：绩效周期管理、360°评估、绩效校准、数据看板。'
}

const RootLayout = async ({ children }: Readonly<{ children: ReactNode }>) => {
  // 读取主题设置 cookie（用于服务端渲染时保持主题一致）
  const cookieStore = await cookies()
  const settingsCookie = cookieStore.get(themeConfig.settingsCookieName)

  let settingsData: Settings | undefined

  if (settingsCookie) {
    try {
      settingsData = JSON.parse(settingsCookie.value) as Settings
    } catch (error) {
      console.error('解析主题设置 cookie 失败：', error)
    }
  }

  // 主题模式：cookie 优先，否则用 themeConfig 默认值
  const mode = settingsData?.mode ?? themeConfig.mode

  // 侧边栏展开状态：cookie 优先
  const sidebarOpen = settingsData?.sidebarOpen ?? themeConfig.sidebarOpen

  const defaultOpen = sidebarOpen

  return (
    <html
      lang='zh-CN'
      className={cn(...allFonts.map(f => f.variable), 'flex min-h-full w-full antialiased', mode)}
      data-scroll-behavior='smooth'
      suppressHydrationWarning
    >
      <body className='flex min-h-full w-full flex-auto flex-col'>
        <NuqsAdapter>
          <Providers settingsCookie={settingsData} sidebarDefaultOpen={defaultOpen}>
            <TooltipProvider>{children}</TooltipProvider>
          </Providers>
        </NuqsAdapter>

        <ScrollToTop />
      </body>
    </html>
  )
}

export default RootLayout
