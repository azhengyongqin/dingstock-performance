import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { limitMock } = vi.hoisted(() => ({ limitMock: vi.fn() }))

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow = vi.fn()
    limit = limitMock
  }
}))
vi.mock('@vercel/kv', () => ({ kv: {} }))

import { POST } from './route'

describe('POST /api/generate', () => {
  beforeEach(() => {
    limitMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('未配置 OpenAI API Key 时返回可识别的配置错误', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')

    const response = await POST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        body: JSON.stringify({ prompt: '继续这段总结', option: 'continue' })
      })
    )

    expect(response.status).toBe(400)
    await expect(response.text()).resolves.toContain('OPENAI_API_KEY')
  })

  it('配置 KV 后对超额的 AI 请求返回 429', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubEnv('KV_REST_API_URL', 'https://example.com')
    vi.stubEnv('KV_REST_API_TOKEN', 'test-token')
    limitMock.mockResolvedValue({ success: false, limit: 50, remaining: 0, reset: 123456 })

    const response = await POST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        body: JSON.stringify({ prompt: '继续这段总结', option: 'continue' }),
        headers: { 'x-forwarded-for': '127.0.0.1' }
      })
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('X-RateLimit-Limit')).toBe('50')
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0')
  })
})
