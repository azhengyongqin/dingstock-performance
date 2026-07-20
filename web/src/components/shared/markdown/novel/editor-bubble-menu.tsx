'use client'

import { Fragment, useState, type ReactElement } from 'react'

import { Separator } from '@/components/ui/separator'

import { GenerativeMenuSwitch } from './generative/generative-menu-switch'
import { ColorSelector } from './selectors/color-selector'
import { LinkSelector } from './selectors/link-selector'
import { MathSelector } from './selectors/math-selector'
import { NodeSelector } from './selectors/node-selector'
import { TextButtons } from './selectors/text-buttons'
import type { ResolvedMarkdownEditorFeatures } from './types'

type EditorBubbleMenuProps = {
  features: ResolvedMarkdownEditorFeatures
}

const withSeparator = (nodes: ReactElement[]) =>
  nodes.flatMap((node, index) =>
    index === 0 ? [node] : [<Separator key={`separator-${index}`} orientation='vertical' />, node]
  )

/** Novel 源码完整的选区菜单：AI、块类型、链接、公式、行内格式与颜色。 */
export const EditorBubbleMenu = ({ features }: EditorBubbleMenuProps) => {
  const [nodeSelectorOpen, setNodeSelectorOpen] = useState(false)
  const [linkSelectorOpen, setLinkSelectorOpen] = useState(false)
  const [colorSelectorOpen, setColorSelectorOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)

  const items: ReactElement[] = []

  if (features.nodeSelector) {
    items.push(<NodeSelector key='node' open={nodeSelectorOpen} onOpenChange={setNodeSelectorOpen} />)
  }

  if (features.link) {
    items.push(<LinkSelector key='link' open={linkSelectorOpen} onOpenChange={setLinkSelectorOpen} />)
  }

  if (features.math) {
    items.push(<MathSelector key='math' />)
  }

  if (features.textFormatting) {
    items.push(<TextButtons key='text' />)
  }

  if (features.color) {
    items.push(<ColorSelector key='color' open={colorSelectorOpen} onOpenChange={setColorSelectorOpen} />)
  }

  // Ask AI 关闭且其余选区能力也全关时，不挂载空气泡。
  if (!features.askAi && items.length === 0) return null

  return (
    <GenerativeMenuSwitch open={aiOpen} onOpenChange={setAiOpen} askAi={features.askAi}>
      {items.length > 0 ? (
        <Fragment>
          {features.askAi ? <Separator orientation='vertical' /> : null}
          {withSeparator(items)}
        </Fragment>
      ) : null}
    </GenerativeMenuSwitch>
  )
}
