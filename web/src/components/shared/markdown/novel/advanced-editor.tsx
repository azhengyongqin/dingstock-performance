'use client'

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject
} from 'react'

import {
  EditorCommand,
  EditorCommandItem,
  EditorContent,
  EditorRoot,
  ImageResizer,
  type EditorInstance,
  type JSONContent,
  type UploadFn,
  handleCommandNavigation,
  handleImageDrop,
  handleImagePaste,
  useEditor
} from 'novel'

import { Button } from '@/components/ui/button'
import { CommandEmpty, CommandList } from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import { EditorBubbleMenu } from './editor-bubble-menu'
import { EditorToolbar } from './editor-toolbar'
import { createDefaultExtensions } from './extensions'
import { createNovelImageUpload } from './image-upload'
import { pasteMarkdownText } from './paste-markdown'
import { createSlashCommand, type EmbedType } from './slash-command'
import {
  hasBubbleMenuFeatures,
  resolveMarkdownEditorFeatures,
  type ImageUploadHandler,
  type MarkdownEditorFeatures
} from './types'

type ValueSyncProps = {
  value: string
}

type ImageUploadInputProps = {
  id: string
  uploadFn: UploadFn
}

type EmbedDialogState = {
  type: EmbedType
  editor: EditorInstance
} | null

const EMBED_COPY: Record<EmbedType, { title: string; description: string; placeholder: string }> = {
  youtube: {
    title: '嵌入 YouTube 视频',
    description: '粘贴一个公开的 YouTube 或 youtu.be 视频地址。',
    placeholder: 'https://www.youtube.com/watch?v=...'
  },
  twitter: {
    title: '嵌入 X（Twitter）帖子',
    description: '粘贴一个公开的 x.com 帖子地址。',
    placeholder: 'https://x.com/user/status/...'
  }
}

const isValidEmbedUrl = (type: EmbedType, value: string) => {
  if (type === 'youtube') {
    return /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)[\w-]+(?:\S+)?$/u.test(
      value
    )
  }

  return /^https?:\/\/(?:www\.)?x\.com\/[a-zA-Z0-9_]{1,15}\/status\/\d+(?:\/\S*)?$/u.test(value)
}

/** 文件输入位于 EditorProvider 内部，可直接取得触发命令时的当前编辑器。 */
const ImageUploadInput = ({ id, uploadFn }: ImageUploadInputProps) => {
  const { editor } = useEditor()

  return (
    <Input
      id={id}
      type='file'
      accept='image/*'
      aria-label='选择图片文件'
      tabIndex={-1}
      className='hidden'
      onChange={event => {
        const file = event.currentTarget.files?.[0]

        if (file && editor) uploadFn(file, editor.view, editor.view.state.selection.from)

        event.currentTarget.value = ''
      }}
    />
  )
}

/** 外部受控值变化时同步编辑器，避免回写后重复 setContent 和光标跳动。 */
const ValueSync = ({ value }: ValueSyncProps) => {
  const { editor } = useEditor()

  useEffect(() => {
    if (!editor || editor.storage.markdown.getMarkdown() === value) return

    editor.commands.setContent(value, false)
  }, [editor, value])

  return null
}

type EditorInstanceBridgeProps = {
  editorRef: RefObject<EditorInstance | null>
}

/** 把当前 TipTap 实例挂到外部 ref，供 handlePaste 等 editorProps 回调使用。 */
const EditorInstanceBridge = ({ editorRef }: EditorInstanceBridgeProps) => {
  const { editor } = useEditor()

  useLayoutEffect(() => {
    editorRef.current = editor ?? null

    return () => {
      editorRef.current = null
    }
  }, [editor, editorRef])

  return null
}

/** 保留 Novel 源码编辑器的实时词数，并跟随受控值和用户输入更新。 */
const EditorWordCount = () => {
  const { editor } = useEditor()
  const [wordCount, setWordCount] = useState(0)

  useEffect(() => {
    if (!editor) return

    const updateWordCount = () => setWordCount(editor.storage.characterCount.words())

    updateWordCount()
    editor.on('update', updateWordCount)

    return () => {
      editor.off('update', updateWordCount)
    }
  }, [editor])

  return (
    <div
      role='status'
      aria-live='polite'
      data-slot='markdown-word-count'
      className='bg-muted text-muted-foreground pointer-events-none absolute top-2 right-2 z-10 rounded px-2 py-1 text-xs'
    >
      {wordCount} 个词
    </div>
  )
}

export type AdvancedEditorProps = {
  value: string
  onChange: (markdown: string) => void
  ariaLabel: string
  uploadImage?: ImageUploadHandler
  placeholder: string
  invalid?: boolean
  className?: string
  features?: MarkdownEditorFeatures
}

/**
 * 直接移植 Novel TailwindAdvancedEditor 的结构，并适配本项目受控 Markdown 字符串协议。
 */
export const AdvancedEditor = ({
  value,
  onChange,
  ariaLabel,
  uploadImage,
  placeholder,
  invalid,
  className,
  features
}: AdvancedEditorProps) => {
  const imageInputId = useId()
  const editorRef = useRef<EditorInstance | null>(null)
  const [embedDialog, setEmbedDialog] = useState<EmbedDialogState>(null)
  const [embedUrl, setEmbedUrl] = useState('')
  const [embedError, setEmbedError] = useState('')
  const resolvedFeatures = useMemo(() => resolveMarkdownEditorFeatures(features), [features])

  // TipTap 扩展集合变更需重建实例；用稳定 key 强制 remount。
  const editorKey = useMemo(() => JSON.stringify(resolvedFeatures), [resolvedFeatures])
  const uploadFn = useMemo(() => createNovelImageUpload(uploadImage), [uploadImage])

  const requestImageUpload = useCallback(() => {
    document.getElementById(imageInputId)?.click()
  }, [imageInputId])

  const requestEmbed = useCallback((type: EmbedType, editor: EditorInstance) => {
    setEmbedUrl('')
    setEmbedError('')
    setEmbedDialog({ type, editor })
  }, [])

  const { slashCommand, suggestionItems } = useMemo(
    () =>
      createSlashCommand(requestImageUpload, requestEmbed, {
        imageUpload: resolvedFeatures.imageUpload,
        mediaEmbed: resolvedFeatures.mediaEmbed
      }),
    [requestEmbed, requestImageUpload, resolvedFeatures.imageUpload, resolvedFeatures.mediaEmbed]
  )

  const extensions = useMemo(() => {
    const base = createDefaultExtensions({
      placeholder,
      dragHandle: resolvedFeatures.dragHandle,
      pasteMarkdown: resolvedFeatures.pasteMarkdown
    })

    return resolvedFeatures.slashCommand ? [...base, slashCommand] : base
  }, [
    placeholder,
    resolvedFeatures.dragHandle,
    resolvedFeatures.pasteMarkdown,
    resolvedFeatures.slashCommand,
    slashCommand
  ])

  // tiptap-markdown 会在编辑器创建前解析字符串；Novel 的声明仍只接受 JSONContent。
  const initialContent = value as unknown as JSONContent

  const closeEmbedDialog = () => {
    setEmbedDialog(null)
    setEmbedUrl('')
    setEmbedError('')
  }

  const insertEmbed = () => {
    if (!embedDialog) return

    const url = embedUrl.trim()

    if (!isValidEmbedUrl(embedDialog.type, url)) {
      setEmbedError(embedDialog.type === 'youtube' ? '请输入有效的 YouTube 地址' : '请输入有效的 x.com 帖子地址')

      return
    }

    if (embedDialog.type === 'youtube') {
      embedDialog.editor.chain().focus().setYoutubeVideo({ src: url }).run()
    } else {
      embedDialog.editor.chain().focus().setTweet({ src: url }).run()
    }

    closeEmbedDialog()
  }

  return (
    <>
      <div
        data-slot='markdown-editor'
        aria-invalid={invalid || undefined}
        className={cn(
          'border-input bg-background relative overflow-hidden rounded-md border shadow-xs transition-[color,box-shadow]',
          'focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-3',
          'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
          className
        )}
      >
        <EditorRoot key={editorKey}>
          <EditorContent
            initialContent={initialContent}
            immediatelyRender={false}
            extensions={extensions}
            className='relative'
            slotBefore={
              resolvedFeatures.toolbar ? (
                <EditorToolbar
                  features={resolvedFeatures}
                  onRequestImageUpload={requestImageUpload}
                  onRequestEmbed={requestEmbed}
                />
              ) : null
            }
            editorProps={{
              handleDOMEvents: {
                keydown: (_view, event) =>
                  resolvedFeatures.slashCommand ? handleCommandNavigation(event) : false
              },
              handlePaste: (view, event) => {
                // 图片优先；再按 Markdown 源码解析，避免 HTML 源码包装导致原样显示。
                if (resolvedFeatures.imagePaste && handleImagePaste(view, event, uploadFn)) {
                  return true
                }

                if (resolvedFeatures.pasteMarkdown && pasteMarkdownText(editorRef.current, event)) {
                  return true
                }

                return false
              },
              handleDrop: (view, event, _slice, moved) =>
                resolvedFeatures.imageDrop ? handleImageDrop(view, event, moved, uploadFn) : false,
              attributes: {
                role: 'textbox',
                'aria-label': ariaLabel,
                'aria-multiline': 'true',
                class: cn(
                  'tiptap min-h-36 px-4 py-4 text-sm outline-none',
                  '[&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-bold',
                  '[&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold',
                  '[&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold',
                  '[&_h4]:mb-2 [&_h4]:text-base [&_h4]:font-semibold',
                  '[&_h5]:mb-1.5 [&_h5]:text-sm [&_h5]:font-semibold',
                  '[&_h6]:mb-1.5 [&_h6]:text-sm [&_h6]:font-medium',
                  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
                  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6',
                  '[&_blockquote]:my-2 [&_blockquote]:border-l-4 [&_blockquote]:pl-3 [&_blockquote]:italic',
                  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono',
                  '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3',
                  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
                  '[&_img]:my-3 [&_img]:max-w-full [&_img]:rounded-md',
                  '[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_th]:bg-muted/60',
                  '[&_th]:border [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_td]:border [&_td]:px-2 [&_td]:py-1.5',
                  '[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0',
                  '[&_li[data-type=taskItem]]:flex [&_li[data-type=taskItem]]:items-start [&_li[data-type=taskItem]]:gap-2'
                )
              }
            }}
            onUpdate={({ editor }) => onChange(editor.storage.markdown.getMarkdown())}
            slotAfter={resolvedFeatures.imageResize ? <ImageResizer /> : null}
          >
            {resolvedFeatures.slashCommand ? (
              <EditorCommand className='bg-popover text-popover-foreground z-50 h-auto max-h-80 overflow-y-auto rounded-md border p-1 shadow-lg'>
                <CommandEmpty className='px-2 py-4 text-center text-sm'>没有匹配的内容块</CommandEmpty>
                <CommandList>
                  {suggestionItems.map(item => (
                    <EditorCommandItem
                      key={item.title}
                      value={item.title}
                      onCommand={value => item.command?.(value)}
                      className='hover:bg-muted aria-selected:bg-muted flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm'
                    >
                      <span className='bg-background flex size-9 shrink-0 items-center justify-center rounded-md border'>
                        {item.icon}
                      </span>
                      <span>
                        <span className='block font-medium'>{item.title}</span>
                        <span className='text-muted-foreground block text-xs'>{item.description}</span>
                      </span>
                    </EditorCommandItem>
                  ))}
                </CommandList>
              </EditorCommand>
            ) : null}

            {resolvedFeatures.wordCount ? <EditorWordCount /> : null}
            {hasBubbleMenuFeatures(resolvedFeatures) ? <EditorBubbleMenu features={resolvedFeatures} /> : null}
            {resolvedFeatures.imageUpload ? <ImageUploadInput id={imageInputId} uploadFn={uploadFn} /> : null}
            <EditorInstanceBridge editorRef={editorRef} />
            <ValueSync value={value} />
          </EditorContent>
        </EditorRoot>
      </div>

      <Dialog
        open={Boolean(embedDialog)}
        onOpenChange={open => {
          if (!open) closeEmbedDialog()
        }}
      >
        <DialogContent>
          {embedDialog && (
            <>
              <DialogHeader>
                <DialogTitle>{EMBED_COPY[embedDialog.type].title}</DialogTitle>
                <DialogDescription>{EMBED_COPY[embedDialog.type].description}</DialogDescription>
              </DialogHeader>
              <Input
                value={embedUrl}
                aria-label='媒体地址'
                placeholder={EMBED_COPY[embedDialog.type].placeholder}
                aria-invalid={embedError ? true : undefined}
                onChange={event => {
                  setEmbedUrl(event.target.value)
                  setEmbedError('')
                }}
              />
              {embedError && <p className='text-destructive text-sm'>{embedError}</p>}
              <DialogFooter>
                <Button type='button' variant='outline' onClick={closeEmbedDialog}>
                  取消
                </Button>
                <Button type='button' onClick={insertEmbed}>
                  确认嵌入
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
