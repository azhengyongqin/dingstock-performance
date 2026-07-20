'use client'

/**
 * PROTOTYPE — 飞书式「人员 / 组织」双栏多选弹窗。
 * 问题：按截图还原的组织树钻取 + 搜索 + 人/部门混选，在真实 /contact 数据下交互是否成立？
 * 数据：打开时拉取 /contact/departments 与 /contact/users，内存筛选，无持久化。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Loader2Icon, NetworkIcon, SearchIcon, XIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

import UserAvatar from './UserAvatar'

// —— 通讯录原始类型（与组织架构页一致）——

type ContactDepartment = {
  open_department_id: string
  department_id: string
  name: string
  parent_department_id: string
  member_count: number
  leader_user_id?: string | null
}

type ContactUser = {
  open_id: string
  user_id: string
  name: string
  avatar?: string | { avatar_72?: string; avatar_240?: string; avatar_640?: string; avatar_origin?: string }
  department_ids?: string[]
  status?: string | { is_activated?: boolean; is_resigned?: boolean; is_frozen?: boolean }
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

export type LarkOrgMemberMultiSelectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void

  /** 打开弹窗时的已选项（弹窗内可改，确认后才回传） */
  initialSelected?: OrgMultiSelectItem[]

  onConfirm: (items: OrgMultiSelectItem[]) => void

  /** 是否允许勾选部门，默认 true */
  allowDepartments?: boolean

  /** 是否允许勾选人员，默认 true */
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

const getAvatarUrl = (user: ContactUser): string | undefined => {
  const avatar = parseJsonField<{ avatar_72?: string; avatar_240?: string }>(user.avatar)

  return avatar?.avatar_72 ?? avatar?.avatar_240
}

const isResigned = (user: ContactUser) => {
  const status = parseJsonField<{ is_resigned?: boolean }>(user.status)

  return Boolean(status?.is_resigned)
}

/** 由扁平部门列表构建 parent → children 与 id → dept 索引 */
const indexDepartments = (departments: ContactDepartment[]) => {
  const byId = new Map<string, ContactDepartment>()
  const childrenByParent = new Map<string, ContactDepartment[]>()

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
  byId: Map<string, ContactDepartment>
): string => {
  if (!departmentIds?.length) return ''

  // 取第一条主部门，向上拼路径
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
  const [departments, setDepartments] = useState<ContactDepartment[]>([])
  const [users, setUsers] = useState<ContactUser[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [crumbs, setCrumbs] = useState<BreadcrumbNode[]>(ROOT_CRUMBS)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<OrgMultiSelectItem[]>([])

  const { byId, childrenByParent } = useMemo(() => indexDepartments(departments), [departments])

  const loadContact = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [deptRes, userRes] = await Promise.all([
        apiFetch<{ items: ContactDepartment[] }>('/contact/departments'),
        apiFetch<{ items: ContactUser[] }>('/contact/users')
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

  // 仅在「关闭 → 打开」时重置导航/搜索并灌入 initialSelected，避免父组件重渲染把勾选冲掉
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setCrumbs(ROOT_CRUMBS)
      setQuery('')
      setSelected(initialSelected.map(item => ({ ...item })))
      void loadContact()
    }

    wasOpenRef.current = open
  }, [open, initialSelected, loadContact])

  // ⌘/Ctrl + Enter 确认
  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return
      event.preventDefault()
      onConfirm(selected)
      onOpenChange(false)
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onConfirm, onOpenChange, selected])

  const currentDeptId = crumbs[crumbs.length - 1]?.id ?? null
  const searching = query.trim().length > 0
  const keyword = query.trim().toLowerCase()

  const childDepartments = useMemo(() => {
    if (searching) {
      return departments
        .filter(dept => dept.name.toLowerCase().includes(keyword))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    }

    const parentKey = currentDeptId ?? '0'

    return childrenByParent.get(parentKey) ?? []
  }, [searching, departments, keyword, currentDeptId, childrenByParent])

  const visibleUsers = useMemo(() => {
    if (!allowUsers) return []

    if (searching) {
      return users
        .filter(user => user.name.toLowerCase().includes(keyword))
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
    const key = itemKey(item)

    setSelected(prev => (prev.some(row => itemKey(row) === key) ? prev.filter(row => itemKey(row) !== key) : [...prev, item]))
  }

  const removeItem = (item: OrgMultiSelectItem) => {
    const key = itemKey(item)

    setSelected(prev => prev.filter(row => itemKey(row) !== key))
  }

  const drillInto = (dept: ContactDepartment) => {
    setQuery('')
    setCrumbs(prev => [...prev, { id: dept.open_department_id, name: dept.name }])
  }

  const jumpToCrumb = (index: number) => {
    // 「联系人」与「组织内联系人」都回到根列表
    if (index <= 1) {
      setCrumbs(ROOT_CRUMBS)

      return
    }

    setCrumbs(prev => prev.slice(0, index + 1))
  }

  const handleConfirm = () => {
    onConfirm(selected)
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
          {/* 左栏：搜索 / 面包屑 / 可选列表 */}
          <div className='flex min-h-0 min-w-0 flex-1 flex-col border-r'>
            <div className='shrink-0 space-y-3 p-4 pb-2'>
              <InputGroup>
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                  value={query}
                  placeholder={searchPlaceholder}
                  onChange={event => setQuery(event.target.value)}
                />
              </InputGroup>

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
                allowDepartments &&
                childDepartments.map(dept => {
                  const item: OrgMultiSelectDepartment = {
                    kind: 'department',
                    openDepartmentId: dept.open_department_id,
                    name: dept.name,
                    memberCount: dept.member_count
                  }
                  const checked = selectedKeys.has(itemKey(item))

                  return (
                    <div
                      key={dept.open_department_id}
                      className='hover:bg-muted/80 group flex items-center gap-2 rounded-md px-2 py-2'
                    >
                      <Checkbox
                        checked={checked}
                        aria-label={`选择部门 ${dept.name}`}
                        onCheckedChange={() => toggleItem(item)}
                      />
                      <DepartmentIcon />
                      <div className='min-w-0 flex-1'>
                        <div className='truncate text-sm'>
                          {dept.name}
                          <span className='text-muted-foreground'> ({dept.member_count})</span>
                        </div>
                        {searching && (
                          <div className='text-muted-foreground truncate text-xs'>
                            {buildDepartmentPath([dept.open_department_id], byId)}
                          </div>
                        )}
                      </div>
                      {!searching && (
                        <button
                          type='button'
                          className='text-primary shrink-0 px-1 text-sm'
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
                visibleUsers.map(user => {
                  const item: OrgMultiSelectUser = {
                    kind: 'user',
                    openId: user.open_id,
                    name: user.name,
                    avatarUrl: getAvatarUrl(user),
                    departmentPath: buildDepartmentPath(user.department_ids, byId)
                  }
                  const checked = selectedKeys.has(itemKey(item))
                  const isLeader =
                    currentDeptId != null &&
                    (byId.get(currentDeptId)?.leader_user_id === user.open_id ||
                      byId.get(currentDeptId)?.leader_user_id === user.user_id)

                  return (
                    <div
                      key={user.open_id}
                      className='hover:bg-muted/80 flex cursor-pointer items-center gap-2 rounded-md px-2 py-2'
                      onClick={() => toggleItem(item)}
                    >
                      <Checkbox
                        checked={checked}
                        aria-label={`选择 ${user.name}`}
                        onCheckedChange={() => toggleItem(item)}
                        onClick={event => event.stopPropagation()}
                      />
                      <UserAvatar
                        openId={user.open_id}
                        name={user.name}
                        avatarUrl={item.avatarUrl}
                        size='sm'
                        withProfileCard={false}
                      />
                      <div className='min-w-0 flex-1'>
                        <div className='flex items-center gap-1.5'>
                          <span className={cn('truncate text-sm font-medium', searching && 'text-primary')}>
                            {user.name}
                          </span>
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
                    </div>
                  )
                })}
            </div>
          </div>

          {/* 右栏：已选摘要 */}
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
