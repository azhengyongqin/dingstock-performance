'use client'

import { useState } from 'react'

import { EditorBubble } from 'novel'

import { Separator } from '@/components/ui/separator'

import { LinkSelector } from './selectors/link-selector'
import { NodeSelector } from './selectors/node-selector'
import { TextButtons } from './selectors/text-buttons'

/** Novel 源码 GenerativeMenuSwitch 的基础 Markdown 版本，不挂载尚未接入的 AI 接口。 */
export const EditorBubbleMenu = () => {
  const [nodeSelectorOpen, setNodeSelectorOpen] = useState(false)
  const [linkSelectorOpen, setLinkSelectorOpen] = useState(false)

  return (
    <EditorBubble
      tippyOptions={{ placement: 'top' }}
      className='bg-popover text-popover-foreground flex max-w-[90vw] overflow-hidden rounded-md border shadow-lg'
    >
      <NodeSelector open={nodeSelectorOpen} onOpenChange={setNodeSelectorOpen} />
      <Separator orientation='vertical' />
      <LinkSelector open={linkSelectorOpen} onOpenChange={setLinkSelectorOpen} />
      <Separator orientation='vertical' />
      <TextButtons />
    </EditorBubble>
  )
}
