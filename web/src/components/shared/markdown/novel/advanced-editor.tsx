'use client'

import { useCallback, useEffect, useId, useMemo } from 'react'

import {
  EditorCommand,
  EditorCommandItem,
  EditorContent,
  EditorRoot,
  type JSONContent,
  type UploadFn,
  handleCommandNavigation,
  handleImageDrop,
  handleImagePaste,
  useEditor
} from 'novel'

import { CommandEmpty, CommandList } from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import { EditorBubbleMenu } from './editor-bubble-menu'
import { createDefaultExtensions } from './extensions'
import { createNovelImageUpload } from './image-upload'
import { createSlashCommand } from './slash-command'
import type { ImageUploadHandler } from './types'

type ValueSyncProps = {
  value: string
}

type ImageUploadInputProps = {
  id: string
  uploadFn: UploadFn
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

export type AdvancedEditorProps = {
  value: string
  onChange: (markdown: string) => void
  ariaLabel: string
  uploadImage?: ImageUploadHandler
  placeholder: string
  invalid?: boolean
  className?: string
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
  className
}: AdvancedEditorProps) => {
  const imageInputId = useId()
  const uploadFn = useMemo(() => createNovelImageUpload(uploadImage), [uploadImage])

  const requestImageUpload = useCallback(() => {
    document.getElementById(imageInputId)?.click()
  }, [imageInputId])

  const { slashCommand, suggestionItems } = useMemo(
    () => createSlashCommand(requestImageUpload),
    [requestImageUpload]
  )

  const extensions = useMemo(
    () => [...createDefaultExtensions({ placeholder }), slashCommand],
    [placeholder, slashCommand]
  )

  // tiptap-markdown 会在编辑器创建前解析字符串；Novel 的声明仍只接受 JSONContent。
  const initialContent = value as unknown as JSONContent

  return (
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
      <EditorRoot>
        <EditorContent
          initialContent={initialContent}
          immediatelyRender={false}
          extensions={extensions}
          className='relative'
          editorProps={{
            handleDOMEvents: {
              keydown: (_view, event) => handleCommandNavigation(event)
            },
            handlePaste: (view, event) => handleImagePaste(view, event, uploadFn),
            handleDrop: (view, event, _slice, moved) =>
              handleImageDrop(view, event, moved, uploadFn),
            attributes: {
              role: 'textbox',
              'aria-label': ariaLabel,
              'aria-multiline': 'true',
              class: cn(
                'tiptap min-h-36 px-4 py-4 text-sm outline-none',
                '[&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-bold',
                '[&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold',
                '[&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold',
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
        >
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

          <EditorBubbleMenu />
          <ImageUploadInput id={imageInputId} uploadFn={uploadFn} />
          <ValueSync value={value} />
        </EditorContent>
      </EditorRoot>
    </div>
  )
}
