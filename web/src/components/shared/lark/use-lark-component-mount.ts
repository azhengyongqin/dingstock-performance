'use client'

// React Imports
import { useEffect, useRef, useState } from 'react'

// Third-party Imports
import { useTheme } from 'next-themes'

// Util Imports
import {
  renderLarkComponent,
  setLarkWebComponentTheme,
  type LarkComponentInstance
} from '@/lib/lark-web-component'

export type LarkMountStatus = 'loading' | 'ready' | 'error'

/** 跟随浅色/深色切换，实时同步到飞书组件（全局 update，一处生效全局生效） */
export const useLarkThemeSync = () => {
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    setLarkWebComponentTheme(resolvedTheme === 'dark' ? 'dark' : 'light')
  }, [resolvedTheme])
}

/**
 * 把一个飞书网页组件挂载到 ref 容器上（自动完成 SDK 加载 + JSAPI 鉴权 + 主题同步）。
 * 注意：SDK 的 unmount 不会清理内部事件监听，本 hook 只适合"页面级挂载一次"的组件
 * （如 Selector）；会反复开关的成员名片请走 lark-web-component.ts 的单例 acquire/release。
 *
 * @param name 组件名（UserProfile / Selector）
 * @param props 传给 webComponent.render 的组件属性；只取挂载时的值，飞书组件实例不做增量更新
 * @param remountKey 变化时销毁并重建组件
 */
export const useLarkComponentMount = (
  name: 'UserProfile' | 'Selector',
  props: Record<string, unknown>,
  remountKey?: string
) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<LarkMountStatus>('loading')

  useLarkThemeSync()

  // props 通过 ref 透传，避免调用方每次渲染新建对象导致组件反复重建
  const propsRef = useRef(props)

  useEffect(() => {
    propsRef.current = props
  })

  useEffect(() => {
    const container = containerRef.current

    if (!container) return

    let cancelled = false
    let instance: LarkComponentInstance | null = null

    setStatus('loading')

    renderLarkComponent(name, propsRef.current, container)
      .then(rendered => {
        // 组件已卸载则直接销毁，避免泄漏
        if (cancelled) {
          rendered.unmount()

          return
        }

        instance = rendered
        setStatus('ready')
      })
      .catch(error => {
        if (!cancelled) {
          console.error(`[lark-web-component] ${name} 渲染失败：`, error)
          setStatus('error')
        }
      })

    return () => {
      cancelled = true
      instance?.unmount()
      container.replaceChildren()
    }
  }, [name, remountKey])

  return { containerRef, status }
}
