import {
  CheckSquareIcon,
  Code2Icon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  ListIcon,
  ListOrderedIcon,
  PilcrowIcon,
  QuoteIcon
} from 'lucide-react'
import { Command, type EditorInstance, createSuggestionItems, renderItems } from 'novel'

type RequestImageUpload = (editor: EditorInstance) => void

/** 从 Novel 示例 slash-command.tsx 移植并本地化的基础 Markdown 命令。 */
export const createSlashCommand = (requestImageUpload: RequestImageUpload) => {
  const suggestionItems = createSuggestionItems([
    {
      title: '正文',
      description: '使用普通文本段落',
      searchTerms: ['text', 'paragraph', 'p'],
      icon: <PilcrowIcon className='size-4' />,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setParagraph().run()
    },
    {
      title: '待办列表',
      description: '创建带复选框的任务列表',
      searchTerms: ['todo', 'task', 'check', 'checkbox'],
      icon: <CheckSquareIcon className='size-4' />,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleTaskList().run()
    },
    {
      title: '一级标题',
      description: '使用页面主标题',
      searchTerms: ['heading', 'h1', 'title'],
      icon: <Heading1Icon className='size-4' />,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run()
    },
    {
      title: '二级标题',
      description: '使用主要章节标题',
      searchTerms: ['heading', 'h2', 'subtitle'],
      icon: <Heading2Icon className='size-4' />,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run()
    },
    {
      title: '三级标题',
      description: '使用次级章节标题',
      searchTerms: ['heading', 'h3', 'subtitle'],
      icon: <Heading3Icon className='size-4' />,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run()
    },
    {
      title: '无序列表',
      description: '创建项目符号列表',
      searchTerms: ['bullet', 'unordered', 'list'],
      icon: <ListIcon className='size-4' />,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleBulletList().run()
    },
    {
      title: '有序列表',
      description: '创建数字编号列表',
      searchTerms: ['ordered', 'numbered', 'list'],
      icon: <ListOrderedIcon className='size-4' />,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleOrderedList().run()
    },
    {
      title: '引用',
      description: '插入引用内容块',
      searchTerms: ['quote', 'blockquote'],
      icon: <QuoteIcon className='size-4' />,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setParagraph().toggleBlockquote().run()
    },
    {
      title: '代码块',
      description: '插入多行代码片段',
      searchTerms: ['code', 'codeblock'],
      icon: <Code2Icon className='size-4' />,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
    },
    {
      title: '上传图片',
      description: '从本地选择一张图片',
      searchTerms: ['image', 'photo', 'picture', 'media'],
      icon: <ImageIcon className='size-4' />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run()
        requestImageUpload(editor)
      }
    }
  ])

  const slashCommand = Command.configure({
    suggestion: {
      items: () => suggestionItems,
      render: renderItems
    }
  })

  return { slashCommand, suggestionItems }
}
