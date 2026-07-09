'use client'

// React Imports
import { useMemo, useState, useSyncExternalStore } from 'react'

// Next Imports
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// Third-party Imports
import { HistoryIcon, LogOutIcon, SettingsIcon } from 'lucide-react'

// Component Imports
import { LarkProfileCard, UserAvatar } from '@/components/shared/lark'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

// Util Imports
import { clearAuth, USER_STORAGE_KEY, type AuthUser } from '@/lib/api'

// 订阅 localStorage 变化（跨标签页时由 storage 事件触发刷新）
const subscribeToStorage = (callback: () => void) => {
  window.addEventListener('storage', callback)

  return () => window.removeEventListener('storage', callback)
}

/**
 * 顶栏个人菜单：展示 localStorage 中的登录用户信息，提供退出登录。
 * 菜单内头像点击可查看自己的飞书成员名片（需登录态携带 open_id）。
 */
const ProfileDropdown = () => {
  const router = useRouter()

  // 菜单与名片弹窗分开控制：点击头像时先收起菜单再弹名片
  const [menuOpen, setMenuOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  // 用 useSyncExternalStore 读取 localStorage：服务端渲染时返回 null，客户端水合后自动取真实值
  const rawUser = useSyncExternalStore(
    subscribeToStorage,
    () => window.localStorage.getItem(USER_STORAGE_KEY),
    () => null
  )

  // 未登录时展示占位信息（框架阶段仅做客户端软校验，不强制跳转）
  const user: AuthUser = useMemo(() => {
    if (!rawUser) return { name: '未登录' }

    try {
      return JSON.parse(rawUser) as AuthUser
    } catch {
      return { name: '未登录' }
    }
  }, [rawUser])

  // 退出登录：清除本地 token 并回到登录页
  const handleLogout = () => {
    clearAuth()
    router.push('/auth/login')
  }

  // 点击菜单内头像：收起菜单，弹出飞书成员名片
  const handleShowProfileCard = () => {
    setMenuOpen(false)
    setProfileOpen(true)
  }

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          render={<Button variant='ghost' size='icon' className='relative rounded-full hover:bg-transparent' />}
        >
          {/* 触发按钮本身负责打开菜单，头像不再叠加弹名片交互 */}
          <UserAvatar name={user.name} avatarUrl={user.avatar} withProfileCard={false} />
          <span className='ring-card absolute right-0 bottom-0 block size-2 rounded-full bg-green-600 ring-2' />
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-60'>
          <DropdownMenuGroup>
            <DropdownMenuLabel className='flex items-center gap-4 px-2 py-2.5 font-normal'>
              {user.openId ? (
                <button
                  type='button'
                  className='focus-visible:ring-ring cursor-pointer rounded-full outline-none focus-visible:ring-2'
                  aria-label='查看我的成员名片'
                  onClick={handleShowProfileCard}
                >
                  <UserAvatar name={user.name} avatarUrl={user.avatar} size='lg' withProfileCard={false} />
                </button>
              ) : (
                <UserAvatar name={user.name} avatarUrl={user.avatar} size='lg' withProfileCard={false} />
              )}
              <div className='flex flex-1 flex-col items-start'>
                <span className='text-foreground text-base font-semibold'>{user.name}</span>
                <span className='text-muted-foreground text-sm'>飞书账号登录</span>
              </div>
            </DropdownMenuLabel>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuItem render={<Link href='/profile/performance' />}>
              <HistoryIcon />
              <span>个人绩效档案</span>
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href='/settings' />}>
              <SettingsIcon />
              <span>系统配置</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuItem variant='destructive' onClick={handleLogout}>
              <LogOutIcon />
              <span>退出登录</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 当前用户的飞书成员名片弹窗（菜单收起后展示，避免嵌套浮层冲突） */}
      {user.openId && (
        <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
          <DialogContent className='w-fit gap-0 p-0 sm:max-w-fit'>
            <DialogTitle className='sr-only'>我的成员名片</DialogTitle>
            {profileOpen && <LarkProfileCard openId={user.openId} />}
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

export default ProfileDropdown
