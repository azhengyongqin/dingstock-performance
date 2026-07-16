'use client'

import { useEffect, useState } from 'react'

import { apiFetch } from '@/lib/api'
import { avatarUrlOf, type LarkUserBrief } from '@/lib/perf-api'
import { cn } from '@/lib/utils'

import UserAvatar from './UserAvatar'

// 列表/元信息区可能重复渲染同一 open_id，复用简要信息避免打爆通讯录。
const briefCache = new Map<string, { name: string; avatarUrl?: string }>()
const briefRequests = new Map<string, Promise<{ name: string; avatarUrl?: string }>>()

const resolveBrief = (openId: string): Promise<{ name: string; avatarUrl?: string }> => {
  const cached = briefCache.get(openId)

  if (cached) return Promise.resolve(cached)

  const pending = briefRequests.get(openId)

  if (pending) return pending

  const request = apiFetch<LarkUserBrief>(`/contact/users/${encodeURIComponent(openId)}`)
    .then(user => {
      const brief = {
        name: user.name?.trim() || openId,
        avatarUrl: avatarUrlOf(user)
      }

      briefCache.set(openId, brief)

      return brief
    })
    .catch(() => {
      const fallback = { name: openId }

      briefCache.set(openId, fallback)

      return fallback
    })
    .finally(() => briefRequests.delete(openId))

  briefRequests.set(openId, request)

  return request
}

export type MemberPillProps = {
  openId?: string | null
  name?: string | null
  avatarUrl?: string | null
  className?: string
  /** 无 openId 时的占位文案 */
  emptyText?: string
}

/**
 * 人员胶囊：UserAvatar + 姓名。仅给 openId 时会按通讯录补齐姓名与头像。
 * 只读展示场景（创建人、发布人、列表单元格等）统一用本组件。
 */
export const MemberPill = ({
  openId,
  name,
  avatarUrl,
  className,
  emptyText = '-'
}: MemberPillProps) => {
  const [resolved, setResolved] = useState<{ openId: string; name: string; avatarUrl?: string } | null>(
    () => {
      if (!openId) return null
      if (name?.trim()) return { openId, name: name.trim(), avatarUrl: avatarUrl ?? undefined }
      const cached = briefCache.get(openId)

      return cached ? { openId, ...cached } : null
    }
  )

  useEffect(() => {
    if (!openId) {
      setResolved(null)

      return
    }

    if (name?.trim()) {
      setResolved({ openId, name: name.trim(), avatarUrl: avatarUrl ?? undefined })

      return
    }

    let cancelled = false

    void resolveBrief(openId).then(brief => {
      if (!cancelled) setResolved({ openId, ...brief })
    })

    return () => {
      cancelled = true
    }
  }, [openId, name, avatarUrl])

  if (!openId) {
    return <span className={cn('text-muted-foreground text-sm', className)}>{emptyText}</span>
  }

  const displayName = resolved?.name ?? '…'

  return (
    <span
      className={cn(
        'bg-muted/60 inline-flex max-w-full items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-0.5',
        className
      )}
    >
      <UserAvatar
        openId={openId}
        name={resolved?.name}
        avatarUrl={resolved?.avatarUrl ?? avatarUrl}
        size='sm'
      />
      <span className='truncate text-sm'>{displayName}</span>
    </span>
  )
}

export default MemberPill
