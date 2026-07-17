import { type UploadFn, createImageUpload } from 'novel'
import { toast } from 'sonner'

import { ApiError, uploadNovelImage } from '@/lib/api'

import type { ImageUploadHandler } from './types'

const MAX_IMAGE_SIZE = 20 * 1024 * 1024

/** 可直接传给 MarkdownEditor.uploadImage，调用已移植的 Vercel Blob 上传端点。 */
export const uploadImageToNovelApi: ImageUploadHandler = file => uploadNovelImage(file)

/** 未接对象存储时以内嵌 Data URL 保存，确保现有业务页面开箱即用。 */
const imageFileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('无法读取图片内容'))
    }

    reader.onerror = () => reject(reader.error ?? new Error('无法读取图片内容'))
    reader.onabort = () => reject(new Error('图片读取已取消'))
    reader.readAsDataURL(file)
  })

/** 默认优先使用源码同款 Blob 端点；未配置或上传失败时回退为可立即持久化的 Data URL。 */
export const uploadImageWithNovelFallback: ImageUploadHandler = async file => {
  try {
    return await uploadImageToNovelApi(file)
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return imageFileToDataUrl(file)

    throw error
  }
}

/**
 * 源码版 createImageUpload 的项目适配：串行占位事务，规避立即完成和连续上传时的丢图竞态。
 */
export const createNovelImageUpload = (uploadImage?: ImageUploadHandler): UploadFn => {
  let uploadQueue: Promise<void> = Promise.resolve()
  let releaseCurrentUpload: (() => void) | undefined

  const releaseAfterNovelTransaction = () => {
    // Novel 会在 onUpload Promise 结算后的微任务中插图，下一个宏任务再启动下一次上传。
    setTimeout(() => {
      releaseCurrentUpload?.()
      releaseCurrentUpload = undefined
    }, 0)
  }

  const runImageUpload = createImageUpload({
    validateFn: file => {
      if (!file.type.startsWith('image/')) {
        toast.error('只能上传图片文件')
        releaseAfterNovelTransaction()

        return false
      }

      if (file.size > MAX_IMAGE_SIZE) {
        toast.error('图片不能超过 20 MB')
        releaseAfterNovelTransaction()

        return false
      }

      return true
    },
    onUpload: async file => {
      // Novel 先启动内部 FileReader；等待第二次读取完成，确保本地预览占位已经派发。
      const placeholderReady = imageFileToDataUrl(file)

      try {
        const imageUrlPromise = uploadImage ? uploadImage(file) : placeholderReady

        await placeholderReady

        const imageUrl = await imageUrlPromise

        if (!imageUrl) throw new Error('上传结果缺少图片地址')

        toast.success('图片已插入')

        return imageUrl
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '图片上传失败，请重试')
        throw error
      } finally {
        releaseAfterNovelTransaction()
      }
    }
  })

  return (file, view, pos) => {
    uploadQueue = uploadQueue.then(
      () =>
        new Promise<void>(resolve => {
          releaseCurrentUpload = resolve

          try {
            runImageUpload(file, view, pos)
          } catch (error) {
            toast.error(error instanceof Error ? error.message : '图片上传失败，请重试')
            releaseAfterNovelTransaction()
          }
        })
    )
  }
}
