'use client'

import {
  BoldIcon,
  Code2Icon,
  ItalicIcon,
  StrikethroughIcon,
  type LucideIcon
} from 'lucide-react'
import { type EditorInstance, EditorBubbleItem, useEditor } from 'novel'

import { Button } from '@/components/ui/button'

type TextAction = {
  label: string
  icon: LucideIcon
  command: (editor: EditorInstance) => void
  isActive: (editor: EditorInstance) => boolean
}

const actions: TextAction[] = [
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

/** 从 Novel 源码 TextButtons 移植的 Markdown 行内格式按钮。 */
export const TextButtons = () => {
  const { editor } = useEditor()

  if (!editor) return null

  return (
    <div className='flex'>
      {actions.map(action => (
        <EditorBubbleItem
          key={action.label}
          asChild
          onSelect={currentEditor => action.command(currentEditor)}
        >
          <Button
            type='button'
            size='icon-sm'
            variant={action.isActive(editor) ? 'secondary' : 'ghost'}
            className='rounded-none'
            aria-label={action.label}
            title={action.label}
          >
            <action.icon className='size-4' />
          </Button>
        </EditorBubbleItem>
      ))}
    </div>
  )
}
