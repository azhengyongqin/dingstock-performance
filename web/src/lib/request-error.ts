import { ApiError } from '@/lib/api'

/** 请求失败的标准分类，驱动插画与文案 */
export type RequestErrorKind =
  | 'network'
  | 'forbidden'
  | 'notFound'
  | 'server'
  | 'unauthorized'
  | 'unknown'

export type RequestErrorInfo = {
  kind: RequestErrorKind
  title: string
  description: string

  /** HTTP 状态；网络失败为 0 */
  status?: number

  /** 原始错误文案，供调试或 toast 细节 */
  detail?: string
}

export const REQUEST_ERROR_COPY: Record<RequestErrorKind, { title: string; description: string }> = {
  network: {
    title: '无法连接服务器',
    description: '请确认后端服务已启动，或检查网络连接后重试。'
  },
  forbidden: {
    title: '没有访问权限',
    description: '当前账号无权查看此内容，如需开通请联系 HR 或管理员。'
  },
  notFound: {
    title: '未找到内容',
    description: '请求的资源不存在或已被移除，请返回后重试。'
  },
  server: {
    title: '服务暂时不可用',
    description: '服务器处理请求时出现问题，请稍后重试；若持续失败请联系管理员。'
  },
  unauthorized: {
    title: '登录已失效',
    description: '请重新登录后再继续操作。'
  },
  unknown: {
    title: '加载失败',
    description: '请求未能完成，请稍后重试。'
  }
}

const isFailedToFetch = (message: string) =>
  /failed to fetch|networkerror|load failed|fetch failed|network request failed/i.test(message)

/** 将任意 thrown 值归一为可展示的请求错误信息 */
export const normalizeRequestError = (error: unknown, fallback?: string): RequestErrorInfo => {
  if (error instanceof ApiError) {
    const kind = kindFromStatus(error.status, error.message)
    const copy = REQUEST_ERROR_COPY[kind]

    // 业务接口常返回可直接展示的中文 message；网络类仍用标准文案
    const useServerMessage =
      kind !== 'network' &&
      Boolean(error.message) &&
      !isFailedToFetch(error.message) &&
      !/^请求失败（HTTP \d+）$/.test(error.message)

    return {
      kind,
      title: copy.title,
      description: useServerMessage ? error.message : (fallback ?? copy.description),
      status: error.status,
      detail: error.message
    }
  }

  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return {
        kind: 'unknown',
        title: '请求已取消',
        description: fallback ?? '本次请求已取消，可重新发起。',
        detail: error.message
      }
    }

    if (isFailedToFetch(error.message) || error.name === 'TypeError') {
      return {
        kind: 'network',
        title: REQUEST_ERROR_COPY.network.title,
        description: fallback ?? REQUEST_ERROR_COPY.network.description,
        status: 0,
        detail: error.message
      }
    }

    return {
      kind: 'unknown',
      title: REQUEST_ERROR_COPY.unknown.title,
      description: fallback ?? (error.message || REQUEST_ERROR_COPY.unknown.description),
      detail: error.message
    }
  }

  return {
    kind: 'unknown',
    title: REQUEST_ERROR_COPY.unknown.title,
    description: fallback ?? REQUEST_ERROR_COPY.unknown.description
  }
}

/** toast / 内联文本用的短文案 */
export const requestErrorMessage = (error: unknown, fallback?: string): string => {
  const info = normalizeRequestError(error, fallback)

  if (info.kind === 'network') return info.description

  return info.detail && info.detail !== info.description ? info.detail : info.description
}

const kindFromStatus = (status: number, message: string): RequestErrorKind => {
  if (status === 0 || isFailedToFetch(message)) return 'network'
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'notFound'
  if (status >= 500) return 'server'

  return 'unknown'
}

/** 插画资源路径（含部署 basePath） */
export const requestErrorIllustrationSrc = (kind: RequestErrorKind): string => {
  const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/$/u, '')
  const file =
    kind === 'network'
      ? 'network.svg'
      : kind === 'forbidden'
        ? 'forbidden.svg'
        : kind === 'notFound'
          ? 'not-found.svg'
          : kind === 'server'
            ? 'server.svg'
            : kind === 'unauthorized'
              ? 'forbidden.svg'
              : 'unknown.svg'

  return `${base}/illustrations/undraw/${file}`
}

export const emptyStateIllustrationSrc = (): string => {
  const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/$/u, '')

  return `${base}/illustrations/undraw/empty.svg`
}
