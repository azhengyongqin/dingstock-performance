import { describe, expect, it } from 'vitest'

import { getPinyinSearchHighlightIndices, indicesToRanges, matchesPinyinSearch } from './pinyin-search'

describe('pinyin-search', () => {
  it('matchesPinyinSearch 支持原文与拼音首字母', () => {
    expect(matchesPinyinSearch('张三', '张')).toBe(true)
    expect(matchesPinyinSearch('张三', 'zs')).toBe(true)
    expect(matchesPinyinSearch('张三', 'zhang')).toBe(true)
    expect(matchesPinyinSearch('张三', 'li')).toBe(false)
  })

  it('getPinyinSearchHighlightIndices 原文优先、拼音映射汉字下标', () => {
    expect(getPinyinSearchHighlightIndices('张三', '张')).toEqual([0])
    expect(getPinyinSearchHighlightIndices('张三', 'zs')).toEqual([0, 1])
    expect(indicesToRanges([0, 1, 3])).toEqual([
      [0, 2],
      [3, 4]
    ])
  })
})
