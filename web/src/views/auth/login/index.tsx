'use client'

// React Imports
import { useState } from 'react'

// Third-party Imports
import { LoaderCircleIcon } from 'lucide-react'

// Component Imports
import Logo from '@/components/shared/Logo'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// SVG Imports
import AuthBackgroundShape from '@/assets/svg/auth-background-shape'

// Util Imports
import { apiFetch } from '@/lib/api'

/**
 * 登录页：仅提供「使用飞书登录」入口（无账号密码表单）。
 * 流程：请求后端 /auth/lark/authorize-url → 跳转飞书授权页 →
 * 后端回调处理后 302 回前端 /auth/callback?token=...
 */
const Login = () => {
  // 跳转中状态（防止重复点击）
  const [loading, setLoading] = useState(false)

  // 请求授权地址失败时的错误提示
  const [error, setError] = useState<string | null>(null)

  const handleLarkLogin = async () => {
    setLoading(true)
    setError(null)

    try {
      // 后端返回 { url: 飞书授权页地址（带 state）, state: 随机串 }
      const { url } = await apiFetch<{ url: string; state: string }>('/auth/lark/authorize-url')

      window.location.href = url
    } catch {
      setError('获取飞书授权地址失败，请确认后端服务（默认 http://localhost:3000）已启动后重试。')
      setLoading(false)
    }
  }

  return (
    <div className='relative flex h-auto min-h-screen items-center justify-center overflow-x-hidden px-4 py-10 sm:px-6 lg:px-8'>
      {/* 背景装饰图形（沿用模板 login-v1 视觉） */}
      <div className='absolute'>
        <AuthBackgroundShape />
      </div>

      <Card className='z-1 w-full gap-6 py-6 sm:max-w-lg'>
        <CardHeader className='gap-6 px-6'>
          <Logo className='gap-3' />

          <div>
            <CardTitle className='mb-2 text-2xl font-semibold'>登录盯潮绩效</CardTitle>
            <CardDescription className='text-base'>基于飞书生态的员工绩效系统</CardDescription>
          </div>
        </CardHeader>

        <CardContent className='flex flex-col gap-4 px-6'>
          <p className='text-muted-foreground text-base'>使用企业飞书账号一键登录，无需注册。</p>

          {/* 飞书 OAuth 登录按钮 */}
          <Button className='w-full' size='lg' onClick={handleLarkLogin} disabled={loading}>
            {loading && <LoaderCircleIcon className='animate-spin' />}
            {loading ? '正在跳转飞书授权…' : '使用飞书登录'}
          </Button>

          {error && <p className='text-destructive text-sm'>{error}</p>}

          <p className='text-muted-foreground text-center text-sm'>登录即表示同意公司绩效管理相关制度与数据使用规范</p>
        </CardContent>
      </Card>
    </div>
  )
}

export default Login
