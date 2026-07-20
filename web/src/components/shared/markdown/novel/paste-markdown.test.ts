import { describe, expect, it } from 'vitest'

import {
  convertGfmTablesToHtml,
  getClipboardMarkdownText,
  htmlHasRichStructure,
  looksLikeMarkdown
} from './paste-markdown'

describe('looksLikeMarkdown', () => {
  it('识别常见 Markdown 源码', () => {
    expect(looksLikeMarkdown('## 绩效总结\n\n完成 **关键项目**')).toBe(true)
    expect(looksLikeMarkdown('- 交付 A\n- 交付 B')).toBe(true)
    expect(looksLikeMarkdown('1. 第一项\n2. 第二项')).toBe(true)
    expect(looksLikeMarkdown('> 引用说明')).toBe(true)
    expect(looksLikeMarkdown('[详情](https://example.com)')).toBe(true)
    expect(looksLikeMarkdown('```ts\nconst a = 1\n```')).toBe(true)
  })

  it('普通中文段落不误判为 Markdown', () => {
    expect(looksLikeMarkdown('本周期完成了关键目标，并持续优化协作效率。')).toBe(false)
    expect(looksLikeMarkdown('得分 90 * 权重 0.3 = 27')).toBe(false)
  })
})

describe('convertGfmTablesToHtml', () => {
  it('忽略表格行之间的空行并生成 HTML 表格', () => {
    const markdown = `|**考察维度**|**具体阐述**|**分析总结**|

|---|---|---|

|**工作产出结果一**|||

|**工作产出结果二**|||`

    const html = convertGfmTablesToHtml(markdown)

    expect(html).toContain('<table>')
    expect(html).toContain('<th><strong>考察维度</strong></th>')
    expect(html).toContain('<td><strong>工作产出结果一</strong></td>')
    expect(html).not.toContain('|---|---|---|')
  })
})

describe('getClipboardMarkdownText', () => {
  it('从仅含 HTML 的源码包装中提取 Markdown 文本', () => {
    const markdown = '## 一.绩效自评\n\n> （200-300字内）\n\n- 条目'

    const html = markdown
      .split('\n')
      .map(line => `<div>${line.replaceAll('<', '&lt;').replaceAll('>', '&gt;') || '<br>'}</div>`)
      .join('')

    const event = {
      clipboardData: {
        getData: (type: string) => (type === 'text/html' ? html : '')
      }
    } as ClipboardEvent

    expect(getClipboardMarkdownText(event)).toContain('## 一.绩效自评')
    expect(htmlHasRichStructure(html)).toBe(false)
  })

  it('遇到结构化富文本 HTML 时不拦截', () => {
    const html = '<h2>绩效总结</h2><p>完成关键项目</p>'

    const event = {
      clipboardData: {
        getData: (type: string) => (type === 'text/html' ? html : type === 'text/plain' ? '绩效总结' : '')
      }
    } as ClipboardEvent

    expect(htmlHasRichStructure(html)).toBe(true)
    expect(getClipboardMarkdownText(event)).toBe('')
  })
})
