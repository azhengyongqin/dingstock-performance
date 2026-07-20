'use client'

import { Fragment, type ReactNode, useEffect } from 'react'

import { SparklesIcon } from 'lucide-react'
import { EditorBubble, removeAIHighlight, useEditor } from 'novel'

import { Button } from '@/components/ui/button'

import { AISelector } from './ai-selector'

type GenerativeMenuSwitchProps = {
  children: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void

  /** 关闭时不展示 Ask AI 入口，仍渲染其余格式菜单 */
  askAi?: boolean
}

/** 在普通格式菜单和 Novel Ask AI 面板之间切换。 */
export const GenerativeMenuSwitch = ({
  children,
  open,
  onOpenChange,
  askAi = true
}: GenerativeMenuSwitchProps) => {
  const { editor } = useEditor()

  useEffect(() => {
    if (!open && editor) removeAIHighlight(editor)
  }, [editor, open])

  if (!editor) return null

  return (
    <EditorBubble
      tippyOptions={{
        placement: open && askAi ? 'bottom-start' : 'top',
        onHidden: () => {
          onOpenChange(false)
          editor.chain().unsetHighlight().run()
        }
      }}
      className='bg-popover text-popover-foreground flex w-fit max-w-[90vw] overflow-hidden rounded-md border shadow-lg'
    >
      {askAi && open ? (
        <AISelector onOpenChange={onOpenChange} />
      ) : (
        <Fragment>
          {askAi && (
            <Button
              type='button'
              size='sm'
              variant='ghost'
              className='gap-1 rounded-none text-purple-500'
              onClick={() => onOpenChange(true)}
            >
              <SparklesIcon className='size-4' />
              Ask AI
            </Button>
          )}
          {children}
        </Fragment>
      )}
    </EditorBubble>
  )
}
