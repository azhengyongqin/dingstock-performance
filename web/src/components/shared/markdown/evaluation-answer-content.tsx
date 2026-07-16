import { cn } from '@/lib/utils'

import MarkdownContent from './markdown-content'

export type EvaluationAnswerContentProps = {
  type: string
  value: string
  className?: string
}

/** 评估答案统一只读出口：Markdown 富文本渲染，其余类型保持原有换行文本展示。 */
const EvaluationAnswerContent = ({ type, value, className }: EvaluationAnswerContentProps) =>
  type === 'MARKDOWN' ? (
    <MarkdownContent content={value} className={className} />
  ) : (
    <p className={cn('text-sm whitespace-pre-wrap', className)}>{value}</p>
  )

export default EvaluationAnswerContent
