'use client'

import { SigmaIcon } from 'lucide-react'
import { useEditor } from 'novel'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** 把选中的 LaTeX 文本转换为 Novel 数学公式节点，或还原为文本。 */
export const MathSelector = () => {
  const { editor } = useEditor()

  if (!editor) return null

  return (
    <Button
      type='button'
      variant='ghost'
      size='icon-sm'
      className='rounded-none'
      aria-label='数学公式'
      title='数学公式'
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
    </Button>
  )
}
