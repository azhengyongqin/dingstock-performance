'use client'

// React Imports
import { useEffect } from 'react'

// Next Imports
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

// Third-party Imports
import { CircleAlertIcon, LoaderCircleIcon } from 'lucide-react'

// Component Imports
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

// Util Imports
import { saveAuth } from '@/lib/api'

/**
 * 飞书 OAuth 回调落地页。
 * 后端处理完授权码后 302 跳转到此：/auth/callback?token=<jwt>&name=<姓名>&avatar=<头像>。
 * 这里把 token 与用户信息写入 localStorage，然后跳转工作台。
 */
const AuthCallback = () => {
  const router = useRouter()
  const searchParams = useSearchParams()

  // 直接从 URL 派生错误态：无 token 即为失败，无需额外 state
  const token = searchParams.get('token')
  const failed = !token

  useEffect(() => {
    if (!token) return

    // 保存登录态：token + 用户基本信息
    saveAuth(token, {
      name: searchParams.get('name') ?? '飞书用户',
      avatar: searchParams.get('avatar') ?? undefined,
      openId: searchParams.get('open_id') ?? undefined
    })

    // 登录完成，进入工作台（replace 避免回退到回调页）
    router.replace('/workbench')
  }, [router, searchParams, token])

  return (
    <div className='flex min-h-screen items-center justify-center px-4'>
      <Card className='w-full sm:max-w-md'>
        <CardContent className='flex flex-col items-center gap-4 py-10 text-center'>
          {failed ? (
            <>
              <CircleAlertIcon className='text-destructive size-10' />
              <p className='text-lg font-medium'>登录失败</p>
              <p className='text-muted-foreground text-sm'>未获取到登录凭证（token），授权可能已过期或被取消。</p>
              <Button render={<Link href='/auth/login' />} nativeButton={false}>
                返回登录
              </Button>
            </>
          ) : (
            <>
              <LoaderCircleIcon className='text-primary size-10 animate-spin' />
              <p className='text-lg font-medium'>正在完成登录…</p>
              <p className='text-muted-foreground text-sm'>校验飞书授权信息并保存登录状态</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default AuthCallback
