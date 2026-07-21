/**
 * 组织多选：拼音模糊匹配、关键字高亮区间、已选展开为全量用户。
 * 拼音匹配实现见 `@/lib/pinyin-search`，此处保留组织场景别名以便既有调用点不变。
 */

import {
  getPinyinSearchHighlightIndices,
  indicesToRanges,
  matchesPinyinSearch
} from '@/lib/pinyin-search'

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

/** 组织多选场景别名，实现见 matchesPinyinSearch */
export const matchesOrgSearch = matchesPinyinSearch

/** 组织多选场景别名，实现见 getPinyinSearchHighlightIndices */
export const getOrgSearchHighlightIndices = getPinyinSearchHighlightIndices

export { indicesToRanges }

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
