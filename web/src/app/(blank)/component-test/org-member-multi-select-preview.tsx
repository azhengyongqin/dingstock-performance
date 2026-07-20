'use client'

/**
 * PROTOTYPE — 人员/组织多选弹窗三变体。
 * 问题：飞书双栏钻取（A）vs 左树右表（B）vs 搜索优先单栏（C），哪套更适合本系统周期加人/授权场景？
 * 切换：?variant=A|B|C + 底部 PrototypeSwitcher；← → 亦可切换。
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'

import { ChevronRightIcon, Loader2Icon, NetworkIcon, SearchIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import {
  LarkMemberSelector,
  LarkOrgMemberMultiSelectDialog,
  UserAvatar,
  type OrgMultiSelectItem,
  type LarkSelectorOption
} from '@/components/shared/lark'
import { PrototypeSwitcher, usePrototypeVariant, type PrototypeVariantMeta } from '@/components/shared/PrototypeSwitcher'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { ScrollArea } from '@/components/ui/scroll-area'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

const VARIANTS: PrototypeVariantMeta[] = [
  { key: 'A', name: '飞书双栏钻取' },
  { key: 'B', name: '左树右表' },
  { key: 'C', name: '搜索优先单栏' }
]

type ContactDepartment = {
  open_department_id: string
  name: string
  parent_department_id: string
  member_count: number
}

type ContactUser = {
  open_id: string
  name: string
  avatar?: { avatar_72?: string; avatar_240?: string } | string
  department_ids?: string[]
}

type DeptNode = ContactDepartment & { children: DeptNode[] }

const buildTree = (departments: ContactDepartment[]): DeptNode[] => {
  const map = new Map<string, DeptNode>()

  departments.forEach(dept => map.set(dept.open_department_id, { ...dept, children: [] }))

  const roots: DeptNode[] = []

  map.forEach(node => {
    const parent = node.parent_department_id ? map.get(node.parent_department_id) : undefined

    if (!node.parent_department_id || node.parent_department_id === '0' || !parent) roots.push(node)
    else parent.children.push(node)
  })

  return roots
}

const avatarOf = (user: ContactUser) => {
  if (!user.avatar) return undefined
  if (typeof user.avatar === 'string') {
    try {
      const parsed = JSON.parse(user.avatar) as { avatar_72?: string; avatar_240?: string }

      return parsed.avatar_72 ?? parsed.avatar_240
    } catch {
      return undefined
    }
  }

  return user.avatar.avatar_72 ?? user.avatar.avatar_240
}

const useContactData = (enabled: boolean) => {
  const [departments, setDepartments] = useState<ContactDepartment[]>([])
  const [users, setUsers] = useState<ContactUser[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [deptRes, userRes] = await Promise.all([
        apiFetch<{ items: ContactDepartment[] }>('/contact/departments'),
        apiFetch<{ items: ContactUser[] }>('/contact/users')
      ])

      setDepartments(deptRes.items ?? [])
      setUsers(userRes.items ?? [])
    } catch {
      setError('无法加载 /contact 数据')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return

    const timer = setTimeout(() => void reload(), 0)

    return () => clearTimeout(timer)
  }, [enabled, reload])

  return { departments, users, loading, error, reload }
}

const StateDump = ({ label, value }: { label: string; value: unknown }) => (
  <pre className='bg-muted max-h-48 overflow-auto rounded-md p-3 text-[11px] leading-relaxed'>
    {label}
    {'\n'}
    {JSON.stringify(value, null, 2)}
  </pre>
)

/** A — 截图还原：飞书双栏钻取（主候选） */
const VariantA = () => {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<OrgMultiSelectItem[]>([])

  return (
    <div className='grid gap-4 xl:grid-cols-2'>
      <Card>
        <CardHeader>
          <CardTitle>变体 A · 飞书双栏钻取</CardTitle>
          <CardDescription>
            左：搜索 + 面包屑 + 部门「下级」钻取 / 勾选；右：已选人与部门；⌘+Enter 确定。数据来自真实通讯录。
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-3'>
          <Button type='button' onClick={() => setOpen(true)}>
            打开组织多选弹窗
          </Button>
          <LarkOrgMemberMultiSelectDialog
            open={open}
            onOpenChange={setOpen}
            initialSelected={selected}
            onConfirm={items => {
              setSelected(items)
              toast.success(`已确认 ${items.length} 项`)
            }}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>当前状态</CardTitle>
          <CardDescription>确认后回写到业务方的受控值</CardDescription>
        </CardHeader>
        <CardContent>
          <StateDump label='selected' value={selected} />
        </CardContent>
      </Card>
    </div>
  )
}

const TreeRow = ({
  node,
  depth,
  activeId,
  onSelect
}: {
  node: DeptNode
  depth: number
  activeId: string | null
  onSelect: (id: string) => void
}) => {
  const [expanded, setExpanded] = useState(depth < 1)
  const hasChildren = node.children.length > 0

  return (
    <li>
      <div
        className={cn(
          'hover:bg-muted flex cursor-pointer items-center gap-1 rounded-md py-1.5 pr-2 text-sm',
          activeId === node.open_department_id && 'bg-primary/10 text-primary'
        )}
        style={{ paddingInlineStart: `${depth * 12 + 4}px` }}
        onClick={() => onSelect(node.open_department_id)}
      >
        {hasChildren ? (
          <button
            type='button'
            className='hover:bg-background/80 flex size-5 items-center justify-center rounded'
            onClick={event => {
              event.stopPropagation()
              setExpanded(prev => !prev)
            }}
          >
            <ChevronRightIcon className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
          </button>
        ) : (
          <span className='size-5' />
        )}
        <NetworkIcon className='size-3.5 shrink-0 opacity-70' />
        <span className='truncate'>{node.name}</span>
        <span className='text-muted-foreground ml-auto text-xs'>{node.member_count}</span>
      </div>
      {hasChildren && expanded && (
        <ul>
          {node.children.map(child => (
            <TreeRow
              key={child.open_department_id}
              node={child}
              depth={depth + 1}
              activeId={activeId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

/** B — 左部门树 + 右成员勾选表（组织架构页信息架构） */
const VariantB = () => {
  const [open, setOpen] = useState(false)
  const [deptId, setDeptId] = useState<string | null>(null)
  const [picked, setPicked] = useState<ContactUser[]>([])
  const [confirmed, setConfirmed] = useState<ContactUser[]>([])
  const { departments, users, loading, error, reload } = useContactData(open)
  const tree = useMemo(() => buildTree(departments), [departments])

  const members = useMemo(() => {
    if (!deptId) return users.slice(0, 40)

    return users.filter(user => user.department_ids?.includes(deptId))
  }, [deptId, users])

  const pickedIds = useMemo(() => new Set(picked.map(user => user.open_id)), [picked])

  const toggle = (user: ContactUser) => {
    setPicked(prev =>
      prev.some(row => row.open_id === user.open_id) ? prev.filter(row => row.open_id !== user.open_id) : [...prev, user]
    )
  }

  return (
    <div className='grid gap-4 xl:grid-cols-2'>
      <Card>
        <CardHeader>
          <CardTitle>变体 B · 左树右表</CardTitle>
          <CardDescription>
            左侧常驻部门树（类似组织架构页），右侧勾选当前部门成员；不支持直接选部门实体。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type='button'
            onClick={() => {
              setPicked(confirmed)
              setOpen(true)
            }}
          >
            打开左树右表弹窗
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent showCloseButton={false} className='flex h-[min(85vh,36rem)] flex-col gap-0 p-0 sm:max-w-4xl'>
              <DialogTitle className='sr-only'>按部门选择人员</DialogTitle>
              <div className='flex min-h-0 flex-1'>
                <ScrollArea className='w-56 shrink-0 border-r p-2'>
                  {loading && (
                    <div className='text-muted-foreground flex items-center gap-2 p-4 text-xs'>
                      <Loader2Icon className='size-3.5 animate-spin' />
                      加载中
                    </div>
                  )}
                  {error && (
                    <div className='space-y-2 p-3 text-xs'>
                      <p className='text-destructive'>{error}</p>
                      <Button size='sm' variant='outline' onClick={() => void reload()}>
                        重试
                      </Button>
                    </div>
                  )}
                  {!loading && !error && (
                    <ul>
                      <li>
                        <button
                          type='button'
                          className={cn(
                            'hover:bg-muted mb-1 w-full rounded-md px-2 py-1.5 text-left text-sm',
                            !deptId && 'bg-primary/10 text-primary'
                          )}
                          onClick={() => setDeptId(null)}
                        >
                          全部成员（预览前 40）
                        </button>
                      </li>
                      {tree.map(node => (
                        <TreeRow
                          key={node.open_department_id}
                          node={node}
                          depth={0}
                          activeId={deptId}
                          onSelect={setDeptId}
                        />
                      ))}
                    </ul>
                  )}
                </ScrollArea>
                <div className='flex min-w-0 flex-1 flex-col'>
                  <div className='text-muted-foreground border-b px-4 py-2 text-sm'>已勾选 {picked.length} 人</div>
                  <ScrollArea className='min-h-0 flex-1 px-2 py-2'>
                    {members.map(user => (
                      <label
                        key={user.open_id}
                        className='hover:bg-muted/80 flex cursor-pointer items-center gap-2 rounded-md px-2 py-2'
                      >
                        <Checkbox checked={pickedIds.has(user.open_id)} onCheckedChange={() => toggle(user)} />
                        <UserAvatar
                          openId={user.open_id}
                          name={user.name}
                          avatarUrl={avatarOf(user)}
                          size='sm'
                          withProfileCard={false}
                        />
                        <span className='text-sm'>{user.name}</span>
                      </label>
                    ))}
                  </ScrollArea>
                </div>
              </div>
              <DialogFooter className='border-t px-4 py-3'>
                <Button variant='outline' onClick={() => setOpen(false)}>
                  取消
                </Button>
                <Button
                  onClick={() => {
                    setConfirmed(picked)
                    setOpen(false)
                    toast.success(`已确认 ${picked.length} 人`)
                  }}
                >
                  确定
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>当前状态</CardTitle>
          <CardDescription>仅人员，无部门实体</CardDescription>
        </CardHeader>
        <CardContent>
          <StateDump
            label='confirmed'
            value={confirmed.map(user => ({ openId: user.open_id, name: user.name }))}
          />
        </CardContent>
      </Card>
    </div>
  )
}

/** C — 搜索优先：沿用现有 LarkMemberSelector，单栏已选胶囊，无组织树 */
const VariantC = () => {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<{ openId: string; name: string; avatarUrl?: string }[]>([])
  const [confirmed, setConfirmed] = useState<{ openId: string; name: string; avatarUrl?: string }[]>([])
  const [filter, setFilter] = useState('')

  const visible = useMemo(() => {
    const keyword = filter.trim().toLowerCase()

    if (!keyword) return picked

    return picked.filter(item => item.name.toLowerCase().includes(keyword))
  }, [filter, picked])

  const handleSelect = (option: LarkSelectorOption) => {
    if (!option.id) return
    const name = option.entity?.name ?? option.name ?? option.label ?? option.id
    const avatarUrl = option.entity?.avatarUrl ?? option.avatarUrl

    setPicked(prev =>
      prev.some(item => item.openId === option.id)
        ? prev
        : [...prev, { openId: option.id as string, name, avatarUrl }]
    )
  }

  return (
    <div className='grid gap-4 xl:grid-cols-2'>
      <Card>
        <CardHeader>
          <CardTitle>变体 C · 搜索优先单栏</CardTitle>
          <CardDescription>
            复用现有飞书 Selector 搜人，无部门树；适合「只加几个熟人」的轻量场景，不能选部门。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type='button'
            onClick={() => {
              setPicked(confirmed)
              setOpen(true)
            }}
          >
            打开搜索优先弹窗
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className='flex max-h-[min(85vh,32rem)] flex-col gap-4 sm:max-w-lg'>
              <DialogTitle>搜索添加人员</DialogTitle>
              <LarkMemberSelector fluid placeholder='搜索员工姓名' onSelect={handleSelect} />
              <InputGroup>
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                  value={filter}
                  placeholder='筛选已选…'
                  onChange={event => setFilter(event.target.value)}
                />
              </InputGroup>
              <div className='flex min-h-0 flex-1 flex-wrap content-start gap-2 overflow-y-auto rounded-md border p-3'>
                {visible.length === 0 ? (
                  <span className='text-muted-foreground text-sm'>尚未选择人员</span>
                ) : (
                  visible.map(item => (
                    <div
                      key={item.openId}
                      className='bg-muted flex items-center gap-1.5 rounded-full py-0.5 pr-2 pl-0.5'
                    >
                      <UserAvatar
                        openId={item.openId}
                        name={item.name}
                        avatarUrl={item.avatarUrl}
                        size='sm'
                        withProfileCard={false}
                      />
                      <span className='text-sm'>{item.name}</span>
                      <button
                        type='button'
                        aria-label={`移除 ${item.name}`}
                        className='text-muted-foreground hover:text-destructive'
                        onClick={() => setPicked(prev => prev.filter(row => row.openId !== item.openId))}
                      >
                        <XIcon className='size-3.5' />
                      </button>
                    </div>
                  ))
                )}
              </div>
              <DialogFooter>
                <Button variant='outline' onClick={() => setOpen(false)}>
                  取消
                </Button>
                <Button
                  onClick={() => {
                    setConfirmed(picked)
                    setOpen(false)
                    toast.success(`已确认 ${picked.length} 人`)
                  }}
                >
                  确定
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>当前状态</CardTitle>
          <CardDescription>飞书搜索结果 → 胶囊列表</CardDescription>
        </CardHeader>
        <CardContent>
          <StateDump label='confirmed' value={confirmed} />
        </CardContent>
      </Card>
    </div>
  )
}

const OrgMemberMultiSelectPreviewInner = () => {
  const variant = usePrototypeVariant(VARIANTS)

  return (
    <div className='flex flex-col gap-4 pb-20'>
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            人员/组织多选 · UI 原型
            <Badge variant='outline'>PROTOTYPE</Badge>
          </CardTitle>
          <CardDescription>
            三个结构不同的变体，共用真实 `/contact` 数据。底部切换条或 URL `?variant=A|B|C`；键盘 ← →
            亦可切换（输入框聚焦时不拦截）。
          </CardDescription>
        </CardHeader>
      </Card>

      {variant?.key === 'B' ? <VariantB /> : variant?.key === 'C' ? <VariantC /> : <VariantA />}

      <PrototypeSwitcher variants={VARIANTS} />
    </div>
  )
}

const OrgMemberMultiSelectPreview = () => (
  <Suspense fallback={<div className='text-muted-foreground p-6 text-sm'>加载原型…</div>}>
    <OrgMemberMultiSelectPreviewInner />
  </Suspense>
)

export default OrgMemberMultiSelectPreview
