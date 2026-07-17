'use client'

import { AdvancedEditor } from './novel/advanced-editor'
import type { ImageUploadHandler } from './novel/types'
import MarkdownContent from './markdown-content'

export type MarkdownEditorProps = {
  value: string
  onChange: (markdown: string) => void
  ariaLabel: string

  /** 上传粘贴、拖入或主动选择的图片并返回可持久化地址；省略时以内嵌 Data URL 保存。 */
  uploadImage?: ImageUploadHandler
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  className?: string
}

/** Novel 源码编辑器的项目入口，保持业务表单原有 Markdown 字符串协议。 */
const MarkdownEditor = ({
  value,
  onChange,
  ariaLabel,
  uploadImage,
  placeholder = '请输入内容，或输入 / 选择内容块…',
  disabled,
  invalid,
  className
}: MarkdownEditorProps) => {
  // 已提交或无编辑权限时走纯展示组件，不挂载任何编辑器交互。
  if (disabled) return <MarkdownContent content={value} className={className} />

  return (
    <AdvancedEditor
      value={value}
      onChange={onChange}
      ariaLabel={ariaLabel}
      uploadImage={uploadImage}
      placeholder={placeholder}
      invalid={invalid}
      className={className}
    />
  )
}

export default MarkdownEditor
