'use client'

import { useEffect, useState } from 'react'

import { Image } from '@tiptap/extension-image'
import { Placeholder } from '@tiptap/extension-placeholder'
import { TableKit } from '@tiptap/extension-table'
import { TaskItem } from '@tiptap/extension-task-item'
import { TaskList } from '@tiptap/extension-task-list'
import { Markdown } from '@tiptap/markdown'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  BoldIcon,
  Code2Icon,
  Heading2Icon,
  ImageIcon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  Redo2Icon,
  StrikethroughIcon,
  Undo2Icon,
  type LucideIcon
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

import MarkdownContent from './markdown-content'

type ToolbarAction = {
  label: string
  icon: LucideIcon
  active?: boolean
  run: () => void
}

/** 工具栏状态直接订阅编辑器事务，确保光标切换段落时按钮高亮同步更新。 */
const MarkdownToolbar = ({ editor, disabled }: { editor: Editor; disabled?: boolean }) => {
  const [imageDialogOpen, setImageDialogOpen] = useState(false)
  const [imageUrl, setImageUrl] = useState('')
  const [imageAlt, setImageAlt] = useState('')
  const [imageError, setImageError] = useState('')

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      strike: current.isActive('strike'),
      heading: current.isActive('heading', { level: 2 }),
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
      blockquote: current.isActive('blockquote'),
      code: current.isActive('code'),
      canUndo: current.can().chain().focus().undo().run(),
      canRedo: current.can().chain().focus().redo().run()
    })
  })

  const actions: ToolbarAction[] = [
    {
      label: '加粗',
      icon: BoldIcon,
      active: state.bold,
      run: () => editor.chain().focus().toggleBold().run()
    },
    {
      label: '斜体',
      icon: ItalicIcon,
      active: state.italic,
      run: () => editor.chain().focus().toggleItalic().run()
    },
    {
      label: '删除线',
      icon: StrikethroughIcon,
      active: state.strike,
      run: () => editor.chain().focus().toggleStrike().run()
    },
    {
      label: '二级标题',
      icon: Heading2Icon,
      active: state.heading,
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run()
    },
    {
      label: '无序列表',
      icon: ListIcon,
      active: state.bulletList,
      run: () => editor.chain().focus().toggleBulletList().run()
    },
    {
      label: '有序列表',
      icon: ListOrderedIcon,
      active: state.orderedList,
      run: () => editor.chain().focus().toggleOrderedList().run()
    },
    {
      label: '引用',
      icon: QuoteIcon,
      active: state.blockquote,
      run: () => editor.chain().focus().toggleBlockquote().run()
    },
    {
      label: '行内代码',
      icon: Code2Icon,
      active: state.code,
      run: () => editor.chain().focus().toggleCode().run()
    }
  ]

  const handleImageDialogChange = (open: boolean) => {
    setImageDialogOpen(open)
    if (open) return
    setImageUrl('')
    setImageAlt('')
    setImageError('')
  }

  const insertImage = () => {
    const src = imageUrl.trim()

    try {
      const parsedUrl = new URL(src)

      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('unsupported protocol')
    } catch {
      setImageError('请输入有效的 http 或 https 图片地址')

      return
    }

    // 评审答案仍保存 Markdown 字符串，图片节点会由 Tiptap 序列化为 ![描述](地址)。
    editor
      .chain()
      .focus()
      .setImage({ src, alt: imageAlt.trim() || '图片' })
      .run()
    handleImageDialogChange(false)
  }

  return (
    <>
      <div
        data-slot='markdown-toolbar'
        className='bg-muted/30 flex min-h-10 items-center gap-0.5 overflow-x-auto border-b p-1'
      >
        {actions.map(action => {
          const Icon = action.icon

          return (
            <Button
              key={action.label}
              type='button'
              size='icon-sm'
              variant={action.active ? 'secondary' : 'ghost'}
              aria-label={action.label}
              aria-pressed={action.active}
              title={action.label}
              disabled={disabled}
              onClick={action.run}
            >
              <Icon className='size-4' />
            </Button>
          )
        })}
        <Separator orientation='vertical' className='mx-1 h-6' />
        <Button
          type='button'
          size='icon-sm'
          variant='ghost'
          aria-label='插入图片'
          title='插入图片'
          disabled={disabled}
          onClick={() => setImageDialogOpen(true)}
        >
          <ImageIcon className='size-4' />
        </Button>
        <Separator orientation='vertical' className='mx-1 h-6' />
        <Button
          type='button'
          size='icon-sm'
          variant='ghost'
          aria-label='撤销'
          title='撤销'
          disabled={disabled || !state.canUndo}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2Icon className='size-4' />
        </Button>
        <Button
          type='button'
          size='icon-sm'
          variant='ghost'
          aria-label='重做'
          title='重做'
          disabled={disabled || !state.canRedo}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2Icon className='size-4' />
        </Button>
      </div>

      <Dialog open={imageDialogOpen} onOpenChange={handleImageDialogChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>插入图片</DialogTitle>
            <DialogDescription>填写可公开访问的图片地址，保存后会以 Markdown 图片语法持久化。</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={imageError ? true : undefined}>
              <FieldLabel htmlFor='markdown-image-url'>图片地址</FieldLabel>
              <Input
                id='markdown-image-url'
                aria-label='图片地址'
                value={imageUrl}
                placeholder='https://example.com/image.png'
                aria-invalid={imageError ? true : undefined}
                onChange={event => {
                  setImageUrl(event.target.value)
                  setImageError('')
                }}
              />
              {imageError && <FieldDescription className='text-destructive'>{imageError}</FieldDescription>}
            </Field>
            <Field>
              <FieldLabel htmlFor='markdown-image-alt'>图片描述</FieldLabel>
              <Input
                id='markdown-image-alt'
                aria-label='图片描述'
                value={imageAlt}
                placeholder='例如：绩效结果趋势图'
                onChange={event => setImageAlt(event.target.value)}
              />
              <FieldDescription>用于无障碍阅读；不填写时默认为“图片”。</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => handleImageDialogChange(false)}>
              取消
            </Button>
            <Button type='button' onClick={insertImage}>
              确认插入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export type MarkdownEditorProps = {
  value: string
  onChange: (markdown: string) => void
  ariaLabel: string
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  className?: string
}

/**
 * Tiptap Markdown 编辑器：界面为富文本，输入输出始终是 Markdown 字符串，兼容现有评估答案协议。
 */
const MarkdownEditor = ({
  value,
  onChange,
  ariaLabel,
  placeholder = '请输入内容…',
  disabled,
  invalid,
  className
}: MarkdownEditorProps) => {
  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder }),
      Image,
      TableKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ markedOptions: { gfm: true } })
    ],
    content: value,
    contentType: 'markdown',
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': ariaLabel,
        'aria-multiline': 'true',
        class: cn(
          'tiptap min-h-36 px-3 py-3 text-sm outline-none',
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
    },
    onUpdate: ({ editor: current }) => onChange(current.getMarkdown())
  })

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!disabled)
  }, [disabled, editor])

  useEffect(() => {
    if (!editor || editor.getMarkdown() === value) return

    // 草稿加载或父级重置时从 Markdown 重新解析，不触发一次多余的 onChange。
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false })
  }, [editor, value])

  // 已提交或无编辑权限时直接走纯展示组件，避免把禁用工具栏误当成只读内容的一部分。
  if (disabled) return <MarkdownContent content={value} className={className} />

  return (
    <div
      data-slot='markdown-editor'
      data-disabled={disabled || undefined}
      aria-invalid={invalid || undefined}
      className={cn(
        'border-input bg-background overflow-hidden rounded-md border shadow-xs transition-[color,box-shadow]',
        'focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-3',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        'data-[disabled=true]:bg-muted/40 data-[disabled=true]:opacity-70',
        className
      )}
    >
      {editor && <MarkdownToolbar editor={editor} disabled={disabled} />}
      <EditorContent editor={editor} />
    </div>
  )
}

export default MarkdownEditor
