'use client'

// React Imports
import { type FormEvent, useEffect, useMemo, useState } from 'react'

// Next Imports
import { useRouter } from 'next/navigation'

// Third-party Imports
import { LoaderCircleIcon, TriangleAlertIcon } from 'lucide-react'

// Component Imports
import SearchInput from '@/components/shared/SearchInput'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandItem, CommandList } from '@/components/ui/command'
import { Input } from '@/components/ui/input'

// Util Imports
import { ApiError, devLogin, fetchDevLoginUsers, saveAuth, type DevLoginUser } from '@/lib/api'
import { matchesPinyinSearch } from '@/lib/pinyin-search'

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
 * 「快速选择员工登录」：
 * 免飞书 OAuth，直接选一个已同步员工换取会话 JWT，方便快速切换角色测试。
 * 是否显示完全由后端 auth.devLogin.enabled 控制：接口关闭并返回 404 时不渲染入口。
 */
const DevQuickLogin = () => {
  const router = useRouter()

  const [users, setUsers] = useState<DevLoginUser[]>([])
  const [query, setQuery] = useState('')

  // 初始探测期间不渲染，避免后端关闭时入口闪现。
  const [available, setAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 生产环境可为快速登录增加独立密码门禁；密码仅保存在当前组件内存中。
  const [passwordRequired, setPasswordRequired] = useState(false)
  const [passwordAccepted, setPasswordAccepted] = useState(false)
  const [password, setPassword] = useState('')
  const [verifyingPassword, setVerifyingPassword] = useState(false)

  // 正在登录的员工 open_id（禁用重复点击并显示 loading）
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    fetchDevLoginUsers()
      .then(data => {
        if (active) {
          setUsers(data.items)
          setAvailable(true)
          setPasswordAccepted(true)
        }
      })
      .catch(cause => {
        if (!active) return

        // 404 是后端明确关闭 devLogin，不向普通用户暴露入口或错误提示。
        if (cause instanceof ApiError && cause.status === 404) return

        // 401 表示入口已开启，但必须先通过独立的 32 位密码验证。
        if (cause instanceof ApiError && cause.status === 401) {
          setAvailable(true)
          setPasswordRequired(true)

          return
        }

        setAvailable(true)
        setError('拉取员工列表失败：请确认后端已启动，且已用 HR 账号触发过组织架构同步。')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  // 与组织架构 / 多选弹窗同一套拼音匹配
  const filteredUsers = useMemo(() => {
    const keyword = query.trim()

    if (!keyword) return users

    return users.filter(
      user =>
        matchesPinyinSearch(user.name, keyword) ||
        (user.en_name ? matchesPinyinSearch(user.en_name, keyword) : false) ||
        user.open_id.toLowerCase().includes(keyword.toLowerCase())
    )
  }, [users, query])

  const handleVerifyPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (password.length !== 32 || verifyingPassword) return

    setVerifyingPassword(true)
    setError(null)

    try {
      const data = await fetchDevLoginUsers(password)

      setUsers(data.items)
      setPasswordAccepted(true)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setError('访问密码错误，请重试。')
      } else {
        setError('验证失败，请确认后端服务正常后重试。')
      }
    } finally {
      setVerifyingPassword(false)
    }
  }

  const handlePick = async (user: DevLoginUser) => {
    if (pendingOpenId) return
    setPendingOpenId(user.open_id)
    setError(null)

    try {
      const { token } = await devLogin(user.open_id, passwordRequired ? password : undefined)

      // 与飞书 OAuth 回调一致：写入 token + 用户基本信息，再进工作台
      saveAuth(token, { name: user.name, avatar: user.avatar_url, openId: user.open_id })
      router.replace('/workbench')
    } catch (cause) {
      // 密码可能已被管理员轮换，返回验证页重新输入，避免继续暴露员工列表。
      if (cause instanceof ApiError && cause.status === 401 && passwordRequired) {
        setUsers([])
        setPasswordAccepted(false)
        setError('访问密码已失效，请重新输入。')
      } else {
        setError(`以「${user.name}」登录失败，请重试。`)
      }

      setPendingOpenId(null)
    }
  }

  if (!available) return null

  return (
    <div className='border-border/60 rounded-lg border border-dashed p-4'>
      <div className='mb-3 flex items-center gap-2'>
        <Badge variant='outline' className='border-amber-500/50 text-amber-600 dark:text-amber-400'>
          DEV
        </Badge>
        <span className='text-sm font-medium'>快速选择员工登录</span>
        <span className='text-muted-foreground text-xs'>临时测试入口</span>
      </div>

      {/* 密码门禁验证成功前不请求、不展示员工列表。 */}
      {passwordRequired && !passwordAccepted ? (
        <form className='space-y-3' onSubmit={handleVerifyPassword}>
          <div className='space-y-1.5'>
            <label htmlFor='dev-login-password' className='text-sm font-medium'>
              32 位访问密码
            </label>
            <Input
              id='dev-login-password'
              type='password'
              value={password}
              onChange={event => setPassword(event.target.value)}
              maxLength={32}
              autoComplete='off'
              placeholder='请输入管理员提供的访问密码'
              disabled={verifyingPassword}
            />
          </div>
          <Button type='submit' className='w-full' disabled={password.length !== 32 || verifyingPassword}>
            {verifyingPassword && <LoaderCircleIcon className='animate-spin' />}
            验证密码
          </Button>
        </form>
      ) : (
        <Command shouldFilter={false} className='border-border/60 bg-transparent'>
          <div className='p-1 pb-0'>
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder='搜索姓名 / 英文名…'
              disabled={loading || Boolean(pendingOpenId)}
              className='border-input/30 bg-input/30 h-8! rounded-lg! shadow-none!'
            />
          </div>
          <CommandList>
            {loading ? (
              <div className='text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm'>
                <LoaderCircleIcon className='size-4 animate-spin' />
                正在加载员工列表…
              </div>
            ) : (
              <>
                <CommandEmpty>未找到匹配的员工</CommandEmpty>
                {filteredUsers.map(user => (
                  <CommandItem
                    key={user.open_id}
                    value={user.open_id}
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
      )}

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
