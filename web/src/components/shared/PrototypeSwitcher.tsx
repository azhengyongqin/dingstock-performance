'use client'

/**
 * PROTOTYPE — 浮底变体切换条。仅用于 throwaway UI 原型，生产构建不渲染。
 */
import { useCallback, useEffect, useState } from 'react'

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { cn } from '@/lib/utils'

export type PrototypeVariantMeta = {
  key: string
  name: string
}

type PrototypeSwitcherProps = {
  variants: PrototypeVariantMeta[]
  paramKey?: string
  className?: string
}

export function PrototypeSwitcher({ variants, paramKey = 'variant', className }: PrototypeSwitcherProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const currentKey = searchParams?.get(paramKey) ?? variants[0]?.key
  const currentIndex = Math.max(
    0,
    variants.findIndex(item => item.key === currentKey)
  )
  const current = variants[currentIndex] ?? variants[0]

  const go = useCallback(
    (index: number) => {
      if (variants.length === 0 || !searchParams) return

      const next = variants[(index + variants.length) % variants.length]
      const params = new URLSearchParams(searchParams.toString())

      params.set(paramKey, next.key)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [paramKey, pathname, router, searchParams, variants]
  )

  useEffect(() => {
    if (process.env.NODE_ENV === 'production' || variants.length === 0 || !mounted) return

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName

      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        go(currentIndex - 1)
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        go(currentIndex + 1)
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [currentIndex, go, mounted, variants.length])

  if (!mounted || process.env.NODE_ENV === 'production' || variants.length === 0 || !current) return null

  return (
    <div
      className={cn(
        'bg-foreground text-background fixed bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full px-2 py-1.5 shadow-lg',
        className
      )}
    >
      <button
        type='button'
        className='hover:bg-background/15 flex size-7 items-center justify-center rounded-full'
        aria-label='上一个变体'
        onClick={() => go(currentIndex - 1)}
      >
        <ChevronLeftIcon className='size-4' />
      </button>
      <span className='min-w-40 px-2 text-center text-xs font-medium tracking-wide'>
        {current.key} — {current.name}
      </span>
      <button
        type='button'
        className='hover:bg-background/15 flex size-7 items-center justify-center rounded-full'
        aria-label='下一个变体'
        onClick={() => go(currentIndex + 1)}
      >
        <ChevronRightIcon className='size-4' />
      </button>
    </div>
  )
}

export function usePrototypeVariant(variants: PrototypeVariantMeta[], paramKey = 'variant') {
  const searchParams = useSearchParams()
  // 单测无 Next 路由时 searchParams 可能为 null，回退到首个变体
  const key = searchParams?.get(paramKey) ?? variants[0]?.key

  return variants.find(item => item.key === key) ?? variants[0]
}
