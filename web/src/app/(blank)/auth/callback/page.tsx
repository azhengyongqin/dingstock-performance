// React Imports
import { Suspense } from 'react'

// View Imports
import AuthCallback from '@/views/auth/callback'

export const metadata = {
  title: '登录处理中 - 盯潮绩效'
}

// 飞书 OAuth 回调页薄壳：useSearchParams 需要 Suspense 边界
const AuthCallbackPage = () => {
  return (
    <Suspense>
      <AuthCallback />
    </Suspense>
  )
}

export default AuthCallbackPage
