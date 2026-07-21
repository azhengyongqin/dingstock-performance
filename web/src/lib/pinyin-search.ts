/**
 * 通用拼音 / 首字母模糊搜索（与组织多选弹窗同一套匹配规则）。
 */

import { match as matchPinyin } from 'pinyin-pro'

/** 文本是否命中关键字：原文包含（忽略大小写）或拼音 / 首字母模糊匹配 */
export const matchesPinyinSearch = (text: string, keyword: string): boolean => {
  const q = keyword.trim()

  if (!q) return true
  if (text.toLowerCase().includes(q.toLowerCase())) return true

  return matchPinyin(text, q) != null
}

/**
 * 返回需要高亮的字符下标（原文子串优先，否则用拼音匹配下标）。
 * 用于把「zs」「zhang」映射回「张三」中的汉字位置。
 */
export const getPinyinSearchHighlightIndices = (text: string, keyword: string): number[] => {
  const q = keyword.trim()

  if (!q || !text) return []

  const lowerText = text.toLowerCase()
  const lowerQ = q.toLowerCase()
  const literalIndex = lowerText.indexOf(lowerQ)

  if (literalIndex >= 0) {
    return Array.from({ length: q.length }, (_, offset) => literalIndex + offset)
  }

  return matchPinyin(text, q) ?? []
}

/** 将字符下标合并为连续区间 [start, end) */
export const indicesToRanges = (indices: number[]): Array<[number, number]> => {
  if (indices.length === 0) return []

  const sorted = [...new Set(indices)].sort((a, b) => a - b)
  const ranges: Array<[number, number]> = []
  let start = sorted[0]
  let end = sorted[0] + 1

  for (let i = 1; i < sorted.length; i++) {
    const index = sorted[i]

    if (index === end) {
      end = index + 1
    } else {
      ranges.push([start, end])
      start = index
      end = index + 1
    }
  }

  ranges.push([start, end])

  return ranges
}
