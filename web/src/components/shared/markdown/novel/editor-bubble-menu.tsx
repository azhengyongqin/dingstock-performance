'use client'

import { useState } from 'react'

import { Separator } from '@/components/ui/separator'

import { GenerativeMenuSwitch } from './generative/generative-menu-switch'
import { ColorSelector } from './selectors/color-selector'
import { LinkSelector } from './selectors/link-selector'
import { MathSelector } from './selectors/math-selector'
import { NodeSelector } from './selectors/node-selector'
import { TextButtons } from './selectors/text-buttons'

/** Novel 源码完整的选区菜单：AI、块类型、链接、公式、行内格式与颜色。 */
export const EditorBubbleMenu = () => {
  const [nodeSelectorOpen, setNodeSelectorOpen] = useState(false)
  const [linkSelectorOpen, setLinkSelectorOpen] = useState(false)
  const [colorSelectorOpen, setColorSelectorOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)

  return (
    <GenerativeMenuSwitch open={aiOpen} onOpenChange={setAiOpen}>
      <Separator orientation='vertical' />
      <NodeSelector open={nodeSelectorOpen} onOpenChange={setNodeSelectorOpen} />
      <Separator orientation='vertical' />
      <LinkSelector open={linkSelectorOpen} onOpenChange={setLinkSelectorOpen} />
      <Separator orientation='vertical' />
      <MathSelector />
      <Separator orientation='vertical' />
      <TextButtons />
      <Separator orientation='vertical' />
      <ColorSelector open={colorSelectorOpen} onOpenChange={setColorSelectorOpen} />
    </GenerativeMenuSwitch>
  )
}
