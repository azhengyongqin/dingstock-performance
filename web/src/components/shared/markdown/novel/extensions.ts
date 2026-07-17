import Table from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import {
  AIHighlight,
  CharacterCount,
  CodeBlockLowlight,
  Color,
  CustomKeymap,
  GlobalDragHandle,
  HighlightExtension,
  HorizontalRule,
  Mathematics,
  Placeholder,
  StarterKit,
  TaskItem,
  TaskList,
  TextStyle,
  TiptapLink,
  TiptapUnderline,
  Twitter,
  UpdatedImage,
  UploadImagesPlugin,
  Youtube
} from 'novel'
import { common, createLowlight } from 'lowlight'
import { Markdown } from 'tiptap-markdown'

type ExtensionOptions = {
  placeholder: string
}

type MarkdownSerializerState = {
  esc: (value: string) => string
  write: (value: string) => void
}

type ImageNode = {
  attrs: {
    alt?: string | null
    height?: number | string | null
    src: string
    title?: string | null
    width?: number | string | null
  }
}

const escapeHtmlAttribute = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const serializeImage = (state: MarkdownSerializerState, node: ImageNode) => {
  const { alt, height, src, title, width } = node.attrs

  if (width || height) {
    // 标准 Markdown 没有图片尺寸语法；用安全的 HTML 回退，确保缩放结果能再次载入。
    const attributes = [
      `src="${escapeHtmlAttribute(src)}"`,
      alt ? `alt="${escapeHtmlAttribute(alt)}"` : null,
      title ? `title="${escapeHtmlAttribute(title)}"` : null,
      width ? `width="${escapeHtmlAttribute(String(width))}"` : null,
      height ? `height="${escapeHtmlAttribute(String(height))}"` : null
    ].filter(Boolean)

    state.write(`<img ${attributes.join(' ')}>`)

    return
  }

  const escapedSource = src.replace(/[()]/g, '\\$&')
  const escapedTitle = title ? ` "${title.replaceAll('"', '\\"')}"` : ''

  state.write(`![${state.esc(alt ?? '')}](${escapedSource}${escapedTitle})`)
}

/** 从 Novel 源码 extensions.ts 移植完整扩展集合，并用 HTML 回退承载增强格式。 */
export const createDefaultExtensions = ({ placeholder }: ExtensionOptions) => {
  const lowlight = createLowlight(common)

  // Novel 源码同时注册两个名为 image 的扩展会互相覆盖；合并后同时保留上传占位与缩放属性。

  const tiptapImage = UpdatedImage.extend({
    addStorage() {
      return {
        markdown: {
          serialize: serializeImage,
          parse: {}
        }
      }
    },
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
      codeBlock: false,
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
    HorizontalRule.configure({
      HTMLAttributes: { class: 'border-muted-foreground my-5 border-t' }
    }),
    AIHighlight,
    CodeBlockLowlight.configure({ lowlight }),
    Youtube.configure({
      inline: false,
      HTMLAttributes: { class: 'rounded-lg border' }
    }),
    Twitter.configure({
      inline: false,
      HTMLAttributes: { class: 'not-prose' }
    }),
    Mathematics.configure({
      HTMLAttributes: { class: 'hover:bg-accent cursor-pointer rounded p-1' },
      katexOptions: { throwOnError: false }
    }),
    CharacterCount.configure(),
    TiptapUnderline,
    HighlightExtension.configure({ multicolor: true }),
    TextStyle,
    Color,
    CustomKeymap,
    GlobalDragHandle,
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
      // Novel 的媒体、颜色与公式节点需要以 HTML 回退格式保存在 Markdown 字符串中。
      html: true,
      tightLists: true,
      bulletListMarker: '-',
      linkify: false,
      breaks: false,
      transformPastedText: false,
      transformCopiedText: false
    })
  ]
}
