'use client'

// React Imports
import { useEffect, useState } from 'react'

// Component Imports
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

// Util Imports
import { apiFetch } from '@/lib/api'
import { avatarUrlOf, type LarkUserBrief } from '@/lib/perf-api'
import { cn } from '@/lib/utils'

import LarkProfileCard from './LarkProfileCard'

// 同一人员在列表中可能出现多次；复用已解析结果和并发请求，避免重复访问通讯录。
const directoryAvatarCache = new Map<string, string>()
const directoryAvatarRequests = new Map<string, Promise<string | undefined>>()

const resolveDirectoryAvatarUrl = (openId: string): Promise<string | undefined> => {
  const cached = directoryAvatarCache.get(openId)

  if (cached) return Promise.resolve(cached)

  const pending = directoryAvatarRequests.get(openId)

  if (pending) return pending

  const request = apiFetch<LarkUserBrief>(`/contact/users/${encodeURIComponent(openId)}`)
    .then(user => {
      const url = avatarUrlOf(user)

      if (url) directoryAvatarCache.set(openId, url)

      return url
    })
    .catch(() => undefined)
    .finally(() => directoryAvatarRequests.delete(openId))

  directoryAvatarRequests.set(openId, request)

  return request
}

export type UserAvatarProps = {

  /** 飞书 open_id：提供后点击头像弹出飞书成员名片 */
  openId?: string | null
  name?: string | null
  avatarUrl?: string | null
  size?: 'sm' | 'default' | 'lg'
  className?: string

  /** 关闭点击弹名片行为（如头像本身已是其他交互的触发器） */
  withProfileCard?: boolean
}

/**
 * 项目统一的人员头像组件：头像展示 + 点击弹出飞书成员名片（UserProfile 网页组件）。
 * 所有涉及人员头像的场景一律使用本组件，不要直接用 ui/avatar 渲染人员头像。
 * 没有 openId 时自动退化为普通头像（如 mock 数据、历史登录态）。
 */
const UserAvatar = ({ openId, name, avatarUrl, size = 'default', className, withProfileCard = true }: UserAvatarProps) => {
  const displayName = name?.trim() || ''
  const initials = displayName ? displayName.slice(0, 1).toUpperCase() : '?'

  const [resolvedDirectoryAvatar, setResolvedDirectoryAvatar] = useState<{
    openId: string
    url: string
  } | null>(() =>
    openId && directoryAvatarCache.has(openId)
      ? { openId, url: directoryAvatarCache.get(openId) as string }
      : null
  )

  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null)

  const directoryAvatarUrl =
    resolvedDirectoryAvatar && resolvedDirectoryAvatar.openId === openId
      ? resolvedDirectoryAvatar.url
      : openId
        ? directoryAvatarCache.get(openId)
        : undefined

  const providedAvatarFailed = Boolean(avatarUrl && failedAvatarUrl === avatarUrl)
  const resolvedAvatarUrl = providedAvatarFailed ? directoryAvatarUrl : (avatarUrl ?? directoryAvatarUrl)

  useEffect(() => {
    // 调用方未提供头像，或提供的地址已失效时，统一从本地通讯录补齐稳定 URL。
    if (!openId || (avatarUrl && !providedAvatarFailed)) return

    let cancelled = false

    void resolveDirectoryAvatarUrl(openId).then(url => {
      if (!cancelled && url) setResolvedDirectoryAvatar({ openId, url })
    })

    return () => {
      cancelled = true
    }
  }, [avatarUrl, openId, providedAvatarFailed])

  const avatar = (
    <Avatar size={size} className={className}>
      {resolvedAvatarUrl && (
        <AvatarImage
          src={resolvedAvatarUrl}
          alt={displayName}
          onLoadingStatusChange={status => {
            if (status === 'error') setFailedAvatarUrl(resolvedAvatarUrl)
          }}
        />
      )}
      <AvatarFallback>{initials}</AvatarFallback>
    </Avatar>
  )

  if (!openId || !withProfileCard) return avatar

  return (
    <Popover>
      <PopoverTrigger
        aria-label={displayName ? `查看 ${displayName} 的成员名片` : '查看成员名片'}
        className={cn(
          'focus-visible:ring-ring inline-flex shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-2'
        )}
      >
        {avatar}
      </PopoverTrigger>
      {/* 弹层尺寸完全由名片组件内容决定：不设宽高、不裁剪、不滚动 */}
      <PopoverContent align='start' side='bottom' className='w-fit max-w-none gap-0 p-0'>
        <LarkProfileCard openId={openId} />
      </PopoverContent>
    </Popover>
  )
}

export default UserAvatar
