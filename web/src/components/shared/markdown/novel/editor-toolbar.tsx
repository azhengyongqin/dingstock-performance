'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  BoldIcon,
  CheckIcon,
  CheckSquareIcon,
  ChevronDownIcon,
  Code2Icon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  Heading4Icon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  MessageCircleIcon,
  PilcrowIcon,
  QuoteIcon,
  Redo2Icon,
  SigmaIcon,
  StrikethroughIcon,
  Trash2Icon,
  UnderlineIcon,
  Undo2Icon,
  VideoIcon,
  type LucideIcon
} from 'lucide-react'
import { type EditorInstance, useEditor } from 'novel'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

import type { EmbedType } from './slash-command'
import type { ResolvedMarkdownEditorFeatures } from './types'

type EditorToolbarProps = {
  features: ResolvedMarkdownEditorFeatures
  onRequestImageUpload: () => void
  onRequestEmbed: (type: EmbedType, editor: EditorInstance) => void
}

type NodeItem = {
  name: string
  icon: LucideIcon
  command: (editor: EditorInstance) => void
  isActive: (editor: EditorInstance) => boolean
}

type TextAction = {
  label: string
  icon: LucideIcon
  command: (editor: EditorInstance) => void
  isActive: (editor: EditorInstance) => boolean
}

type ColorMenuItem = {
  name: string
  color: string
}

const NODE_ITEMS: NodeItem[] = [
  {
    name: '正文',
    icon: PilcrowIcon,
    command: editor => editor.chain().focus().clearNodes().run(),
    isActive: editor =>
      editor.isActive('paragraph') && !editor.isActive('bulletList') && !editor.isActive('orderedList')
  },
  {
    name: '一级标题',
    icon: Heading1Icon,
    command: editor => editor.chain().focus().clearNodes().toggleHeading({ level: 1 }).run(),
    isActive: editor => editor.isActive('heading', { level: 1 })
  },
  {
    name: '二级标题',
    icon: Heading2Icon,
    command: editor => editor.chain().focus().clearNodes().toggleHeading({ level: 2 }).run(),
    isActive: editor => editor.isActive('heading', { level: 2 })
  },
  {
    name: '三级标题',
    icon: Heading3Icon,
    command: editor => editor.chain().focus().clearNodes().toggleHeading({ level: 3 }).run(),
    isActive: editor => editor.isActive('heading', { level: 3 })
  },
  {
    name: '四级标题',
    icon: Heading4Icon,
    command: editor => editor.chain().focus().clearNodes().toggleHeading({ level: 4 }).run(),
    isActive: editor => editor.isActive('heading', { level: 4 })
  },
  {
    name: '待办列表',
    icon: CheckSquareIcon,
    command: editor => editor.chain().focus().clearNodes().toggleTaskList().run(),
    isActive: editor => editor.isActive('taskItem')
  },
  {
    name: '无序列表',
    icon: ListIcon,
    command: editor => editor.chain().focus().clearNodes().toggleBulletList().run(),
    isActive: editor => editor.isActive('bulletList')
  },
  {
    name: '有序列表',
    icon: ListOrderedIcon,
    command: editor => editor.chain().focus().clearNodes().toggleOrderedList().run(),
    isActive: editor => editor.isActive('orderedList')
  },
  {
    name: '引用',
    icon: QuoteIcon,
    command: editor => editor.chain().focus().clearNodes().toggleBlockquote().run(),
    isActive: editor => editor.isActive('blockquote')
  },
  {
    name: '代码块',
    icon: Code2Icon,
    command: editor => editor.chain().focus().clearNodes().toggleCodeBlock().run(),
    isActive: editor => editor.isActive('codeBlock')
  }
]

const TEXT_ACTIONS: TextAction[] = [
  {
    label: '加粗',
    icon: BoldIcon,
    command: editor => editor.chain().focus().toggleBold().run(),
    isActive: editor => editor.isActive('bold')
  },
  {
    label: '斜体',
    icon: ItalicIcon,
    command: editor => editor.chain().focus().toggleItalic().run(),
    isActive: editor => editor.isActive('italic')
  },
  {
    label: '下划线',
    icon: UnderlineIcon,
    command: editor => editor.chain().focus().toggleUnderline().run(),
    isActive: editor => editor.isActive('underline')
  },
  {
    label: '删除线',
    icon: StrikethroughIcon,
    command: editor => editor.chain().focus().toggleStrike().run(),
    isActive: editor => editor.isActive('strike')
  },
  {
    label: '行内代码',
    icon: Code2Icon,
    command: editor => editor.chain().focus().toggleCode().run(),
    isActive: editor => editor.isActive('code')
  }
]

const TEXT_COLORS: ColorMenuItem[] = [
  { name: '默认', color: 'var(--foreground)' },
  { name: '紫色', color: '#9333ea' },
  { name: '红色', color: '#e00000' },
  { name: '黄色', color: '#eab308' },
  { name: '蓝色', color: '#2563eb' },
  { name: '绿色', color: '#008a00' },
  { name: '橙色', color: '#ffa500' },
  { name: '粉色', color: '#ba4081' },
  { name: '灰色', color: '#a8a29e' }
]

const HIGHLIGHT_COLORS: ColorMenuItem[] = [
  { name: '默认', color: 'var(--novel-highlight-default)' },
  { name: '紫色', color: 'var(--novel-highlight-purple)' },
  { name: '红色', color: 'var(--novel-highlight-red)' },
  { name: '黄色', color: 'var(--novel-highlight-yellow)' },
  { name: '蓝色', color: 'var(--novel-highlight-blue)' },
  { name: '绿色', color: 'var(--novel-highlight-green)' },
  { name: '橙色', color: 'var(--novel-highlight-orange)' },
  { name: '粉色', color: 'var(--novel-highlight-pink)' },
  { name: '灰色', color: 'var(--novel-highlight-gray)' }
]

const getUrlFromString = (value: string) => {
  try {
    return new URL(value).toString()
  } catch {
    try {
      if (value.includes('.') && !value.includes(' ')) return new URL(`https://${value}`).toString()
    } catch {
      return null
    }
  }

  return null
}

const ToolbarButton = ({
  label,
  active,
  onClick,
  children
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) => (
  <Button
    type='button'
    size='icon-sm'
    variant={active ? 'secondary' : 'ghost'}
    className='rounded-md'
    aria-label={label}
    title={label}
    onClick={onClick}
  >
    {children}
  </Button>
)

/** 顶部固定工具栏：块类型、行内格式、链接、颜色、公式、图片与媒体。 */
export const EditorToolbar = ({ features, onRequestImageUpload, onRequestEmbed }: EditorToolbarProps) => {
  const { editor } = useEditor()
  const linkInputRef = useRef<HTMLInputElement>(null)
  const [nodeOpen, setNodeOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [colorOpen, setColorOpen] = useState(false)

  // 订阅选区变化，保证按钮 active 态随光标更新。
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!editor) return

    const refresh = () => setTick(value => value + 1)

    editor.on('selectionUpdate', refresh)
    editor.on('transaction', refresh)

    return () => {
      editor.off('selectionUpdate', refresh)
      editor.off('transaction', refresh)
    }
  }, [editor])

  useEffect(() => {
    if (linkOpen) linkInputRef.current?.focus()
  }, [linkOpen])

  if (!editor) return null

  const activeNode = NODE_ITEMS.findLast(item => item.isActive(editor)) ?? NODE_ITEMS[0]
  const activeColor = TEXT_COLORS.find(item => editor.isActive('textStyle', { color: item.color }))
  const activeHighlight = HIGHLIGHT_COLORS.find(item => editor.isActive('highlight', { color: item.color }))
  const currentHref = editor.getAttributes('link').href as string | undefined

  const groups: ReactNode[] = [
    <div key='history' className='flex items-center gap-0.5'>
      <ToolbarButton label='撤销' onClick={() => editor.chain().focus().undo().run()}>
        <Undo2Icon className='size-4' />
      </ToolbarButton>
      <ToolbarButton label='重做' onClick={() => editor.chain().focus().redo().run()}>
        <Redo2Icon className='size-4' />
      </ToolbarButton>
    </div>
  ]

  if (features.nodeSelector) {
    groups.push(
      <Popover key='node' open={nodeOpen} onOpenChange={setNodeOpen}>
        <PopoverTrigger
          render={<Button type='button' size='sm' variant='ghost' className='h-8 gap-1 rounded-md px-2' />}
        >
          <activeNode.icon className='size-4' />
          <span className='max-w-20 truncate text-xs'>{activeNode.name}</span>
          <ChevronDownIcon className='size-3.5 opacity-60' />
        </PopoverTrigger>
        <PopoverContent align='start' sideOffset={6} className='w-48 gap-0 p-1'>
          {NODE_ITEMS.map(item => (
            <Button
              key={item.name}
              type='button'
              variant='ghost'
              size='sm'
              className='w-full justify-between px-2 font-normal'
              onClick={() => {
                item.command(editor)
                setNodeOpen(false)
              }}
            >
              <span className='flex items-center gap-2'>
                <span className='rounded-sm border p-1'>
                  <item.icon className='size-3' />
                </span>
                {item.name}
              </span>
              {activeNode.name === item.name ? <CheckIcon className='size-4' /> : null}
            </Button>
          ))}
        </PopoverContent>
      </Popover>
    )
  }

  if (features.textFormatting) {
    groups.push(
      <div key='text' className='flex items-center gap-0.5'>
        {TEXT_ACTIONS.map(action => (
          <ToolbarButton
            key={action.label}
            label={action.label}
            active={action.isActive(editor)}
            onClick={() => action.command(editor)}
          >
            <action.icon className='size-4' />
          </ToolbarButton>
        ))}
      </div>
    )
  }

  if (features.link) {
    groups.push(
      <Popover key='link' open={linkOpen} onOpenChange={setLinkOpen}>
        <PopoverTrigger
          render={
            <Button
              type='button'
              size='sm'
              variant={editor.isActive('link') ? 'secondary' : 'ghost'}
              className='h-8 gap-1 rounded-md px-2'
            />
          }
        >
          <LinkIcon className={cn('size-4', editor.isActive('link') && 'text-primary')} />
          <span className='text-xs'>链接</span>
        </PopoverTrigger>
        <PopoverContent align='start' sideOffset={6} className='w-72 gap-0 p-1'>
          <form
            className='flex items-center gap-1'
            onSubmit={event => {
              event.preventDefault()

              const formData = new FormData(event.currentTarget)
              const url = getUrlFromString(String(formData.get('href') ?? ''))

              if (!url) return

              editor.chain().focus().setLink({ href: url }).run()
              setLinkOpen(false)
            }}
          >
            <Input
              ref={linkInputRef}
              name='href'
              aria-label='链接地址'
              placeholder='粘贴链接地址'
              defaultValue={currentHref ?? ''}
              className='h-8 flex-1'
            />
            {currentHref ? (
              <Button
                type='button'
                size='icon-sm'
                variant='destructive'
                aria-label='移除链接'
                onClick={() => {
                  editor.chain().focus().unsetLink().run()
                  setLinkOpen(false)
                }}
              >
                <Trash2Icon className='size-4' />
              </Button>
            ) : (
              <Button type='submit' size='icon-sm' aria-label='确认链接'>
                <CheckIcon className='size-4' />
              </Button>
            )}
          </form>
        </PopoverContent>
      </Popover>
    )
  }

  if (features.color) {
    groups.push(
      <Popover key='color' open={colorOpen} onOpenChange={setColorOpen}>
        <PopoverTrigger render={<Button type='button' size='sm' variant='ghost' className='h-8 gap-1 rounded-md px-2' />}>
          <span
            className='rounded-sm px-1 text-xs font-semibold'
            style={{ color: activeColor?.color, backgroundColor: activeHighlight?.color }}
          >
            A
          </span>
          <ChevronDownIcon className='size-3.5 opacity-60' />
        </PopoverTrigger>
        <PopoverContent align='start' sideOffset={6} className='max-h-80 w-48 gap-0 overflow-y-auto p-1'>
          <div className='text-muted-foreground px-2 py-1 text-xs font-semibold'>文字颜色</div>
          {TEXT_COLORS.map(item => (
            <Button
              key={`text-${item.name}`}
              type='button'
              variant='ghost'
              size='sm'
              className='w-full justify-between px-2 font-normal'
              onClick={() => {
                editor.commands.unsetColor()
                if (item.name !== '默认') editor.chain().focus().setColor(item.color).run()
                setColorOpen(false)
              }}
            >
              <span className='flex items-center gap-2'>
                <span className='rounded-sm border px-2 py-px font-medium' style={{ color: item.color }}>
                  A
                </span>
                {item.name}
              </span>
              {activeColor?.name === item.name ? <CheckIcon className='size-4' /> : null}
            </Button>
          ))}
          <div className='text-muted-foreground mt-1 px-2 py-1 text-xs font-semibold'>背景高亮</div>
          {HIGHLIGHT_COLORS.map(item => (
            <Button
              key={`highlight-${item.name}`}
              type='button'
              variant='ghost'
              size='sm'
              className='w-full justify-between px-2 font-normal'
              onClick={() => {
                editor.commands.unsetHighlight()
                if (item.name !== '默认') editor.chain().focus().setHighlight({ color: item.color }).run()
                setColorOpen(false)
              }}
            >
              <span className='flex items-center gap-2'>
                <span className='rounded-sm border px-2 py-px font-medium' style={{ backgroundColor: item.color }}>
                  A
                </span>
                {item.name}
              </span>
              {activeHighlight?.name === item.name ? <CheckIcon className='size-4' /> : null}
            </Button>
          ))}
        </PopoverContent>
      </Popover>
    )
  }

  if (features.math) {
    groups.push(
      <ToolbarButton
        key='math'
        label='数学公式'
        active={editor.isActive('math')}
        onClick={() => {
          if (editor.isActive('math')) {
            editor.chain().focus().unsetLatex().run()

            return
          }

          const { from, to } = editor.state.selection
          const latex = editor.state.doc.textBetween(from, to)

          if (latex) editor.chain().focus().setLatex({ latex }).run()
        }}
      >
        <SigmaIcon className={cn('size-4', editor.isActive('math') && 'text-primary')} />
      </ToolbarButton>
    )
  }

  if (features.imageUpload || features.mediaEmbed) {
    groups.push(
      <div key='media' className='flex items-center gap-0.5'>
        {features.imageUpload ? (
          <ToolbarButton label='上传图片' onClick={onRequestImageUpload}>
            <ImageIcon className='size-4' />
          </ToolbarButton>
        ) : null}
        {features.mediaEmbed ? (
          <>
            <ToolbarButton label='嵌入 YouTube' onClick={() => onRequestEmbed('youtube', editor)}>
              <VideoIcon className='size-4' />
            </ToolbarButton>
            <ToolbarButton label='嵌入 Twitter' onClick={() => onRequestEmbed('twitter', editor)}>
              <MessageCircleIcon className='size-4' />
            </ToolbarButton>
          </>
        ) : null}
      </div>
    )
  }

  return (
    <div
      data-slot='markdown-toolbar'
      role='toolbar'
      aria-label='Markdown 编辑工具栏'
      className='bg-muted/40 flex flex-wrap items-center gap-1 border-b px-1.5 py-1'
      onMouseDown={event => {
        // 点击工具栏时保留编辑器选区，避免格式命令作用到错误位置。
        event.preventDefault()
      }}
    >
      {groups.map((group, index) => (
        <div key={index} className='flex items-center gap-1'>
          {index > 0 ? <Separator orientation='vertical' className='mx-0.5 data-[orientation=vertical]:h-5' /> : null}
          {group}
        </div>
      ))}
    </div>
  )
}
