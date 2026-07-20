import type { EditorInstance } from 'novel'

/** 常见 Markdown 块级 / 行内语法，用于判断剪贴板纯文本是否应按 Markdown 解析。 */
const MARKDOWN_HINTS = [
  /^#{1,6}\s+\S/m,
  /^\s{0,3}([-*+])\s+\S/m,
  /^\s{0,3}\d+\.\s+\S/m,
  /^\s{0,3}>\s+\S/m,
  /^\s{0,3}(```|~~~)/m,
  /^\s{0,3}([-*_]){3,}\s*$/m,
  /^\s*\|.+\|/m,
  /^\s*[-*+] \[[ xX]\]\s+\S/m,
  /!\[[^\]]*]\([^)]+\)/,
  /\[[^\]]+]\([^)]+\)/,
  /(\*\*|__).+?\1/,
  /(^|[\s(])(\*|_)(?!\s)(?:(?!\2).)+\2(?=[\s).,!?:;]|$)/m
]

const TABLE_ROW_RE = /^\s*\|.*\|\s*$/
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/

/** 判断纯文本是否像 Markdown 源码（避免把普通段落误解析）。 */
export const looksLikeMarkdown = (text: string) => {
  const normalized = text.replace(/\r\n/g, '\n').trim()

  if (!normalized) return false

  return MARKDOWN_HINTS.some(pattern => pattern.test(normalized))
}

const BLOCK_TAGS = new Set([
  'DIV',
  'P',
  'PRE',
  'LI',
  'TR',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'BLOCKQUOTE',
  'BR'
])

/**
 * 从 HTML 提取近似纯文本。
 * 不用 innerText：jsdom 支持不完整；按块级标签补换行，保留 Markdown 行结构。
 */
export const extractTextFromHtml = (html: string) => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  let result = ''

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent ?? ''

      return
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return

    const el = node as HTMLElement

    if (el.tagName === 'BR') {
      result += '\n'

      return
    }

    for (const child of Array.from(el.childNodes)) {
      walk(child)
    }

    if (BLOCK_TAGS.has(el.tagName)) {
      result += '\n'
    }
  }

  walk(doc.body)

  return result.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** HTML 已是标题/列表/表格等富文本结构时，应走默认粘贴而非当源码解析。 */
export const htmlHasRichStructure = (html: string) => {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  return Boolean(doc.body.querySelector('h1, h2, h3, h4, h5, h6, table, ul, ol, blockquote'))
}

/**
 * 从剪贴板取出应作为 Markdown 源码解析的文本。
 * 兼容：仅有 HTML、或 HTML 把源码包在 div/p/pre 里导致默认粘贴原样显示的情况。
 */
export const getClipboardMarkdownText = (event: ClipboardEvent) => {
  const plain = event.clipboardData?.getData('text/plain')?.replace(/\r\n/g, '\n') ?? ''
  const html = event.clipboardData?.getData('text/html') ?? ''

  if (plain.trim() && looksLikeMarkdown(plain)) {
    return plain
  }

  if (html.trim()) {
    // 已是结构化富文本则不拦截，交给 ProseMirror 默认 HTML 粘贴。
    if (htmlHasRichStructure(html)) {
      return ''
    }

    const extracted = extractTextFromHtml(html)

    if (looksLikeMarkdown(extracted)) {
      return extracted
    }
  }

  return plain
}

const splitTableRow = (line: string) => {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')

  return trimmed.split('|').map(cell => cell.trim())
}

const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

type MarkdownItLike = {
  renderInline: (src: string) => string
}

const renderTableCell = (cell: string, md?: MarkdownItLike) => {
  if (!cell) return ''

  if (md) {
    try {
      return md.renderInline(cell)
    } catch {
      // 回退到纯文本转义
    }
  }

  return escapeHtml(cell)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
}

/**
 * 将 GFM 管道表格转为 HTML。
 * tiptap-markdown 默认 markdown-it 不含 table 规则；转成 HTML 后可被 Table 扩展解析。
 */
export const convertGfmTablesToHtml = (text: string, md?: MarkdownItLike) => {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const output: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''

    if (!TABLE_ROW_RE.test(line) && !TABLE_SEPARATOR_RE.test(line)) {
      output.push(line)
      index += 1
      continue
    }

    const block: string[] = []

    while (index < lines.length) {
      const current = lines[index] ?? ''

      if (current.trim() === '') {
        let lookAhead = index + 1

        while (lookAhead < lines.length && (lines[lookAhead] ?? '').trim() === '') {
          lookAhead += 1
        }

        const next = lines[lookAhead] ?? ''

        if (TABLE_ROW_RE.test(next) || TABLE_SEPARATOR_RE.test(next)) {
          index += 1
          continue
        }

        break
      }

      if (!TABLE_ROW_RE.test(current) && !TABLE_SEPARATOR_RE.test(current)) {
        break
      }

      block.push(current)
      index += 1
    }

    const separatorIndex = block.findIndex(row => TABLE_SEPARATOR_RE.test(row))

    if (separatorIndex <= 0 || block.length < 2) {
      output.push(...block)
      continue
    }

    const headerCells = splitTableRow(block[0] ?? '')
    const bodyRows = block.slice(separatorIndex + 1).map(splitTableRow)

    const headerHtml = headerCells
      .map(cell => `<th>${renderTableCell(cell, md)}</th>`)
      .join('')

    const bodyHtml = bodyRows
      .map(cells => {
        const padded = headerCells.map((_, cellIndex) => cells[cellIndex] ?? '')

        return `<tr>${padded.map(cell => `<td>${renderTableCell(cell, md)}</td>`).join('')}</tr>`
      })
      .join('')

    output.push(`<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`)
    output.push('')
  }

  return output.join('\n')
}

/** 粘贴前规范化：修复表格空行，并把 GFM 表格转为可解析 HTML。 */
export const normalizeMarkdownForPaste = (text: string, editor?: EditorInstance | null) => {
  const md = editor?.storage?.markdown?.parser?.md as MarkdownItLike | undefined

  return convertGfmTablesToHtml(text.replace(/\r\n/g, '\n'), md)
}

/**
 * 优先用 Markdown 源码插入富文本。
 * 解决仅 HTML / HTML 源码包装导致「显示 Markdown 原文」以及表格空行无法识别的问题。
 */
export const pasteMarkdownText = (editor: EditorInstance | null | undefined, event: ClipboardEvent) => {
  if (!editor || editor.isActive('codeBlock') || editor.isActive('code')) return false

  const text = getClipboardMarkdownText(event)

  if (!looksLikeMarkdown(text)) return false

  event.preventDefault()

  const normalized = normalizeMarkdownForPaste(text, editor)
  const { from, to } = editor.state.selection

  // insertContentAt 已被 tiptap-markdown 覆写，会把字符串按 Markdown/HTML 解析。
  editor.chain().focus().insertContentAt({ from, to }, normalized).run()

  return true
}
