'use client'

import { useEffect } from 'react'

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
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

type ToolbarAction = {
  label: string
  icon: LucideIcon
  active?: boolean
  run: () => void
}

/** 工具栏状态直接订阅编辑器事务，确保光标切换段落时按钮高亮同步更新。 */
const MarkdownToolbar = ({ editor, disabled }: { editor: Editor; disabled?: boolean }) => {
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

  return (
    <div className='bg-muted/30 flex min-h-10 items-center gap-0.5 overflow-x-auto border-b p-1'>
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
