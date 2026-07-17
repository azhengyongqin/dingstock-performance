import Table from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import {
  Placeholder,
  StarterKit,
  TaskItem,
  TaskList,
  TiptapImage,
  TiptapLink,
  UploadImagesPlugin
} from 'novel'
import { Markdown } from 'tiptap-markdown'

type ExtensionOptions = {
  placeholder: string
}

/** 从 Novel 源码 extensions.ts 移植，并限制为可稳定往返的基础 Markdown 能力。 */
export const createDefaultExtensions = ({ placeholder }: ExtensionOptions) => {
  const tiptapImage = TiptapImage.extend({
    addProseMirrorPlugins() {
      return [
        UploadImagesPlugin({
          imageClass: 'my-3 block max-w-full rounded-lg border opacity-40'
        })
      ]
    }
  }).configure({
    // Markdown 图片属于行内节点，由外层段落负责写入块间空行。
    inline: true,
    allowBase64: true,
    HTMLAttributes: {
      class: 'my-3 block max-w-full rounded-lg border'
    }
  })

  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      horizontalRule: false,
      dropcursor: { color: 'var(--primary)', width: 2 },
      gapcursor: false
    }),
    Placeholder.configure({ placeholder, includeChildren: true }),
    TiptapLink.configure({
      openOnClick: false,
      autolink: false,
      linkOnPaste: false,
      HTMLAttributes: {
        class: 'text-primary cursor-pointer underline underline-offset-4'
      }
    }),
    tiptapImage,
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList.configure({ HTMLAttributes: { class: 'not-prose list-none pl-0' } }),
    TaskItem.configure({
      nested: true,
      HTMLAttributes: { class: 'flex items-start gap-2' }
    }),
    Markdown.configure({
      html: false,
      tightLists: true,
      bulletListMarker: '-',
      linkify: false,
      breaks: false,
      transformPastedText: true,
      transformCopiedText: true
    })
  ]
}
