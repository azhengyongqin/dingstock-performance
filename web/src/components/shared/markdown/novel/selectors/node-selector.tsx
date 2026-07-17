'use client'

import {
  CheckIcon,
  CheckSquareIcon,
  ChevronDownIcon,
  Code2Icon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ListIcon,
  ListOrderedIcon,
  PilcrowIcon,
  QuoteIcon,
  type LucideIcon
} from 'lucide-react'
import { type EditorInstance, EditorBubbleItem, useEditor } from 'novel'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

type SelectorItem = {
  name: string
  icon: LucideIcon
  command: (editor: EditorInstance) => void
  isActive: (editor: EditorInstance) => boolean
}

const items: SelectorItem[] = [
  {
    name: '正文',
    icon: PilcrowIcon,
    command: editor => editor.chain().focus().clearNodes().run(),
    isActive: editor =>
      editor.isActive('paragraph') &&
      !editor.isActive('bulletList') &&
      !editor.isActive('orderedList')
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

type NodeSelectorProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** 从 Novel 源码 NodeSelector 移植的块类型选择器。 */
export const NodeSelector = ({ open, onOpenChange }: NodeSelectorProps) => {
  const { editor } = useEditor()

  if (!editor) return null

  const activeItem = items.findLast(item => item.isActive(editor)) ?? items[0]

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={<Button type='button' size='sm' variant='ghost' className='rounded-none' />}>
        <span>{activeItem.name}</span>
        <ChevronDownIcon className='size-4' />
      </PopoverTrigger>
      <PopoverContent sideOffset={5} align='start' className='w-48 gap-0 p-1'>
        {items.map(item => (
          <EditorBubbleItem
            key={item.name}
            onSelect={currentEditor => {
              item.command(currentEditor)
              onOpenChange(false)
            }}
            className='hover:bg-muted flex cursor-pointer items-center justify-between rounded-sm px-2 py-1.5 text-sm'
          >
            <span className='flex items-center gap-2'>
              <span className='rounded-sm border p-1'>
                <item.icon className='size-3' />
              </span>
              {item.name}
            </span>
            {activeItem.name === item.name && <CheckIcon className='size-4' />}
          </EditorBubbleItem>
        ))}
      </PopoverContent>
    </Popover>
  )
}
