'use client'

// React Imports
import { useEffect } from 'react'

// Third-party Imports
import { useTheme } from 'next-themes'

// Util Imports
import { setLarkWebComponentTheme } from '@/lib/lark-web-component'

export type LarkMountStatus = 'loading' | 'ready' | 'error'

/** 跟随浅色/深色切换，实时同步到飞书组件（全局 update，一处生效全局生效） */
export const useLarkThemeSync = () => {
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    setLarkWebComponentTheme(resolvedTheme === 'dark' ? 'dark' : 'light')
  }, [resolvedTheme])
}

// 注意：不要新增“每次挂载都 renderLarkComponent、卸载时 unmount”的通用 mount hook。
// SDK 的 unmount 不清理内部事件监听，反复挂载会累计监听并触发
// “possible EventEmitter memory leak detected” 告警。
// 复用策略统一放在 lib/lark-web-component.ts：Selector 走 acquireLarkSelector 实例池，
// 成员名片走 acquireLarkProfileCard 单例。
