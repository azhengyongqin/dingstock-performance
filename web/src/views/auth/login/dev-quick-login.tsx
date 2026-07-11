'use client'

// React Imports
import { useEffect, useState } from 'react'

// Next Imports
import { useRouter } from 'next/navigation'

// Third-party Imports
import { LoaderCircleIcon, TriangleAlertIcon } from 'lucide-react'

// Component Imports
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'

// Util Imports
import { devLogin, fetchDevLoginUsers, saveAuth, type DevLoginUser } from '@/lib/api'

/** 角色码 → 中文徽标文案（仅展示 HR/ADMIN；其余角色由任务关系派生，不在此列） */
const ROLE_LABEL: Record<string, string> = {
  HR: 'HR',
  ADMIN: '管理员'
}

/** 单个员工的角色徽标：显式角色 + 派生 Leader */
const RoleBadges = ({ user }: { user: DevLoginUser }) => {
  const roleBadges = user.roles.filter(role => ROLE_LABEL[role]).map(role => ROLE_LABEL[role])

  if (user.is_leader) roleBadges.push('主管')

  if (roleBadges.length === 0) return <Badge variant='outline'>普通员工</Badge>

  return (
    <>
      {roleBadges.map(label => (
        <Badge key={label} variant='secondary'>
          {label}
        </Badge>
      ))}
    </>
  )
}

/**
 * 开发环境「快速选择员工登录」：
 * 免飞书 OAuth，直接选一个已同步员工换取会话 JWT，方便快速切换角色测试。
 * 仅在 dev 构建下由登录页引入渲染；生产后端接口返回 404、前端也不渲染本组件。
 */
const DevQuickLogin = () => {
  const router = useRouter()

  const [users, setUsers] = useState<DevLoginUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 正在登录的员工 open_id（禁用重复点击并显示 loading）
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    fetchDevLoginUsers()
      .then(data => {
        if (active) setUsers(data.items)
      })
      .catch(() => {
        if (active) setError('拉取员工列表失败：请确认后端已启动，且已用 HR 账号触发过组织架构同步。')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const handlePick = async (user: DevLoginUser) => {
    if (pendingOpenId) return
    setPendingOpenId(user.open_id)
    setError(null)

    try {
      const { token } = await devLogin(user.open_id)

      // 与飞书 OAuth 回调一致：写入 token + 用户基本信息，再进工作台
      saveAuth(token, { name: user.name, avatar: user.avatar_url, openId: user.open_id })
      router.replace('/workbench')
    } catch {
      setError(`以「${user.name}」登录失败，请重试。`)
      setPendingOpenId(null)
    }
  }

  return (
    <div className='border-border/60 rounded-lg border border-dashed p-4'>
      <div className='mb-3 flex items-center gap-2'>
        <Badge variant='outline' className='border-amber-500/50 text-amber-600 dark:text-amber-400'>
          DEV
        </Badge>
        <span className='text-sm font-medium'>快速选择员工登录</span>
        <span className='text-muted-foreground text-xs'>仅开发环境</span>
      </div>

      {/* 保留 cmdk 内置过滤：每个 CommandItem 的 value 用「姓名+英文名+open_id」以支持搜索 */}
      <Command className='border-border/60 bg-transparent'>
        <CommandInput placeholder='搜索姓名 / 英文名…' />
        <CommandList>
          {loading ? (
            <div className='text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm'>
              <LoaderCircleIcon className='size-4 animate-spin' />
              正在加载员工列表…
            </div>
          ) : (
            <>
              <CommandEmpty>未找到匹配的员工</CommandEmpty>
              {users.map(user => (
                <CommandItem
                  key={user.open_id}
                  value={`${user.name} ${user.en_name ?? ''} ${user.open_id}`}
                  onSelect={() => handlePick(user)}
                  disabled={Boolean(pendingOpenId)}
                  className='gap-3'
                >
                  <Avatar className='size-8'>
                    {user.avatar_url && <AvatarImage src={user.avatar_url} alt={user.name} />}
                    <AvatarFallback>{user.name.slice(0, 1)}</AvatarFallback>
                  </Avatar>
                  <div className='flex min-w-0 flex-1 flex-col'>
                    <span className='truncate text-sm font-medium'>{user.name}</span>
                    <span className='text-muted-foreground truncate text-xs'>
                      {[user.job_title, user.department].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </div>
                  <div className='flex shrink-0 items-center gap-1'>
                    {pendingOpenId === user.open_id ? (
                      <LoaderCircleIcon className='text-muted-foreground size-4 animate-spin' />
                    ) : (
                      <RoleBadges user={user} />
                    )}
                  </div>
                </CommandItem>
              ))}
            </>
          )}
        </CommandList>
      </Command>

      {error && (
        <p className='text-destructive mt-3 flex items-start gap-1.5 text-sm'>
          <TriangleAlertIcon className='mt-0.5 size-4 shrink-0' />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}

export default DevQuickLogin
