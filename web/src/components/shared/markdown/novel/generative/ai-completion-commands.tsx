'use client'

import { CheckIcon, TextQuoteIcon, Trash2Icon } from 'lucide-react'
import { useEditor } from 'novel'

import { CommandGroup, CommandItem, CommandSeparator } from '@/components/ui/command'

type AICompletionCommandsProps = {
  completion: string
  onDiscard: () => void
}

/** Novel 源码中的 AI 结果操作：替换选区、向后插入或丢弃。 */
export const AICompletionCommands = ({ completion, onDiscard }: AICompletionCommandsProps) => {
  const { editor } = useEditor()

  if (!editor) return null

  return (
    <>
      <CommandGroup>
        <CommandItem
          value='replace'
          className='gap-2 px-4'
          onSelect={() => {
            const { from, to } = editor.state.selection

            editor.chain().focus().insertContentAt({ from, to }, completion).run()
          }}
        >
          <CheckIcon className='text-muted-foreground size-4' />
          替换选中内容
        </CommandItem>
        <CommandItem
          value='insert'
          className='gap-2 px-4'
          onSelect={() => {
            const { to } = editor.state.selection

            editor.chain().focus().insertContentAt(to, `\n\n${completion}`).run()
          }}
        >
          <TextQuoteIcon className='text-muted-foreground size-4' />
          插入到下方
        </CommandItem>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup>
        <CommandItem value='discard' className='gap-2 px-4' onSelect={onDiscard}>
          <Trash2Icon className='text-muted-foreground size-4' />
          丢弃结果
        </CommandItem>
      </CommandGroup>
    </>
  )
}
