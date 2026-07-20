import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MarkdownEditor } from '.'

/** 用户反馈无法正确粘贴的模板（含空行表格、四级标题、引用）。 */
const USER_MARKDOWN = `## 一.绩效自评

> （200-300字内）

> 

> 

---

## 二.半年总结

#### 工作产出结果

|**考察维度**|**具体阐述**|**分析总结**|

|---|---|---|

|**工作产出结果一**|||

|**工作产出结果二**|||

|**可自行增加**|||

#### 个人成长

- 近半年个人新成长或习得的技能，提效工具

---

## 三.下个半年规划

#### 半年工作规划与个人成长计划

#### 需要的支持和帮助

---

## 四.对公司的建议和期许`

describe('用户绩效模板粘贴', () => {
  it('仅 HTML 剪贴板时也能解析为标题、表格和列表', async () => {
    const onChange = vi.fn()

    render(<MarkdownEditor ariaLabel='用户模板 HTML 粘贴' value='' onChange={onChange} />)

    const editor = await screen.findByRole('textbox', { name: '用户模板 HTML 粘贴' })

    const html = USER_MARKDOWN.split('\n')
      .map(line => `<div>${line.replaceAll('<', '&lt;').replaceAll('>', '&gt;') || '<br>'}</div>`)
      .join('')

    fireEvent.paste(editor, {
      clipboardData: {
        types: ['text/html'],
        files: [],
        getData: (type: string) => (type === 'text/html' ? html : '')
      }
    })

    expect(await screen.findByRole('heading', { name: '一.绩效自评', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '工作产出结果', level: 4 })).toBeInTheDocument()
    expect(editor.querySelector('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '考察维度' })).toBeInTheDocument()
    expect(screen.getByText('近半年个人新成长或习得的技能，提效工具')).toBeInTheDocument()
    expect(screen.queryByText(/## 一\.绩效自评/)).not.toBeInTheDocument()
    await waitFor(() => expect(onChange).toHaveBeenCalled())
  })

  it('text/plain 含空行表格时也能生成 table 节点', async () => {
    const onChange = vi.fn()

    render(<MarkdownEditor ariaLabel='用户模板纯文本粘贴' value='' onChange={onChange} />)

    const editor = await screen.findByRole('textbox', { name: '用户模板纯文本粘贴' })

    fireEvent.paste(editor, {
      clipboardData: {
        types: ['text/plain'],
        files: [],
        getData: (type: string) => (type === 'text/plain' ? USER_MARKDOWN : '')
      }
    })

    expect(await screen.findByRole('heading', { name: '二.半年总结', level: 2 })).toBeInTheDocument()
    expect(editor.querySelector('table')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '个人成长', level: 4 })).toBeInTheDocument()
  })
})
