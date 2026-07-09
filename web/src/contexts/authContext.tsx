'use client'

// React Imports
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

// Next Imports
import { usePathname, useRouter } from 'next/navigation'

// Third-party Imports
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

// Util Imports
import { ApiError, apiFetch, clearAuth, getToken } from '@/lib/api'
import type { PerfRole } from '@/lib/perf-api'

/** 前端菜单/路由使用的角色：显式授权（HR/ADMIN）+ 派生角色（LEADER） */
export type NavRole = 'HR' | 'ADMIN' | 'LEADER'

type AuthState = {

  /** loading = 正在校验登录态/拉取角色；ready = 可渲染受保护内容 */
  status: 'loading' | 'ready'

  /** 显式授权角色（来自 role_grants + 租户管理员兜底） */
  roles: PerfRole[]

  /** 派生 Leader（有直属下属或任一周期的 Leader 快照命中） */
  isLeader: boolean

  /** 菜单/路由可见性判断：未声明 roles 的项对所有登录用户可见 */
  hasAccess: (required?: NavRole[]) => boolean
}

const AuthContext = createContext<AuthState | null>(null)

/**
 * 路由级权限规则（前缀匹配，声明式集中管理）。
 * 未命中的路由 = 所有登录用户可访问；后端接口仍是最终防线。
 */
const ROUTE_ROLES: { prefix: string; roles: NavRole[] }[] = [
  { prefix: '/cycles', roles: ['HR', 'ADMIN'] },
  { prefix: '/calibrations', roles: ['HR', 'ADMIN'] },
  { prefix: '/dashboard', roles: ['HR', 'ADMIN'] },
  { prefix: '/reports', roles: ['HR', 'ADMIN'] },
  { prefix: '/appeals', roles: ['HR', 'ADMIN'] },
  { prefix: '/audit-logs', roles: ['HR', 'ADMIN'] },
  { prefix: '/settings', roles: ['HR', 'ADMIN'] },
  { prefix: '/team-review', roles: ['LEADER', 'HR', 'ADMIN'] }
]

export const useAuth = (): AuthState => {
  const context = useContext(AuthContext)

  if (!context) throw new Error('useAuth 必须在 AuthProvider 内使用')

  return context
}

/**
 * 认证与权限上下文（挂在 (pages) 布局最外层）：
 * 1. 无 token → 跳转登录页；token 失效（/role-grants/me 返回 401）→ 清空并跳转登录页；
 * 2. 拉取当前用户角色（HR/ADMIN 显式 + LEADER 派生），供菜单过滤与路由拦截使用；
 * 3. 按 ROUTE_ROLES 做路由级拦截，无权访问重定向回工作台。
 */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const router = useRouter()
  const pathname = usePathname()

  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [roles, setRoles] = useState<PerfRole[]>([])
  const [isLeader, setIsLeader] = useState(false)

  useEffect(() => {
    // 延迟到宏任务，避免在 effect 内同步 setState 触发级联渲染
    const initialLoad = setTimeout(async () => {
      // 1. 登录态校验：无 token 直接去登录页
      if (!getToken()) {
        router.replace('/auth/login')

        return
      }

      // 2. 拉取角色；401 = token 过期/无效 → 清空并回登录页
      try {
        const data = await apiFetch<{ roles: PerfRole[]; isLeader: boolean }>('/role-grants/me')

        setRoles(data.roles ?? [])
        setIsLeader(Boolean(data.isLeader))
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearAuth()
          router.replace('/auth/login')

          return
        }

        // 其它错误（如后端未启动）降级为普通员工视角，页面内各自处理错误态
        setRoles([])
        setIsLeader(false)
      }

      setStatus('ready')
    }, 0)

    return () => clearTimeout(initialLoad)
  }, [router])

  const hasAccess = useCallback(
    (required?: NavRole[]) => {
      if (!required || required.length === 0) return true
      if (roles.includes('ADMIN')) return true

      return required.some(role => (role === 'LEADER' ? isLeader : roles.includes(role)))
    },
    [roles, isLeader]
  )

  // 3. 路由级拦截：ready 后按前缀规则校验当前路径
  useEffect(() => {
    if (status !== 'ready') return
    const rule = ROUTE_ROLES.find(item => pathname.startsWith(item.prefix))

    if (rule && !hasAccess(rule.roles)) {
      toast.error('你没有访问该页面的权限')
      router.replace('/workbench')
    }
  }, [status, pathname, hasAccess, router])

  const value = useMemo<AuthState>(
    () => ({ status, roles, isLeader, hasAccess }),
    [status, roles, isLeader, hasAccess]
  )

  // 校验完成前不渲染受保护内容，避免未登录内容闪现
  if (status !== 'ready') {
    return (
      <div className='text-muted-foreground flex h-dvh items-center justify-center gap-2'>
        <Loader2Icon className='size-4 animate-spin' />
        正在校验登录状态…
      </div>
    )
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
