import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { MarkdownContent, MarkdownEditor } from '.'

describe('MarkdownContent', () => {
  it('正确渲染 GFM 标题、强调、列表、表格和链接', () => {
    render(
      <MarkdownContent
        content={
          '## 绩效总结\n\n完成 **关键项目**：\n\n- 交付 A\n- 交付 B\n\n| 项目 | 状态 |\n| --- | --- |\n| A | 完成 |\n\n[查看详情](https://example.com)'
        }
      />
    )

    expect(screen.getByRole('heading', { name: '绩效总结', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('关键项目').tagName).toBe('STRONG')
    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: '查看详情' })

    expect(link).toHaveAttribute('target', '_blank')
    expect(link).not.toHaveAttribute('node')
  })

  it('不把原始 HTML 创建为可执行节点', () => {
    const { container } = render(<MarkdownContent content={'正常内容<script>alert(1)</script>'} />)

    expect(screen.getByText(/正常内容alert\(1\)/)).toBeInTheDocument()
    expect(container.querySelector('script')).not.toBeInTheDocument()
  })
})

describe('MarkdownEditor', () => {
  it('解析已有 Markdown，并将富文本修改继续回写为 Markdown', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<MarkdownEditor ariaLabel='总结编辑器' value='## 已有总结' onChange={onChange} />)

    await screen.findByRole('textbox', { name: '总结编辑器' })

    expect(screen.getByRole('heading', { name: '已有总结', level: 2 })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '二级标题' }))

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('已有总结'))
  })

  it('禁用态保留 Markdown 渲染但不可编辑', async () => {
    render(<MarkdownEditor ariaLabel='只读总结' value='**已提交**' disabled onChange={() => {}} />)

    const editor = await screen.findByRole('textbox', { name: '只读总结' })

    expect(editor).toHaveAttribute('contenteditable', 'false')
    expect(screen.getByText('已提交').tagName).toBe('STRONG')
    expect(screen.getByRole('button', { name: '加粗' })).toBeDisabled()
  })

  it('把已有 GFM 表格与任务列表解析为可编辑结构', async () => {
    render(
      <MarkdownEditor
        ariaLabel='GFM 编辑器'
        value={'总结\n\n| 项目 | 状态 |\n| --- | --- |\n| A | 完成 |\n\n- [x] 已验收'}
        onChange={() => {}}
      />
    )

    await screen.findByRole('textbox', { name: 'GFM 编辑器' })
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('富文本修改后仍保留已有 Markdown 图片地址', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <MarkdownEditor
        ariaLabel='图片总结编辑器'
        value={'![架构图](https://example.com/architecture.png)\n\n## 总结'}
        onChange={onChange}
      />
    )

    await screen.findByRole('textbox', { name: '图片总结编辑器' })
    expect(screen.getByRole('img', { name: '架构图' })).toHaveAttribute('src', 'https://example.com/architecture.png')

    await user.click(screen.getByRole('button', { name: '二级标题' }))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls.at(-1)?.[0]).toContain('![架构图](https://example.com/architecture.png)')
  })
})
