'use client'

import { useState } from 'react'

import { useCompletion } from 'ai/react'
import { ArrowUpIcon, LoaderCircleIcon, SparklesIcon } from 'lucide-react'
import { addAIHighlight, useEditor } from 'novel'
import ReactMarkdown from 'react-markdown'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Command, CommandInput } from '@/components/ui/command'
import { ScrollArea } from '@/components/ui/scroll-area'
import { sameOriginApiFetch } from '@/lib/api'

import { AICompletionCommands } from './ai-completion-commands'
import { AISelectorCommands } from './ai-selector-commands'

type AISelectorProps = {
  onOpenChange: (open: boolean) => void
}

/** Novel 源码 Ask AI 面板，继续使用其 completion data-stream 协议。 */
export const AISelector = ({ onOpenChange }: AISelectorProps) => {
  const { editor } = useEditor()
  const [inputValue, setInputValue] = useState('')

  const { completion, complete, isLoading } = useCompletion({
    api: '/api/generate',
    fetch: sameOriginApiFetch,
    onResponse: response => {
      if (response.status === 429) toast.error('今天的 AI 请求次数已达到上限')
    },
    onError: error => toast.error(error.message)
  })

  if (!editor) return null

  const hasCompletion = completion.length > 0

  const submitCustomCommand = async () => {
    const command = inputValue.trim()

    if (!command) return

    if (completion) {
      await complete(completion, { body: { option: 'zap', command } })
    } else {
      const slice = editor.state.selection.content()
      const text = editor.storage.markdown.serializer.serialize(slice.content)

      await complete(text, { body: { option: 'zap', command } })
    }

    setInputValue('')
  }

  return (
    <Command className='w-[350px] rounded-md'>
      {hasCompletion && (
        <ScrollArea className='max-h-96'>
          <div className='prose prose-sm dark:prose-invert max-w-none px-4 py-3'>
            <ReactMarkdown>{completion}</ReactMarkdown>
          </div>
        </ScrollArea>
      )}

      {isLoading && (
        <div className='text-muted-foreground flex h-12 items-center px-4 text-sm font-medium'>
          <SparklesIcon className='mr-2 size-4 text-purple-500' />
          AI 正在思考
          <LoaderCircleIcon className='ml-2 size-4 animate-spin' />
        </div>
      )}

      {!isLoading && (
        <>
          <div className='relative'>
            <CommandInput
              value={inputValue}
              onValueChange={setInputValue}
              autoFocus
              placeholder={hasCompletion ? '告诉 AI 下一步怎么改' : '让 AI 编辑或生成内容…'}
              onFocus={() => addAIHighlight(editor)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void submitCustomCommand()
                }
              }}
            />
            <Button
              type='button'
              size='icon-sm'
              aria-label='发送 AI 指令'
              className='absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-purple-500 hover:bg-purple-700'
              onClick={() => void submitCustomCommand()}
            >
              <ArrowUpIcon className='size-4' />
            </Button>
          </div>

          {hasCompletion ? (
            <AICompletionCommands
              completion={completion}
              onDiscard={() => {
                editor.chain().unsetHighlight().focus().run()
                onOpenChange(false)
              }}
            />
          ) : (
            <AISelectorCommands
              onSelect={(value, option) => {
                void complete(value, { body: { option } })
              }}
            />
          )}
        </>
      )}
    </Command>
  )
}
