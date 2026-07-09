'use client'

// React Imports
import { useEffect, useRef, useState } from 'react'

// Third-party Imports
import { CircleAlertIcon, LoaderCircleIcon } from 'lucide-react'

// Util Imports
import { acquireLarkProfileCard, releaseLarkProfileCard } from '@/lib/lark-web-component'
import { cn } from '@/lib/utils'

import { useLarkThemeSync, type LarkMountStatus } from './use-lark-component-mount'

/**
 * 飞书成员名片（UserProfile 网页组件）的内联渲染容器。
 * 一般不直接使用，业务侧统一走 UserAvatar（点击头像弹出名片）。
 *
 * 实现要点：
 * - 名片实例是全局单例（acquire/release），避免反复 render 累计 SDK 内部监听器；
 * - 容器不设固定宽高，完全跟随名片组件自身尺寸，不裁剪、不滚动；
 *   加载/失败态用占位尺寸，渲染完成后由组件内容决定弹层大小。
 */
const LarkProfileCard = ({ openId, className }: { openId: string; className?: string }) => {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<LarkMountStatus>('loading')

  useLarkThemeSync()

  useEffect(() => {
    const host = hostRef.current

    if (!host) return

    let cancelled = false

    setStatus('loading')

    acquireLarkProfileCard(openId, host)
      .then(() => {
        if (!cancelled) setStatus('ready')
      })
      .catch(error => {
        if (!cancelled) {
          console.error('[lark-web-component] UserProfile 渲染失败：', error)
          setStatus('error')
        }
      })

    return () => {
      cancelled = true
      releaseLarkProfileCard(host)
    }
  }, [openId])

  return (
    <div className={cn('relative', className)}>
      {/* 宿主节点：名片组件自带固定宽高，弹层尺寸随内容自适应；未就绪时隐藏，避免闪现上一张名片 */}
      <div ref={hostRef} className={cn('flex', status !== 'ready' && 'hidden')} />

      {status === 'loading' && (
        <div className='text-muted-foreground flex h-120 w-90 max-w-[calc(100vw-2rem)] items-center justify-center gap-2 text-sm'>
          <LoaderCircleIcon className='size-4 animate-spin' />
          正在加载成员名片…
        </div>
      )}

      {status === 'error' && (
        <div className='text-muted-foreground flex h-48 w-90 max-w-[calc(100vw-2rem)] flex-col items-center justify-center gap-2 px-6 text-center text-sm'>
          <CircleAlertIcon className='text-destructive size-5' />
          <span>成员名片加载失败</span>
          <span className='text-xs'>请重新登录后重试，并确认应用已开通 component:user_profile 权限</span>
        </div>
      )}
    </div>
  )
}

export default LarkProfileCard
