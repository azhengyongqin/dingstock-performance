import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { cn } from '@/lib/utils'

export type MarkdownContentProps = {
  content: string
  className?: string
}

/** 只读 Markdown 渲染器：不解析原始 HTML，避免评审内容成为脚本注入入口。 */
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
      '[&_th]:bg-muted/60 [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse',
      '[&_td]:border [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left',
      '[&_hr]:border-border [&_hr]:my-4',
      className
    )}
  >
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={{
        a: ({ children, node, ...props }) => {
          // react-markdown 的 AST 节点仅供渲染回调使用，不能透传为真实 DOM 属性。
          void node

          return (
            <a {...props} target='_blank' rel='noreferrer noopener'>
              {children}
            </a>
          )
        }
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
)

export default MarkdownContent
