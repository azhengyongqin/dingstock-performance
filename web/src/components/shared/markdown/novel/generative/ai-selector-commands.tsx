'use client'

import { ArrowDownWideNarrowIcon, CheckCheckIcon, RefreshCcwDotIcon, StepForwardIcon, WrapTextIcon } from 'lucide-react'
import { getPrevText, useEditor } from 'novel'

import { CommandGroup, CommandItem, CommandSeparator } from '@/components/ui/command'

const options = [
  { value: 'improve', label: '改善表达', icon: RefreshCcwDotIcon },
  { value: 'fix', label: '修正语法和错字', icon: CheckCheckIcon },
  { value: 'shorter', label: '缩短内容', icon: ArrowDownWideNarrowIcon },
  { value: 'longer', label: '扩展内容', icon: WrapTextIcon }
]

type AISelectorCommandsProps = {
  onSelect: (value: string, option: string) => void
}

/** Novel Ask AI 的预设编辑命令。 */
export const AISelectorCommands = ({ onSelect }: AISelectorCommandsProps) => {
  const { editor } = useEditor()

  if (!editor) return null

  return (
    <>
      <CommandGroup heading='编辑或检查选中内容'>
        {options.map(option => (
          <CommandItem
            key={option.value}
            value={option.value}
            className='gap-2 px-4'
            onSelect={value => {
              const slice = editor.state.selection.content()
              const text = editor.storage.markdown.serializer.serialize(slice.content)

              onSelect(text, value)
            }}
          >
            <option.icon className='size-4 text-purple-500' />
            {option.label}
          </CommandItem>
        ))}
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading='继续写作'>
        <CommandItem
          value='continue'
          className='gap-2 px-4'
          onSelect={() => {
            const text = getPrevText(editor, editor.state.selection.from)

            onSelect(text, 'continue')
          }}
        >
          <StepForwardIcon className='size-4 text-purple-500' />
          续写
        </CommandItem>
      </CommandGroup>
    </>
  )
}
