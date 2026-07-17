import type { CSSProperties } from 'react'

import katex from 'katex'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

import { cn } from '@/lib/utils'

export type MarkdownContentProps = {
  content: string
  className?: string
}

const novelMarkdownSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'u', 'span', 'mark', 'iframe'],
  attributes: {
    ...defaultSchema.attributes,
    span: [...(defaultSchema.attributes?.span ?? []), 'style', 'dataType'],
    mark: [...(defaultSchema.attributes?.mark ?? []), 'style', 'dataColor'],
    img: [...(defaultSchema.attributes?.img ?? []), 'width', 'height'],
    div: [...(defaultSchema.attributes?.div ?? []), 'dataYoutubeVideo', 'dataTwitter', 'src'],
    iframe: ['src', 'width', 'height', 'allow', 'allowFullScreen', 'className', 'title']
  },
  protocols: {
    ...defaultSchema.protocols,

    // 粘贴图片的无后端回退是 data:image；iframe 仍会在组件层限制为 YouTube。
    src: [...(defaultSchema.protocols?.src ?? []), 'data']
  }
}

const SAFE_COLOR_PATTERN = /^(?:#[\da-f]{3,8}|rgba?\([\d\s,.%]+\)|var\(--novel-highlight-[a-z-]+\))$/iu

const safeColorStyle = (style: CSSProperties | undefined, property: 'color' | 'backgroundColor') => {
  const value = style?.[property]

  return typeof value === 'string' && SAFE_COLOR_PATTERN.test(value) ? { [property]: value } : undefined
}

/** 只读 Markdown 渲染器：仅放行 Novel 生成的增强 HTML，并再次约束颜色和媒体地址。 */
const MarkdownContent = ({ content, className }: MarkdownContentProps) => (
  <div
    data-slot='markdown-content'
    className={cn(
      'min-w-0 text-sm break-words',
      '[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-bold [&_h1:first-child]:mt-0',
      '[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2:first-child]:mt-0',
      '[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-semibold [&_h3:first-child]:mt-0',
      '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
      '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
      '[&_li]:my-1 [&_li>p]:my-0',
      '[&_blockquote]:text-muted-foreground [&_blockquote]:my-2 [&_blockquote]:border-l-4 [&_blockquote]:pl-3',
      '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4',
      '[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em]',
      '[&_pre]:bg-muted [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:p-3',
      '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
      '[&_img]:my-3 [&_img]:max-w-full [&_img]:rounded-md',
      '[&_div[data-youtube-video]>iframe]:my-3 [&_div[data-youtube-video]>iframe]:aspect-video',
      '[&_div[data-youtube-video]>iframe]:w-full [&_div[data-youtube-video]>iframe]:rounded-md [&_div[data-youtube-video]>iframe]:border',
      '[&_th]:bg-muted/60 [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse',
      '[&_td]:border [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left',
      '[&_hr]:border-border [&_hr]:my-4',
      className
    )}
  >
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, novelMarkdownSchema]]}
      components={{
        a: ({ children, node, ...props }) => {
          // react-markdown 的 AST 节点仅供渲染回调使用，不能透传为真实 DOM 属性。
          void node

          return (
            <a {...props} target='_blank' rel='noreferrer noopener'>
              {children}
            </a>
          )
        },
        span: ({ children, node, style, ...props }) => {
          void node

          const dataType = (props as typeof props & { 'data-type'?: unknown })['data-type']

          if (dataType === 'math' && typeof children === 'string') {
            return (
              <span
                {...props}
                className='katex-inline'
                dangerouslySetInnerHTML={{
                  // LaTeX 来自纯文本节点；KaTeX 默认 trust=false，不执行用户 HTML 命令。
                  __html: katex.renderToString(children, { throwOnError: false, trust: false })
                }}
              />
            )
          }

          return (
            <span {...props} style={safeColorStyle(style, 'color')}>
              {children}
            </span>
          )
        },
        mark: ({ children, node, style, ...props }) => {
          void node

          return (
            <mark {...props} style={safeColorStyle(style, 'backgroundColor')}>
              {children}
            </mark>
          )
        },
        div: ({ children, node, ...props }) => {
          void node

          const { src, ...divProps } = props as typeof props & { src?: unknown }

          if (
            'data-twitter' in props &&
            typeof src === 'string' &&
            /^https:\/\/x\.com\/[a-zA-Z0-9_]{1,15}\/status\/\d+(?:\/\S*)?$/u.test(src)
          ) {
            return (
              <a href={src} target='_blank' rel='noreferrer noopener'>
                查看 X（Twitter）帖子
              </a>
            )
          }

          return <div {...divProps}>{children}</div>
        },
        iframe: ({ node, src, ...props }) => {
          void node

          if (typeof src !== 'string' || !/^https:\/\/www\.youtube\.com\/embed\/[\w-]+(?:\?[^\s]*)?$/u.test(src)) {
            return null
          }

          return (
            <iframe
              {...props}
              src={src}
              title='YouTube 视频播放器'
              loading='lazy'
              allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
              allowFullScreen
            />
          )
        }
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
)

export default MarkdownContent
