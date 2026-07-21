'use client'

import { useEffect, useState, type ReactNode } from 'react'

import { Loader2Icon, RefreshCwIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  emptyStateIllustrationSrc,
  normalizeRequestError,
  REQUEST_ERROR_COPY,
  requestErrorIllustrationSrc,
  type RequestErrorKind
} from '@/lib/request-error'

type RequestErrorStateSize = 'page' | 'card' | 'compact'

type RequestErrorStateProps = {
  /** 原始错误；与 kind 二选一，同时传入时以 error 归一结果为准，可用 kind 覆盖 */
  error?: unknown
  kind?: RequestErrorKind
  title?: string
  description?: string
  size?: RequestErrorStateSize
  className?: string

  /** 主操作：重试 */
  onRetry?: () => void
  retryLabel?: string
  retrying?: boolean

  /** 次要操作（如返回） */
  secondaryAction?: ReactNode

  /** 是否展示 HTTP 状态等技术细节 */
  showDetail?: boolean
}

const sizeClass: Record<
  RequestErrorStateSize,
  { shell: string; image: string; title: string; description: string; actions: string }
> = {
  page: {
    shell: 'gap-5 px-6 py-16',
    image: 'h-44 w-auto max-w-[280px] sm:h-52',
    title: 'text-lg font-semibold',
    description: 'max-w-md text-sm',
    actions: 'mt-1'
  },
  card: {
    shell: 'gap-4 rounded-lg border border-dashed px-6 py-10',
    image: 'h-36 w-auto max-w-[220px]',
    title: 'text-base font-medium',
    description: 'max-w-sm text-sm',
    actions: 'mt-0.5'
  },
  compact: {
    shell: 'gap-3 rounded-lg border border-dashed px-4 py-6',
    image: 'h-24 w-auto max-w-[160px]',
    title: 'text-sm font-medium',
    description: 'max-w-xs text-xs',
    actions: 'mt-0'
  }
}

/**
 * 标准请求错误态：unDraw 插画 + 标题说明 + 重试等操作。
 * 配合 normalizeRequestError / apiFetch 网络错误包装使用。
 */
const RequestErrorState = ({
  error,
  kind: kindOverride,
  title,
  description,
  size = 'card',
  className,
  onRetry,
  retryLabel = '重试',
  retrying = false,
  secondaryAction,
  showDetail = false
}: RequestErrorStateProps) => {
  const info = error !== undefined ? normalizeRequestError(error) : null
  const kind = kindOverride ?? info?.kind ?? 'unknown'
  const copy = REQUEST_ERROR_COPY[kind]
  const resolvedTitle = title ?? info?.title ?? copy.title
  const resolvedDescription = description ?? info?.description ?? copy.description
  const styles = sizeClass[size]
  const [entered, setEntered] = useState(false)
  const [bump, setBump] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))

    return () => cancelAnimationFrame(frame)
  }, [])

  // kind / error 变化时轻推插画，强化状态切换反馈
  useEffect(() => {
    setBump(true)
    const timer = window.setTimeout(() => setBump(false), 480)

    return () => window.clearTimeout(timer)
  }, [kind, resolvedTitle])

  return (
    <div
      role='alert'
      data-kind={kind}
      className={cn(
        'text-muted-foreground flex flex-col items-center justify-center text-center transition-all duration-300',
        entered ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
        styles.shell,
        className
      )}
    >
      <div
        className={cn(
          'relative transition-transform duration-500 ease-out',
          bump && 'animate-[request-error-float_0.5s_ease-out]',
          retrying && 'opacity-80'
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- 本地 unDraw SVG，按 kind 切换，无需优化管线 */}
        <img
          src={requestErrorIllustrationSrc(kind)}
          alt=''
          className={cn('pointer-events-none select-none object-contain', styles.image)}
          draggable={false}
        />
      </div>

      <div className='flex flex-col items-center gap-1.5'>
        <p className={cn('text-foreground', styles.title)}>{resolvedTitle}</p>
        {resolvedDescription ? <p className={styles.description}>{resolvedDescription}</p> : null}
        {showDetail && info?.status != null ? (
          <p className='text-muted-foreground/80 font-mono text-[11px]'>
            {info.status === 0 ? 'NETWORK' : `HTTP ${info.status}`}
            {info.detail ? ` · ${info.detail}` : ''}
          </p>
        ) : null}
      </div>

      {(onRetry || secondaryAction) && (
        <div className={cn('flex flex-wrap items-center justify-center gap-2', styles.actions)}>
          {onRetry ? (
            <Button
              type='button'
              variant='default'
              size={size === 'compact' ? 'sm' : 'default'}
              disabled={retrying}
              onClick={onRetry}
              className={cn(retrying && 'cursor-wait')}
            >
              {retrying ? <Loader2Icon className='size-4 animate-spin' /> : <RefreshCwIcon className='size-4' />}
              {retrying ? '重试中…' : retryLabel}
            </Button>
          ) : null}
          {secondaryAction}
        </div>
      )}
    </div>
  )
}

type EmptyStateProps = {
  title?: string
  description?: string
  size?: RequestErrorStateSize
  className?: string
  action?: ReactNode
}

/** 标准空态：与 RequestErrorState 视觉节奏一致，使用 unDraw no-data 插画 */
const EmptyState = ({
  title = '暂无数据',
  description,
  size = 'card',
  className,
  action
}: EmptyStateProps) => {
  const styles = sizeClass[size]
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))

    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div
      className={cn(
        'text-muted-foreground flex flex-col items-center justify-center text-center transition-all duration-300',
        entered ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
        styles.shell,
        className
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={emptyStateIllustrationSrc()}
        alt=''
        className={cn('pointer-events-none select-none object-contain', styles.image)}
        draggable={false}
      />
      <div className='flex flex-col items-center gap-1.5'>
        <p className={cn('text-foreground', styles.title)}>{title}</p>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {action ? <div className={cn('flex flex-wrap items-center justify-center gap-2', styles.actions)}>{action}</div> : null}
    </div>
  )
}

export { EmptyState, RequestErrorState }
export type { EmptyStateProps, RequestErrorStateProps, RequestErrorStateSize }
