'use client'

import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import { EditorBubbleItem, useEditor } from 'novel'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

type ColorMenuItem = {
  name: string
  color: string
}

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

type ColorSelectorProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Novel 源码 ColorSelector，保留文字色和多色高亮两组能力。 */
export const ColorSelector = ({ open, onOpenChange }: ColorSelectorProps) => {
  const { editor } = useEditor()

  if (!editor) return null

  const activeColor = TEXT_COLORS.find(item => editor.isActive('textStyle', { color: item.color }))
  const activeHighlight = HIGHLIGHT_COLORS.find(item => editor.isActive('highlight', { color: item.color }))

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={<Button type='button' size='sm' variant='ghost' className='rounded-none' />}>
        <span
          className='rounded-sm px-1'
          style={{ color: activeColor?.color, backgroundColor: activeHighlight?.color }}
        >
          A
        </span>
        <ChevronDownIcon className='size-4' />
      </PopoverTrigger>
      <PopoverContent align='start' sideOffset={5} className='max-h-80 w-48 gap-0 overflow-y-auto p-1'>
        <div className='text-muted-foreground px-2 py-1 text-sm font-semibold'>文字颜色</div>
        {TEXT_COLORS.map(item => (
          <EditorBubbleItem
            key={item.name}
            asChild
            onSelect={() => {
              editor.commands.unsetColor()
              if (item.name !== '默认') editor.chain().focus().setColor(item.color).run()
              onOpenChange(false)
            }}
          >
            <Button type='button' variant='ghost' size='sm' className='w-full justify-between px-2 font-normal'>
              <span className='flex items-center gap-2'>
                <span className='rounded-sm border px-2 py-px font-medium' style={{ color: item.color }}>
                  A
                </span>
                {item.name}
              </span>
              {activeColor?.name === item.name && <CheckIcon className='size-4' />}
            </Button>
          </EditorBubbleItem>
        ))}

        <div className='text-muted-foreground mt-1 px-2 py-1 text-sm font-semibold'>背景高亮</div>
        {HIGHLIGHT_COLORS.map(item => (
          <EditorBubbleItem
            key={item.name}
            asChild
            onSelect={() => {
              editor.commands.unsetHighlight()
              if (item.name !== '默认') editor.chain().focus().setHighlight({ color: item.color }).run()
              onOpenChange(false)
            }}
          >
            <Button type='button' variant='ghost' size='sm' className='w-full justify-between px-2 font-normal'>
              <span className='flex items-center gap-2'>
                <span className='rounded-sm border px-2 py-px font-medium' style={{ backgroundColor: item.color }}>
                  A
                </span>
                {item.name}
              </span>
              {activeHighlight?.name === item.name && <CheckIcon className='size-4' />}
            </Button>
          </EditorBubbleItem>
        ))}
      </PopoverContent>
    </Popover>
  )
}
