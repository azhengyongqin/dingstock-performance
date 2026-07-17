import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { putMock } = vi.hoisted(() => ({ putMock: vi.fn() }))

vi.mock('@vercel/blob', () => ({ put: putMock }))

import { POST } from './route'

describe('POST /api/upload', () => {
  beforeEach(() => {
    putMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('未配置 Blob Token 时返回可识别的配置错误', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '')

    const response = await POST(
      new Request('http://localhost/api/upload', {
        method: 'POST',
        body: new Blob(['image'], { type: 'image/png' }),
        headers: {
          'content-type': 'image/png',
          'x-vercel-filename': 'result.png'
        }
      })
    )

    expect(response.status).toBe(401)
    await expect(response.text()).resolves.toContain('BLOB_READ_WRITE_TOKEN')
  })

  it('上传时恢复经过 URL 编码的原始文件名', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'test-token')
    putMock.mockResolvedValue({ url: 'https://blob.example.com/result.png' })

    const response = await POST(
      new Request('http://localhost/api/upload', {
        method: 'POST',
        body: new Blob(['image'], { type: 'image/png' }),
        headers: {
          'content-type': 'image/png',
          'x-vercel-filename': encodeURIComponent('结果图.png')
        }
      })
    )

    expect(response.status).toBe(200)
    expect(putMock).toHaveBeenCalledWith('结果图.png', expect.anything(), expect.any(Object))
  })
})
