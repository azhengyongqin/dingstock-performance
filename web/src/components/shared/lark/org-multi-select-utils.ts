/**
 * 组织多选：拼音模糊匹配、关键字高亮区间、已选展开为全量用户。
 */

import { match as matchPinyin } from 'pinyin-pro'

export type OrgContactDepartment = {
  open_department_id: string
  parent_department_id: string
  name: string
  member_count?: number
  leader_user_id?: string | null
}

export type OrgContactUser = {
  open_id: string
  user_id?: string
  name: string
  avatar?: string | { avatar_72?: string; avatar_240?: string; avatar_640?: string; avatar_origin?: string }
  department_ids?: string[]
  status?: string | { is_resigned?: boolean; is_activated?: boolean; is_frozen?: boolean }
}

export type OrgMultiSelectUser = {
  kind: 'user'
  openId: string
  name: string
  avatarUrl?: string
  departmentPath?: string
}

export type OrgMultiSelectDepartment = {
  kind: 'department'
  openDepartmentId: string
  name: string
  memberCount: number
}

export type OrgMultiSelectItem = OrgMultiSelectUser | OrgMultiSelectDepartment

/** 文本是否命中关键字：原文包含（忽略大小写）或拼音 / 首字母模糊匹配 */
export const matchesOrgSearch = (text: string, keyword: string): boolean => {
  const q = keyword.trim()

  if (!q) return true
  if (text.toLowerCase().includes(q.toLowerCase())) return true

  return matchPinyin(text, q) != null
}

/**
 * 返回需要高亮的字符下标（原文子串优先，否则用拼音匹配下标）。
 * 用于把「zs」「zhang」映射回「张三」中的汉字位置。
 */
export const getOrgSearchHighlightIndices = (text: string, keyword: string): number[] => {
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

const parseJsonField = <T,>(value: string | T | undefined | null): T | undefined => {
  if (value === undefined || value === null) return undefined

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return undefined
    }
  }

  return value
}

export const avatarUrlFromContactUser = (user: OrgContactUser): string | undefined => {
  const avatar = parseJsonField<{ avatar_72?: string; avatar_240?: string }>(user.avatar)

  return avatar?.avatar_72 ?? avatar?.avatar_240
}

const indexDepartments = (departments: OrgContactDepartment[]) => {
  const byId = new Map<string, OrgContactDepartment>()
  const childrenByParent = new Map<string, OrgContactDepartment[]>()

  for (const dept of departments) {
    byId.set(dept.open_department_id, dept)
    const parentKey = dept.parent_department_id || '0'
    const siblings = childrenByParent.get(parentKey) ?? []

    siblings.push(dept)
    childrenByParent.set(parentKey, siblings)
  }

  return { byId, childrenByParent }
}

const collectSubtreeIds = (
  rootId: string,
  childrenByParent: Map<string, OrgContactDepartment[]>
): Set<string> => {
  const ids = new Set<string>()
  const queue = [rootId]

  while (queue.length > 0) {
    const current = queue.shift() as string

    if (ids.has(current)) continue
    ids.add(current)

    for (const child of childrenByParent.get(current) ?? []) {
      queue.push(child.open_department_id)
    }
  }

  return ids
}

const buildDepartmentPath = (
  departmentIds: string[] | undefined,
  byId: Map<string, OrgContactDepartment>
): string => {
  if (!departmentIds?.length) return ''

  const parts: string[] = []
  let current = byId.get(departmentIds[0])
  const seen = new Set<string>()

  while (current && !seen.has(current.open_department_id)) {
    seen.add(current.open_department_id)
    parts.unshift(current.name)
    if (!current.parent_department_id || current.parent_department_id === '0') break
    current = byId.get(current.parent_department_id)
  }

  return parts.join('-')
}

/**
 * 将已选结果展开为去重后的全量用户列表：
 * - 直接勾选的人原样保留
 * - 勾选的部门展开为其自身 + 全部子部门下的成员
 */
export const expandOrgMultiSelectToUsers = (
  selected: OrgMultiSelectItem[],
  users: OrgContactUser[],
  departments: OrgContactDepartment[]
): OrgMultiSelectUser[] => {
  const { byId, childrenByParent } = indexDepartments(departments)
  const result = new Map<string, OrgMultiSelectUser>()

  for (const item of selected) {
    if (item.kind === 'user') {
      result.set(item.openId, item)
      continue
    }

    const subtreeIds = collectSubtreeIds(item.openDepartmentId, childrenByParent)

    for (const user of users) {
      if (!user.department_ids?.some(id => subtreeIds.has(id))) continue
      if (result.has(user.open_id)) continue

      result.set(user.open_id, {
        kind: 'user',
        openId: user.open_id,
        name: user.name,
        avatarUrl: avatarUrlFromContactUser(user),
        departmentPath: buildDepartmentPath(user.department_ids, byId)
      })
    }
  }

  return [...result.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}
