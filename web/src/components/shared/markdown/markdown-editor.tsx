'use client'

import { useEffect, useMemo, useState } from 'react'

import Table from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import {
  Command,
  EditorCommand,
  EditorCommandItem,
  EditorContent,
  type EditorInstance,
  EditorRoot,
  type JSONContent,
  Placeholder,
  StarterKit,
  TaskItem,
  TaskList,
  TiptapImage,
  TiptapLink,
  type UploadFn,
  UploadImagesPlugin,
  createImageUpload,
  createSuggestionItems,
  handleCommandNavigation,
  handleImageDrop,
  handleImagePaste,
  renderItems,
  useEditor
} from 'novel'
import { Markdown } from 'tiptap-markdown'
import {
  BoldIcon,
  CheckSquareIcon,
  Code2Icon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  PilcrowIcon,
  QuoteIcon,
  Redo2Icon,
  StrikethroughIcon,
  Undo2Icon,
  type LucideIcon
} from 'lucide-react'
import { toast } from 'sonner'

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

type ImageUploadHandler = (file: File) => Promise<string>

const MAX_PASTED_IMAGE_SIZE = 20 * 1024 * 1024

/** 默认将粘贴图片保存为 Data URL，接入对象存储后可通过 uploadImage 覆盖。 */
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

/** 串行执行 Novel 图片上传，避免连续粘贴时多个占位事务基于同一份旧编辑器状态。 */
const createQueuedImageUpload = (uploadImage?: ImageUploadHandler): UploadFn => {
  let uploadQueue: Promise<void> = Promise.resolve()
  let releaseCurrentUpload: (() => void) | undefined

  const releaseAfterNovelTransaction = () => {
    // Novel 在 onUpload Promise 结算后的微任务中插图；下一个宏任务再释放队列。
    setTimeout(() => {
      releaseCurrentUpload?.()
      releaseCurrentUpload = undefined
    }, 0)
  }

  const runImageUpload = createImageUpload({
    validateFn: file => {
      if (!file.type.startsWith('image/')) {
        toast.error('只能粘贴图片文件')
        releaseAfterNovelTransaction()

        return false
      }

      if (file.size > MAX_PASTED_IMAGE_SIZE) {
        toast.error('图片不能超过 20 MB')
        releaseAfterNovelTransaction()

        return false
      }

      return true
    },
    onUpload: async file => {
      // Novel 先启动自己的 FileReader；等待第二次读取完成，可确保预览占位已经派发。
      const placeholderReady = imageFileToDataUrl(file)

      try {
        const imageUrlPromise = uploadImage ? uploadImage(file) : placeholderReady

        await placeholderReady

        const imageUrl = await imageUrlPromise

        if (!imageUrl) throw new Error('上传结果缺少图片地址')

        toast.success(uploadImage ? '图片上传成功' : '图片已粘贴')

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

const slashCommandItems = createSuggestionItems([
  {
    title: '正文',
    description: '普通文本段落',
    searchTerms: ['text', 'paragraph', 'p'],
    icon: <PilcrowIcon className='size-4' />,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setParagraph().run()
  },
  {
    title: '一级标题',
    description: '页面主标题',
    searchTerms: ['heading', 'h1', 'title'],
    icon: <Heading1Icon className='size-4' />,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run()
  },
  {
    title: '二级标题',
    description: '主要章节标题',
    searchTerms: ['heading', 'h2', 'subtitle'],
    icon: <Heading2Icon className='size-4' />,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run()
  },
  {
    title: '三级标题',
    description: '次级章节标题',
    searchTerms: ['heading', 'h3', 'subtitle'],
    icon: <Heading3Icon className='size-4' />,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run()
  },
  {
    title: '无序列表',
    description: '创建项目符号列表',
    searchTerms: ['bullet', 'list', 'ul'],
    icon: <ListIcon className='size-4' />,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run()
  },
  {
    title: '有序列表',
    description: '创建数字编号列表',
    searchTerms: ['ordered', 'list', 'ol'],
    icon: <ListOrderedIcon className='size-4' />,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run()
  },
  {
    title: '任务列表',
    description: '创建可勾选的待办事项',
    searchTerms: ['todo', 'task', 'checkbox'],
    icon: <CheckSquareIcon className='size-4' />,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run()
  },
  {
    title: '引用',
    description: '突出显示引用内容',
    searchTerms: ['quote', 'blockquote'],
    icon: <QuoteIcon className='size-4' />,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setParagraph().toggleBlockquote().run()
  },
  {
    title: '代码块',
    description: '插入等宽字体代码块',
    searchTerms: ['code', 'codeblock'],
    icon: <Code2Icon className='size-4' />,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
  }
])

const slashCommand = Command.configure({
  suggestion: {
    items: () => slashCommandItems,
    render: renderItems
  }
})

/**
 * Novel 命令菜单使用中文描述，并仅暴露当前评估答案支持持久化的 Markdown 内容块。
 * EditorCommand / EditorCommandItem 必须保留 Novel 原语来传递当前 editor 与 range；列表状态复用 shadcn。
 */
const NovelCommandMenu = () => (
  <EditorCommand className='bg-popover text-popover-foreground z-50 max-h-80 min-w-64 overflow-y-auto rounded-md border p-1 shadow-md'>
    <CommandEmpty className='text-muted-foreground px-3 py-6'>
      没有匹配的内容块
    </CommandEmpty>
    <CommandList>
      {slashCommandItems.map(item => (
        <EditorCommandItem
          key={item.title}
          value={item.title}
          keywords={item.searchTerms}
          aria-label={`${item.title}：${item.description}`}
          className='aria-selected:bg-accent aria-selected:text-accent-foreground flex cursor-pointer items-center gap-3 rounded-sm px-2 py-2 text-sm outline-none'
          onCommand={params => item.command?.(params)}
        >
          <span className='bg-muted flex size-8 shrink-0 items-center justify-center rounded-md'>{item.icon}</span>
          <span className='flex flex-col'>
            <span className='font-medium'>{item.title}</span>
            <span className='text-muted-foreground text-xs'>{item.description}</span>
          </span>
        </EditorCommandItem>
      ))}
    </CommandList>
  </EditorCommand>
)

/** 保持原有受控组件协议：父级重置草稿时，把 Markdown 安静地同步回 Novel 编辑器。 */
const NovelValueSync = ({ value }: { value: string }) => {
  const { editor } = useEditor()

  useEffect(() => {
    if (!editor || editor.storage.markdown.getMarkdown() === value) return

    editor.commands.setContent(value, false)
  }, [editor, value])

  return null
}

const insertMarkdownImage = (editor: EditorInstance, src: string, alt: string) => {
  // 评审答案仍保存 Markdown 字符串，图片节点会序列化为 ![描述](地址)。
  // 始终在当前选区之后插入，避免光标选中已有图片时把旧节点替换掉。
  editor
    .chain()
    .focus()
    .insertContentAt(editor.state.selection.to, { type: 'image', attrs: { src, alt } })
    .run()
}

/** 工具栏订阅 Novel 编辑器事务，确保光标和历史记录变化后按钮状态立即刷新。 */
const NovelMarkdownToolbar = () => {
  const { editor } = useEditor()
  const [, setRevision] = useState(0)
  const [imageDialogOpen, setImageDialogOpen] = useState(false)
  const [imageUrl, setImageUrl] = useState('')
  const [imageAlt, setImageAlt] = useState('')
  const [imageError, setImageError] = useState('')

  useEffect(() => {
    if (!editor) return

    const refresh = () => setRevision(revision => revision + 1)

    editor.on('transaction', refresh)

    return () => {
      editor.off('transaction', refresh)
    }
  }, [editor])

  if (!editor) return null

  const actions: ToolbarAction[] = [
    {
      label: '加粗',
      icon: BoldIcon,
      active: editor.isActive('bold'),
      run: () => editor.chain().focus().toggleBold().run()
    },
    {
      label: '斜体',
      icon: ItalicIcon,
      active: editor.isActive('italic'),
      run: () => editor.chain().focus().toggleItalic().run()
    },
    {
      label: '删除线',
      icon: StrikethroughIcon,
      active: editor.isActive('strike'),
      run: () => editor.chain().focus().toggleStrike().run()
    },
    {
      label: '二级标题',
      icon: Heading2Icon,
      active: editor.isActive('heading', { level: 2 }),
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run()
    },
    {
      label: '无序列表',
      icon: ListIcon,
      active: editor.isActive('bulletList'),
      run: () => editor.chain().focus().toggleBulletList().run()
    },
    {
      label: '有序列表',
      icon: ListOrderedIcon,
      active: editor.isActive('orderedList'),
      run: () => editor.chain().focus().toggleOrderedList().run()
    },
    {
      label: '引用',
      icon: QuoteIcon,
      active: editor.isActive('blockquote'),
      run: () => editor.chain().focus().toggleBlockquote().run()
    },
    {
      label: '行内代码',
      icon: Code2Icon,
      active: editor.isActive('code'),
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

    insertMarkdownImage(editor, src, imageAlt.trim() || '图片')
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
          disabled={!editor.can().chain().focus().undo().run()}
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
          disabled={!editor.can().chain().focus().redo().run()}
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

  /** 上传粘贴或拖入的图片并返回可持久化地址；省略时以内嵌 Data URL 保存。 */
  uploadImage?: ImageUploadHandler
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  className?: string
}

/**
 * Novel.sh Markdown 编辑器：保留 value/onChange 字符串协议，替换原有 Tiptap 3 编辑器实现。
 */
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
  const uploadFn = useMemo(() => createQueuedImageUpload(uploadImage), [uploadImage])

  const extensions = useMemo(
    () => [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder, includeChildren: true }),
      TiptapLink.configure({ openOnClick: false, autolink: false, linkOnPaste: false }),

      // Markdown 图片本质是行内节点；让段落负责写入块间空行，避免图片与后续标题粘连。
      TiptapImage.extend({
        addProseMirrorPlugins() {
          return [
            UploadImagesPlugin({
              imageClass: 'my-3 block max-w-full rounded-md opacity-40'
            })
          ]
        }
      }).configure({
        inline: true,
        allowBase64: true,
        HTMLAttributes: { class: 'my-3 block max-w-full rounded-md' }
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({
        html: false,
        tightLists: true,
        bulletListMarker: '-',
        linkify: false,
        breaks: false,
        transformPastedText: true,
        transformCopiedText: true
      }),
      slashCommand
    ],
    [placeholder]
  )

  // 已提交或无编辑权限时直接走纯展示组件，避免把编辑器交互误当成只读内容的一部分。
  if (disabled) return <MarkdownContent content={value} className={className} />

  // tiptap-markdown 会在编辑器创建前把初始字符串解析成文档；Novel 的类型只声明了 JSON。
  const initialContent = value as unknown as JSONContent

  return (
    <div
      data-slot='markdown-editor'
      aria-invalid={invalid || undefined}
      className={cn(
        'border-input bg-background overflow-hidden rounded-md border shadow-xs transition-[color,box-shadow]',
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
          slotBefore={<NovelMarkdownToolbar />}
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
          }}
          onUpdate={({ editor }) => onChange(editor.storage.markdown.getMarkdown())}
        >
          <NovelCommandMenu />
          <NovelValueSync value={value} />
        </EditorContent>
      </EditorRoot>
    </div>
  )
}

export default MarkdownEditor
