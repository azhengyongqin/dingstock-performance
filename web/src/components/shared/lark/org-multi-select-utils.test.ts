import { describe, expect, it } from 'vitest'

import {
  expandOrgMultiSelectToUsers,
  getOrgSearchHighlightIndices,
  indicesToRanges,
  matchesOrgSearch
} from './org-multi-select-utils'

describe('org-multi-select-utils', () => {
  it('matchesOrgSearch 支持原文与拼音首字母', () => {
    expect(matchesOrgSearch('张三', '张')).toBe(true)
    expect(matchesOrgSearch('张三', 'zs')).toBe(true)
    expect(matchesOrgSearch('张三', 'zhang')).toBe(true)
    expect(matchesOrgSearch('张三', 'li')).toBe(false)
  })

  it('getOrgSearchHighlightIndices 原文优先、拼音映射汉字下标', () => {
    expect(getOrgSearchHighlightIndices('张三', '张')).toEqual([0])
    expect(getOrgSearchHighlightIndices('张三', 'zs')).toEqual([0, 1])
    expect(indicesToRanges([0, 1, 3])).toEqual([
      [0, 2],
      [3, 4]
    ])
  })

  it('expandOrgMultiSelectToUsers 展开部门子树并去重', () => {
    const departments = [
      { open_department_id: 'd1', parent_department_id: '0', name: '总部' },
      { open_department_id: 'd2', parent_department_id: 'd1', name: '研发' }
    ]
    const users = [
      { open_id: 'u1', name: '甲', department_ids: ['d1'] },
      { open_id: 'u2', name: '乙', department_ids: ['d2'] },
      { open_id: 'u3', name: '丙', department_ids: ['d2'] }
    ]

    const expanded = expandOrgMultiSelectToUsers(
      [
        { kind: 'user', openId: 'u3', name: '丙' },
        { kind: 'department', openDepartmentId: 'd1', name: '总部', memberCount: 3 }
      ],
      users,
      departments
    )

    expect(expanded.map(user => user.openId).sort()).toEqual(['u1', 'u2', 'u3'])
  })
})
