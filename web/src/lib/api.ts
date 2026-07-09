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

  return window.localStorage.getItem(TOKEN_STORAGE_KEY)
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

/** API 请求错误：携带 HTTP 状态码，便于调用方区分处理 */
export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
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

    try {
      const body = (await response.json()) as { message?: string | string[] }

      if (body?.message) {
        message = Array.isArray(body.message) ? body.message.join('；') : body.message
      }
    } catch {
      // 忽略非 JSON 响应体
    }

    // 401 = token 缺失/过期：全局登出并回登录页（登录相关页面除外，避免循环跳转）
    if (response.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/auth')) {
      clearAuth()
      window.location.href = '/auth/login'
    }

    throw new ApiError(response.status, message)
  }

  // 兼容无响应体的接口
  if (response.status === 204) return undefined as T

  return (await response.json()) as T
}
