import { put } from '@vercel/blob'

export const runtime = 'edge'

const decodeFilename = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Novel 源码图片上传端点；启用前必须配置 Vercel Blob Token。 */
export async function POST(request: Request): Promise<Response> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return new Response('Missing BLOB_READ_WRITE_TOKEN - 请在 web/.env 中完成服务端配置。', {
      status: 401
    })
  }

  const contentType = request.headers.get('content-type') || 'application/octet-stream'
  const originalName = decodeFilename(request.headers.get('x-vercel-filename') || 'upload')
  const extension = contentType.includes('/') ? `.${contentType.split('/')[1]}` : ''
  const finalName = extension && !originalName.endsWith(extension) ? `${originalName}${extension}` : originalName

  const blob = await put(finalName, request.body || '', {
    access: 'public',
    contentType
  })

  return Response.json(blob)
}
