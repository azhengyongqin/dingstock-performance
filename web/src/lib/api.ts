/**
 * 后端 API 访问封装。
 *
 * - baseUrl 默认指向本地 NestJS 后端（http://localhost:3000），
 *   可通过环境变量 NEXT_PUBLIC_API_BASE_URL 覆盖（部署时必须配置）。
 * - 登录成功后 JWT 存放在 localStorage 的 `dingstock_token`，
 *   所有请求自动附带 `Authorization: Bearer <token>`。
 */

// localStorage 存储键：应用 JWT
export const TOKEN_STORAGE_KEY = 'dingstock_token'

// localStorage 存储键：用户基本信息（姓名/头像）
export const USER_STORAGE_KEY = 'dingstock_user'

// 后端服务地址（环境变量优先）
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000'

/** 登录用户基本信息（来自飞书 OAuth 回调） */
export type AuthUser = {
  name: string
  avatar?: string

  /** 飞书 open_id：供成员名片等飞书网页组件定位当前用户 */
  openId?: string
}

/** 读取本地保存的 JWT（仅浏览器环境） */
export const getToken = (): string | null => {
  if (typeof window === 'undefined') return null

  // 某些 SSR/测试运行时会暴露不完整的 localStorage 对象，不应阻断公开接口请求。
  return typeof window.localStorage?.getItem === 'function' ? window.localStorage.getItem(TOKEN_STORAGE_KEY) : null
}

/** 读取本地保存的用户信息 */
export const getStoredUser = (): AuthUser | null => {
  if (typeof window === 'undefined') return null

  const raw = window.localStorage.getItem(USER_STORAGE_KEY)

  if (!raw) return null

  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}

/** 保存登录态（token + 用户信息） */
export const saveAuth = (token: string, user: AuthUser) => {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
  window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user))
}

/** 清除登录态（退出登录时调用） */
export const clearAuth = () => {
  window.localStorage.removeItem(TOKEN_STORAGE_KEY)
  window.localStorage.removeItem(USER_STORAGE_KEY)
}

/** API 请求错误：携带 HTTP 状态码与解析后的响应体，便于调用方区分处理 */
export class ApiError extends Error {
  status: number

  /** 后端返回的原始响应体（JSON），用于读取业务错误码/附带数据（如破坏性修改的 impact） */
  body?: unknown

  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

/**
 * fetch 封装：拼接 baseUrl、自动附带 Bearer token、统一 JSON 解析。
 *
 * @param path 以 `/` 开头的后端接口路径，如 `/contact/departments`
 * @param init 透传给 fetch 的其他参数
 */
export const apiFetch = async <T = unknown>(path: string, init?: RequestInit): Promise<T> => {
  const token = getToken()

  const headers = new Headers(init?.headers)

  if (!headers.has('Content-Type') && init?.body) {
    headers.set('Content-Type', 'application/json')
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers
  })

  if (!response.ok) {
    // 尽量读取后端返回的错误信息
    let message = `请求失败（HTTP ${response.status}）`
    let body: unknown

    try {
      body = await response.json()
      const parsed = body as { message?: string | string[] }

      if (parsed?.message) {
        message = Array.isArray(parsed.message) ? parsed.message.join('；') : parsed.message
      }
    } catch {
      // 忽略非 JSON 响应体
    }

    // 401 = token 缺失/过期：全局登出并回登录页（登录相关页面除外，避免循环跳转）
    if (response.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/auth')) {
      clearAuth()
      window.location.href = '/auth/login'
    }

    throw new ApiError(response.status, message, body)
  }

  // 兼容无响应体的接口
  if (response.status === 204) return undefined as T

  return (await response.json()) as T
}

/** Next.js 同源 Route Handler 请求入口；供流式 AI 等需要直接读取 Response 的场景复用。 */
export const sameOriginApiFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers)
  const token = getToken()
  const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/$/u, '')

  const resolvedInput =
    typeof input === 'string' && input.startsWith('/') && basePath && !input.startsWith(`${basePath}/`)
      ? `${basePath}${input}`
      : input

  if (token) headers.set('Authorization', `Bearer ${token}`)

  return fetch(resolvedInput, { ...init, headers })
}

/** 上传一张 Novel 编辑器图片，并返回对象存储中的公开地址。 */
export const uploadNovelImage = async (file: File): Promise<string> => {
  const response = await sameOriginApiFetch('/api/upload', {
    method: 'POST',
    body: file,
    headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-vercel-filename': encodeURIComponent(file.name)
    }
  })

  if (!response.ok) throw new ApiError(response.status, await response.text())

  const result = (await response.json()) as { url?: string }

  if (!result.url) throw new ApiError(response.status, '上传结果缺少图片地址', result)

  return result.url
}

// ---- 开发环境快速登录（仅 dev；生产后端返回 404，前端也不渲染入口） ----

/** 开发快速登录候选员工（后端 GET /auth/dev/users 返回项） */
export type DevLoginUser = {
  open_id: string
  name: string
  en_name?: string
  avatar_url?: string
  job_title?: string

  /** 末级部门名，仅用于展示 */
  department?: string

  /** 显式授权角色（HR/ADMIN 等），含租户超管兜底的 ADMIN */
  roles: string[]

  /** 是否派生 Leader（有直属下属或周期 Leader 快照命中） */
  is_leader: boolean

  /** 是否飞书租户超级管理员 */
  is_tenant_manager: boolean
}

/** 【仅开发】拉取可快速登录的员工列表 */
export const fetchDevLoginUsers = () =>
  apiFetch<{ items: DevLoginUser[]; total: number }>('/auth/dev/users')

/** 【仅开发】按 open_id 直接登录，返回会话 token 与用户信息 */
export const devLogin = (openId: string) =>
  apiFetch<{ token: string; user: { open_id: string; name?: string; avatar_url?: string } }>('/auth/dev/login', {
    method: 'POST',
    body: JSON.stringify({ open_id: openId })
  })
