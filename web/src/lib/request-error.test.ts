import { describe, expect, it } from 'vitest'

import { ApiError } from '@/lib/api'
import { normalizeRequestError, requestErrorMessage } from '@/lib/request-error'

describe('normalizeRequestError', () => {
  it('将 Failed to fetch 归为网络错误并给出中文说明', () => {
    const info = normalizeRequestError(new TypeError('Failed to fetch'))

    expect(info.kind).toBe('network')
    expect(info.title).toContain('无法连接')
    expect(info.description).not.toMatch(/Failed to fetch/i)
  })

  it('识别 ApiError status=0 为网络错误', () => {
    const info = normalizeRequestError(
      new ApiError(0, '无法连接服务器，请确认后端服务已启动或检查网络后重试')
    )

    expect(info.kind).toBe('network')
    expect(info.status).toBe(0)
  })

  it('按 HTTP 状态分类 403/404/500', () => {
    expect(normalizeRequestError(new ApiError(403, '无权访问')).kind).toBe('forbidden')
    expect(normalizeRequestError(new ApiError(404, '不存在')).kind).toBe('notFound')
    expect(normalizeRequestError(new ApiError(502, 'Bad Gateway')).kind).toBe('server')
  })

  it('业务 4xx 优先展示服务端中文 message', () => {
    const info = normalizeRequestError(new ApiError(409, '评审员指派冲突，请刷新后重试'))

    expect(info.kind).toBe('unknown')
    expect(info.description).toBe('评审员指派冲突，请刷新后重试')
  })
})

describe('requestErrorMessage', () => {
  it('网络错误返回友好说明而非 Failed to fetch', () => {
    expect(requestErrorMessage(new TypeError('Failed to fetch'))).not.toMatch(/Failed to fetch/i)
  })
})
