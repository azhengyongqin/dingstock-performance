'use client'

// React Imports
import { Suspense } from 'react'
import type { ReactNode } from 'react'

// Component Imports
import Footer from '@/components/layout/Footer'
import Header from '@/components/layout/Header'
import Sidebar from '@/components/layout/Sidebar'
import { SidebarInset } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'

// Context Imports
import { AuthProvider } from '@/contexts/authContext'

// Hook Imports
import { useSettings } from '@/hooks/use-settings'

// Util Imports
import { cn } from '@/lib/utils'

const PagesLayout = ({ children }: Readonly<{ children: ReactNode }>) => {
  const { settings } = useSettings()

  return (

    // 登录守卫 + 角色上下文：未登录跳转登录页，菜单/路由按角色过滤
    <AuthProvider>
      <div className='flex h-dvh w-full min-w-0 overflow-hidden'>
        <Suspense>
          <Sidebar />
        </Suspense>
        <SidebarInset className='flex min-h-0 flex-1 flex-col overflow-hidden'>
          <Header />
          <main
            className={cn(
              'mx-auto min-h-0 w-full flex-1 overflow-y-auto px-4 py-6 sm:px-6',
              settings.layout === 'compact' ? 'mx-auto max-w-360' : 'w-full'
            )}
          >
            {children}
          </main>
          <Toaster />
          <Footer />
        </SidebarInset>
      </div>
    </AuthProvider>
  )
}

export default PagesLayout
