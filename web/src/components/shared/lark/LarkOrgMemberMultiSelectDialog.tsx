'use client'

/**
 * 飞书式「人员 / 组织」双栏多选弹窗。
 * 左栏：搜索（拼音模糊 + 主题色高亮、可清除、跨次打开保留关键字）+ 面包屑钻取；
 * 右栏：已选人/部门；确认时同时回传展开后的全量用户列表。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { Loader2Icon, NetworkIcon, XIcon } from 'lucide-react'

import SearchInput from '@/components/shared/SearchInput'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

import {
  avatarUrlFromContactUser,
  expandOrgMultiSelectToUsers,
  getOrgSearchHighlightIndices,
  indicesToRanges,
  matchesOrgSearch,
  type OrgContactDepartment,
  type OrgContactUser,
  type OrgMultiSelectDepartment,
  type OrgMultiSelectItem,
  type OrgMultiSelectUser
} from './org-multi-select-utils'
import UserAvatar from './UserAvatar'

export type {
  OrgContactDepartment,
  OrgContactUser,
  OrgMultiSelectDepartment,
  OrgMultiSelectItem,
  OrgMultiSelectUser
} from './org-multi-select-utils'
export { expandOrgMultiSelectToUsers } from './org-multi-select-utils'

export type LarkOrgMemberMultiSelectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void

  /** 打开弹窗时的已选项（弹窗内可改，确认后才回传） */
  initialSelected?: OrgMultiSelectItem[]

  /**
   * 确认回调。
   * @param items 原始已选（人 + 部门混选）
   * @param expandedUsers 将部门展开为子树全量成员后的去重用户列表（含直接勾选的人）
   */
  onConfirm: (items: OrgMultiSelectItem[], expandedUsers: OrgMultiSelectUser[]) => void

  /**
   * 是否允许勾选部门，默认 true。
   * 为 false 时仍展示部门行用于「下级」钻取导航，只是不能勾选部门实体。
   */
  allowDepartments?: boolean

  /** 是否允许勾选人员，默认 true。为 false 时不展示人员行（纯选部门场景）。 */
  allowUsers?: boolean

  confirmLabel?: string
  searchPlaceholder?: string
}

type BreadcrumbNode = {
  id: string | null
  name: string
}

const ROOT_CRUMBS: BreadcrumbNode[] = [
  { id: '__contacts__', name: '联系人' },
  { id: null, name: '组织内联系人' }
]

const itemKey = (item: OrgMultiSelectItem) =>
  item.kind === 'user' ? `user:${item.openId}` : `dept:${item.openDepartmentId}`

const isResigned = (user: OrgContactUser) => {
  const status = user.status

  if (!status) return false
  if (typeof status === 'string') {
    try {
      return Boolean((JSON.parse(status) as { is_resigned?: boolean }).is_resigned)
    } catch {
      return false
    }
  }

  return Boolean(status.is_resigned)
}

/** 由扁平部门列表构建 parent → children 与 id → dept 索引 */
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

  for (const siblings of childrenByParent.values()) {
    siblings.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }

  return { byId, childrenByParent }
}

const buildDepartmentPath = (
  departmentIds: string[] | undefined,
  byId: Map<string, OrgContactDepartment>
): string => {
  if (!departmentIds?.length) return ''

  const leafId = departmentIds[0]
  const parts: string[] = []
  let current = byId.get(leafId)
  const seen = new Set<string>()

  while (current && !seen.has(current.open_department_id)) {
    seen.add(current.open_department_id)
    parts.unshift(current.name)
    if (!current.parent_department_id || current.parent_department_id === '0') break
    current = byId.get(current.parent_department_id)
  }

  return parts.join('-')
}

const selectedSummary = (items: OrgMultiSelectItem[]) => {
  const userCount = items.filter(item => item.kind === 'user').length
  const deptCount = items.filter(item => item.kind === 'department').length
  const parts: string[] = []

  if (userCount > 0 || deptCount === 0) parts.push(`${userCount} 人`)
  if (deptCount > 0) parts.push(`${deptCount} 个部门`)

  return `已选：${parts.join('，')}`
}

/** 搜索命中片段用主题色高亮 */
const HighlightMatch = ({ text, keyword, className }: { text: string; keyword: string; className?: string }) => {
  const ranges = useMemo(() => indicesToRanges(getOrgSearchHighlightIndices(text, keyword)), [text, keyword])

  if (!keyword.trim() || ranges.length === 0) {
    return <span className={className}>{text}</span>
  }

  const nodes: ReactNode[] = []
  let cursor = 0

  ranges.forEach(([start, end], rangeIndex) => {
    if (start > cursor) {
      nodes.push(<span key={`t-${cursor}`}>{text.slice(cursor, start)}</span>)
    }

    nodes.push(
      <span key={`h-${rangeIndex}`} className='text-primary'>
        {text.slice(start, end)}
      </span>
    )
    cursor = end
  })

  if (cursor < text.length) {
    nodes.push(<span key={`t-${cursor}`}>{text.slice(cursor)}</span>)
  }

  return <span className={className}>{nodes}</span>
}

const DepartmentIcon = ({ className }: { className?: string }) => (
  <span
    className={cn(
      'bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-full',
      className
    )}
  >
    <NetworkIcon className='size-4' />
  </span>
)

/**
 * 飞书式人员/组织多选：左栏搜索 + 面包屑钻取，右栏已选摘要，底部取消/确定(⌘+Enter)。
 */
const LarkOrgMemberMultiSelectDialog = ({
  open,
  onOpenChange,
  initialSelected = [],
  onConfirm,
  allowDepartments = true,
  allowUsers = true,
  confirmLabel = '确定',
  searchPlaceholder = '搜索联系人、部门和我管理的群组'
}: LarkOrgMemberMultiSelectDialogProps) => {
  const [departments, setDepartments] = useState<OrgContactDepartment[]>([])
  const [users, setUsers] = useState<OrgContactUser[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [crumbs, setCrumbs] = useState<BreadcrumbNode[]>(ROOT_CRUMBS)
  /** 搜索关键字跨次打开保留，仅用户点清除或手动改写时变化 */
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<OrgMultiSelectItem[]>([])
  const searchInputRef = useRef<HTMLInputElement>(null)

  const { byId, childrenByParent } = useMemo(() => indexDepartments(departments), [departments])

  const loadContact = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [deptRes, userRes] = await Promise.all([
        apiFetch<{ items: OrgContactDepartment[] }>('/contact/departments'),
        apiFetch<{ items: OrgContactUser[] }>('/contact/users')
      ])

      setDepartments(deptRes.items ?? [])
      setUsers((userRes.items ?? []).filter(user => !isResigned(user)))
    } catch {
      setError('无法加载组织数据，请确认后端已启动且已同步通讯录。')
    } finally {
      setLoading(false)
    }
  }, [])

  const wasOpenRef = useRef(false)

  // 仅在「关闭 → 打开」时重置导航并灌入 initialSelected；不清空搜索关键字
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setCrumbs(ROOT_CRUMBS)
      setSelected(
        initialSelected
          .filter(item => (item.kind === 'user' ? allowUsers : allowDepartments))
          .map(item => ({ ...item }))
      )
      void loadContact()
    }

    wasOpenRef.current = open
  }, [open, initialSelected, loadContact, allowUsers, allowDepartments])

  const resolveExpandedUsers = useCallback(
    (items: OrgMultiSelectItem[]) => expandOrgMultiSelectToUsers(items, users, departments),
    [users, departments]
  )

  // ⌘/Ctrl + Enter 确认
  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return
      event.preventDefault()
      onConfirm(selected, resolveExpandedUsers(selected))
      onOpenChange(false)
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onConfirm, onOpenChange, selected, resolveExpandedUsers])

  const currentDeptId = crumbs[crumbs.length - 1]?.id ?? null
  const searching = query.trim().length > 0
  const keyword = query.trim()

  const childDepartments = useMemo(() => {
    // 搜索时：仅「可选部门」模式才列出部门命中；人员-only 搜索不展示部门结果
    if (searching) {
      if (!allowDepartments) return []

      return departments
        .filter(dept => matchesOrgSearch(dept.name, keyword))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    }

    const parentKey = currentDeptId ?? '0'

    return childrenByParent.get(parentKey) ?? []
  }, [searching, allowDepartments, departments, keyword, currentDeptId, childrenByParent])

  const visibleUsers = useMemo(() => {
    if (!allowUsers) return []

    if (searching) {
      return users
        .filter(user => matchesOrgSearch(user.name, keyword))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
        .slice(0, 50)
    }

    // 根层只展示部门；钻进部门后展示「直属」该部门的成员（非子树展开）
    if (!currentDeptId) return []

    return users
      .filter(user => user.department_ids?.includes(currentDeptId))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }, [allowUsers, searching, users, keyword, currentDeptId])

  const selectedKeys = useMemo(() => new Set(selected.map(itemKey)), [selected])

  const toggleItem = (item: OrgMultiSelectItem) => {
    if (item.kind === 'department' && !allowDepartments) return
    if (item.kind === 'user' && !allowUsers) return

    const key = itemKey(item)

    setSelected(prev => (prev.some(row => itemKey(row) === key) ? prev.filter(row => itemKey(row) !== key) : [...prev, item]))
  }

  const removeItem = (item: OrgMultiSelectItem) => {
    const key = itemKey(item)

    setSelected(prev => prev.filter(row => itemKey(row) !== key))
  }

  const drillInto = (dept: OrgContactDepartment) => {
    setCrumbs(prev => [...prev, { id: dept.open_department_id, name: dept.name }])
  }

  const jumpToCrumb = (index: number) => {
    if (index <= 1) {
      setCrumbs(ROOT_CRUMBS)

      return
    }

    setCrumbs(prev => prev.slice(0, index + 1))
  }

  const handleConfirm = () => {
    onConfirm(selected, resolveExpandedUsers(selected))
    onOpenChange(false)
  }

  const currentDeptName = currentDeptId ? (byId.get(currentDeptId)?.name ?? '') : ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className='flex h-[min(85vh,36rem)] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl'
      >
        <DialogTitle className='sr-only'>选择人员与组织</DialogTitle>

        <div className='flex min-h-0 flex-1'>
          <div className='flex min-h-0 min-w-0 flex-1 flex-col border-r'>
            <div className='shrink-0 space-y-3 p-4 pb-2'>
              <SearchInput
                inputRef={searchInputRef}
                value={query}
                placeholder={searchPlaceholder}
                onChange={setQuery}
              />

              {!searching && (
                <nav className='text-muted-foreground flex flex-wrap items-center gap-1 text-xs'>
                  {crumbs.map((crumb, index) => (
                    <span key={`${crumb.id ?? 'root'}-${index}`} className='flex items-center gap-1'>
                      {index > 0 && <span className='opacity-50'>&gt;</span>}
                      <button
                        type='button'
                        className={cn(
                          'hover:text-foreground max-w-40 truncate',
                          index === crumbs.length - 1 && 'text-foreground'
                        )}
                        onClick={() => jumpToCrumb(index)}
                      >
                        {crumb.name}
                      </button>
                    </span>
                  ))}
                </nav>
              )}
            </div>

            <div className='min-h-0 flex-1 overflow-y-auto px-2 pb-3'>
              {loading && (
                <div className='text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm'>
                  <Loader2Icon className='size-4 animate-spin' />
                  加载组织数据…
                </div>
              )}

              {!loading && error && (
                <div className='flex flex-col items-center gap-3 py-12 text-sm'>
                  <p className='text-destructive text-center'>{error}</p>
                  <Button type='button' variant='outline' size='sm' onClick={() => void loadContact()}>
                    重试
                  </Button>
                </div>
              )}

              {!loading && !error && childDepartments.length === 0 && visibleUsers.length === 0 && (
                <div className='text-muted-foreground py-16 text-center text-sm'>
                  {searching ? '无匹配结果' : '该层级暂无下级部门或成员'}
                </div>
              )}

              {!loading &&
                !error &&
                childDepartments.map(dept => {
                  const item: OrgMultiSelectDepartment = {
                    kind: 'department',
                    openDepartmentId: dept.open_department_id,
                    name: dept.name,
                    memberCount: dept.member_count ?? 0
                  }
                  const checked = selectedKeys.has(itemKey(item))

                  return (
                    <div
                      key={dept.open_department_id}
                      className='hover:bg-muted/80 group flex items-center gap-2 rounded-md px-2 py-2'
                    >
                      {allowDepartments ? (
                        <button
                          type='button'
                          className='flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left'
                          onClick={() => toggleItem(item)}
                        >
                          <Checkbox checked={checked} tabIndex={-1} aria-hidden className='pointer-events-none' />
                          <DepartmentIcon />
                          <div className='min-w-0 flex-1'>
                            <div className='truncate text-sm'>
                              {searching ? <HighlightMatch text={dept.name} keyword={keyword} /> : dept.name}
                              <span className='text-muted-foreground'> ({dept.member_count ?? 0})</span>
                            </div>
                            {searching && (
                              <div className='text-muted-foreground truncate text-xs'>
                                {buildDepartmentPath([dept.open_department_id], byId)}
                              </div>
                            )}
                          </div>
                        </button>
                      ) : (
                        // 仅导航：不可勾选部门，点击行也可进入下级（与「下级」一致）
                        <button
                          type='button'
                          className='flex min-w-0 flex-1 items-center gap-2 text-left'
                          onClick={() => !searching && drillInto(dept)}
                        >
                          <span className='size-4 shrink-0' />
                          <DepartmentIcon />
                          <div className='min-w-0 flex-1'>
                            <div className='truncate text-sm'>
                              {dept.name}
                              <span className='text-muted-foreground'> ({dept.member_count ?? 0})</span>
                            </div>
                          </div>
                        </button>
                      )}
                      {!searching && (
                        <button
                          type='button'
                          className='text-primary! hover:text-primary/80! shrink-0 px-1 text-sm font-medium'
                          onClick={() => drillInto(dept)}
                        >
                          下级
                        </button>
                      )}
                    </div>
                  )
                })}

              {!loading &&
                !error &&
                allowUsers &&
                visibleUsers.map(user => {
                  const item: OrgMultiSelectUser = {
                    kind: 'user',
                    openId: user.open_id,
                    name: user.name,
                    avatarUrl: avatarUrlFromContactUser(user),
                    departmentPath: buildDepartmentPath(user.department_ids, byId)
                  }
                  const checked = selectedKeys.has(itemKey(item))
                  const leaderId = currentDeptId ? byId.get(currentDeptId)?.leader_user_id : undefined
                  const isLeader =
                    leaderId != null && (leaderId === user.open_id || leaderId === user.user_id)

                  return (
                    <button
                      key={user.open_id}
                      type='button'
                      className='hover:bg-muted/80 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left'
                      onClick={() => toggleItem(item)}
                    >
                      <Checkbox checked={checked} tabIndex={-1} aria-hidden className='pointer-events-none' />
                      <UserAvatar
                        openId={user.open_id}
                        name={user.name}
                        avatarUrl={item.avatarUrl}
                        size='sm'
                        withProfileCard={false}
                      />
                      <div className='min-w-0 flex-1'>
                        <div className='flex items-center gap-1.5'>
                          <HighlightMatch
                            text={user.name}
                            keyword={searching ? keyword : ''}
                            className='truncate text-sm font-medium'
                          />
                          {isLeader && (
                            <Badge variant='secondary' className='h-5 px-1.5 text-[10px]'>
                              负责人
                            </Badge>
                          )}
                        </div>
                        <div className='text-muted-foreground truncate text-xs'>
                          {searching ? item.departmentPath || '未分配部门' : currentDeptName}
                        </div>
                      </div>
                    </button>
                  )
                })}
            </div>
          </div>

          <div className='flex w-[42%] shrink-0 flex-col'>
            <div className='text-muted-foreground shrink-0 px-4 py-3 text-sm'>{selectedSummary(selected)}</div>
            <div className='min-h-0 flex-1 overflow-y-auto px-2 pb-3'>
              {selected.length === 0 ? null : (
                <ul className='flex flex-col'>
                  {selected.map(item => (
                    <li
                      key={itemKey(item)}
                      className='hover:bg-muted/80 flex items-center gap-2 rounded-md px-2 py-2'
                    >
                      {item.kind === 'user' ? (
                        <UserAvatar
                          openId={item.openId}
                          name={item.name}
                          avatarUrl={item.avatarUrl}
                          size='sm'
                          withProfileCard={false}
                        />
                      ) : (
                        <DepartmentIcon />
                      )}
                      <div className='min-w-0 flex-1'>
                        <div className='truncate text-sm font-medium'>{item.name}</div>
                        {item.kind === 'user' && item.departmentPath && (
                          <div className='text-muted-foreground truncate text-xs'>{item.departmentPath}</div>
                        )}
                        {item.kind === 'department' && (
                          <div className='text-muted-foreground text-xs'>{item.memberCount} 人</div>
                        )}
                      </div>
                      <button
                        type='button'
                        aria-label={`移除 ${item.name}`}
                        className='text-muted-foreground hover:text-foreground shrink-0 p-1'
                        onClick={() => removeItem(item)}
                      >
                        <XIcon className='size-3.5' />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className='shrink-0 border-t px-4 py-3 sm:justify-end'>
          <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type='button' onClick={handleConfirm}>
            {confirmLabel}
            <span className='text-primary-foreground/80 ml-1 text-xs'>(⌘+Enter)</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default LarkOrgMemberMultiSelectDialog
