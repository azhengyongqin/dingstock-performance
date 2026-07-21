'use client'

// React Imports
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Third-party Imports
import type { ColumnFiltersState, PaginationState, SortingState, VisibilityState } from '@tanstack/react-table'
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable
} from '@tanstack/react-table'
import { ChevronDownIcon, ChevronRightIcon, NetworkIcon, RefreshCwIcon, UsersIcon } from 'lucide-react'
import { toast } from 'sonner'

// Component Imports
import {
  DataTable,
  DataTableColumnFilter,
  DataTablePagination,
  DataTableToolbar,
  DataTableViewOptions
} from '@/components/datatable'
import PageHeader from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

// Util Imports
import { apiFetch } from '@/lib/api'
import { matchesPinyinSearch } from '@/lib/pinyin-search'

import { MEMBER_STATUS_OPTIONS, buildMemberTableColumns } from './member-table-columns'
import type { LarkUser } from './member-table-columns'

// ===== 后端数据类型（NestJS /contact 模块） =====

/** 飞书部门 */
type Department = {
  open_department_id: string
  department_id: string
  name: string
  parent_department_id: string
  member_count: number
  leader_user_id?: string
}

/** 同步状态 */
type SyncStatus = {
  status: 'idle' | 'running' | string
}

/** 由扁平部门列表构建的树节点 */
type DepartmentNode = Department & { children: DepartmentNode[] }

// 按 parent_department_id 构建部门树：parent 为 "0" 或找不到父节点的作为根
const buildDepartmentTree = (departments: Department[]): DepartmentNode[] => {
  const nodeMap = new Map<string, DepartmentNode>()

  departments.forEach(dept => {
    nodeMap.set(dept.open_department_id, { ...dept, children: [] })
  })

  const roots: DepartmentNode[] = []

  nodeMap.forEach(node => {
    const parent = node.parent_department_id ? nodeMap.get(node.parent_department_id) : undefined

    if (node.parent_department_id === '0' || !parent) {
      roots.push(node)
    } else {
      parent.children.push(node)
    }
  })

  return roots
}

/** 部门树节点（递归渲染，支持展开/收起） */
const DepartmentTreeItem = ({
  node,
  depth,
  selectedId,
  onSelect
}: {
  node: DepartmentNode
  depth: number
  selectedId: string | null
  onSelect: (id: string) => void
}) => {
  // 默认收起部门树，避免大组织首次进入页面时展开过长。
  const [expanded, setExpanded] = useState(false)
  const hasChildren = node.children.length > 0

  return (
    <li>
      <div
        className={cn(
          'hover:bg-muted flex cursor-pointer items-center gap-1 rounded-md py-1.5 pr-2 transition-colors',
          selectedId === node.open_department_id && 'bg-primary/10 text-primary'
        )}
        style={{ paddingInlineStart: `${depth * 16 + 8}px` }}
        onClick={() => onSelect(node.open_department_id)}
      >
        {hasChildren ? (
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='size-5 shrink-0'
            aria-label={expanded ? '收起子部门' : '展开子部门'}
            onClick={e => {
              e.stopPropagation()
              setExpanded(prev => !prev)
            }}
          >
            {expanded ? <ChevronDownIcon className='size-4' /> : <ChevronRightIcon className='size-4' />}
          </Button>
        ) : (
          <span className='size-5 shrink-0' />
        )}
        <NetworkIcon className='size-4 shrink-0 opacity-70' />
        <span className='truncate text-sm'>{node.name}</span>
        <span className='text-muted-foreground ml-auto shrink-0 text-xs'>{node.member_count}</span>
      </div>
      {hasChildren && expanded && (
        <ul>
          {node.children.map(child => (
            <DepartmentTreeItem
              key={child.open_department_id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

/**
 * 组织架构页（唯一接真实后端的页面）：
 * 左侧部门树 + 右侧成员 Data Table（完整 users-list 模式：搜索 + 状态筛选 + 分页）
 * + 顶部「同步组织架构」按钮。
 * 数据来源：NestJS 后端 /contact/departments、/contact/users、/contact/sync。
 */
const Organization = () => {
  // 部门数据
  const [departments, setDepartments] = useState<Department[]>([])
  const [departmentsLoading, setDepartmentsLoading] = useState(true)
  const [departmentsError, setDepartmentsError] = useState<string | null>(null)

  // 成员数据
  const [users, setUsers] = useState<LarkUser[]>([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [usersError, setUsersError] = useState<string | null>(null)

  // 当前选中的部门（null 表示全部成员）
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null)

  // 同步中状态
  const [syncing, setSyncing] = useState(false)

  // 轮询定时器引用（组件卸载时清理）
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 成员表格状态：姓名/邮箱搜索、状态筛选、排序、分页与列显隐
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })

  // 列较多（CoreHR 详情列），默认隐藏次要列，用户可通过「列显示」下拉自选
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    job_family: false,
    tenure: false,
    email: false,
    mobile: false
  })

  // 拉取部门列表
  const fetchDepartments = useCallback(async () => {
    setDepartmentsLoading(true)
    setDepartmentsError(null)

    try {
      const data = await apiFetch<{ items: Department[] }>('/contact/departments')

      setDepartments(data.items ?? [])
    } catch {
      setDepartmentsError('无法加载部门数据，请确认后端服务已启动（默认 http://localhost:3000）。')
    } finally {
      setDepartmentsLoading(false)
    }
  }, [])

  // 拉取成员列表（可按部门过滤）
  const fetchUsers = useCallback(async (departmentId: string | null) => {
    setUsersLoading(true)
    setUsersError(null)

    try {
      const query = departmentId ? `?department_id=${encodeURIComponent(departmentId)}` : ''
      const data = await apiFetch<{ items: LarkUser[] }>(`/contact/users${query}`)

      setUsers(data.items ?? [])
    } catch {
      setUsersError('无法加载成员数据，请确认后端服务已启动。')
    } finally {
      setUsersLoading(false)
    }
  }, [])

  // 首次加载：部门 + 全部成员（放入宏任务，避免在 effect 中同步 setState）
  useEffect(() => {
    const initialLoad = setTimeout(() => {
      fetchDepartments()
      fetchUsers(null)
    }, 0)

    return () => {
      clearTimeout(initialLoad)
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [fetchDepartments, fetchUsers])

  // 切换部门时刷新成员
  const handleSelectDepartment = (id: string) => {
    const next = id === selectedDeptId ? null : id

    setSelectedDeptId(next)
    fetchUsers(next)
  }

  // 触发全量同步并轮询状态
  const handleSync = async () => {
    setSyncing(true)

    try {
      await apiFetch('/contact/sync', { method: 'POST' })
      toast.info('已触发组织架构同步，正在同步中…')

      // 每 2 秒轮询一次同步状态，完成后刷新列表
      pollTimerRef.current = setInterval(async () => {
        try {
          const statusData = await apiFetch<SyncStatus>('/contact/sync/status')

          if (statusData.status !== 'running') {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current)
            pollTimerRef.current = null
            setSyncing(false)
            toast.success('组织架构同步完成')
            fetchDepartments()
            fetchUsers(selectedDeptId)
          }
        } catch {
          // 状态查询失败：停止轮询并提示
          if (pollTimerRef.current) clearInterval(pollTimerRef.current)
          pollTimerRef.current = null
          setSyncing(false)
          toast.error('查询同步状态失败，请稍后手动刷新')
        }
      }, 2000)
    } catch {
      setSyncing(false)
      toast.error('触发同步失败，请确认后端服务已启动')
    }
  }

  // 部门树（memo 避免重复构建）
  const departmentTree = useMemo(() => buildDepartmentTree(departments), [departments])

  // 部门名称解析：部门列表已全量加载，构建 ID -> 名称映射给列定义使用
  const memberColumns = useMemo(() => {
    const nameById = new Map(departments.map(dept => [dept.open_department_id, dept.name]))

    return buildMemberTableColumns({ getDepartmentName: id => nameById.get(id) })
  }, [departments])

  // 成员 Data Table：真实后端数据 + 客户端搜索/筛选/分页/列显隐
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: users,
    columns: memberColumns,
    state: { globalFilter, columnFilters, sorting, pagination, columnVisibility },
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    onColumnVisibilityChange: setColumnVisibility,
    getRowId: user => user.open_id,

    // 全局搜索：姓名/英文名支持拼音与首字母；邮箱/工号走原文包含
    globalFilterFn: (row, _columnId, filterValue) => {
      const keyword = String(filterValue).trim()

      if (!keyword) return true

      const user = row.original
      const lower = keyword.toLowerCase()

      if (matchesPinyinSearch(user.name ?? '', keyword)) return true
      if (user.en_name && matchesPinyinSearch(user.en_name, keyword)) return true
      if (user.email?.toLowerCase().includes(lower)) return true
      if (user.corehr?.employee_number?.toLowerCase().includes(lower)) return true

      return false
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableSortingRemoval: false
  })

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='组织架构'
        description='从飞书同步的部门与成员数据（真实后端接口）'
        actions={
          <Button onClick={handleSync} disabled={syncing}>
            <RefreshCwIcon className={cn(syncing && 'animate-spin')} />
            {syncing ? '同步中…' : '同步组织架构'}
          </Button>
        }
      />

      <div className='grid gap-6 lg:grid-cols-[300px_1fr]'>
        {/* 左侧：部门树 */}
        <Card className='h-fit'>
          <CardHeader>
            <CardTitle className='text-base'>部门</CardTitle>
            <CardDescription>点击部门筛选成员，再次点击取消筛选</CardDescription>
          </CardHeader>
          <CardContent>
            {departmentsLoading ? (

              // 加载态
              <div className='flex flex-col gap-2'>
                <Skeleton className='h-7 w-full' />
                <Skeleton className='h-7 w-4/5' />
                <Skeleton className='h-7 w-3/5' />
              </div>
            ) : departmentsError ? (

              // 错误态（后端未启动等）
              <p className='text-muted-foreground text-sm'>{departmentsError}</p>
            ) : departmentTree.length === 0 ? (

              // 空态
              <p className='text-muted-foreground text-sm'>暂无部门数据，请点击右上角「同步组织架构」。</p>
            ) : (
              <ul className='flex flex-col gap-0.5'>
                {departmentTree.map(node => (
                  <DepartmentTreeItem
                    key={node.open_department_id}
                    node={node}
                    depth={0}
                    selectedId={selectedDeptId}
                    onSelect={handleSelectDepartment}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* 右侧：成员 Data Table */}
        <Card>
          <CardHeader>
            <div className='flex items-center gap-2'>
              <UsersIcon className='size-5' />
              <CardTitle className='text-base'>成员</CardTitle>
              {!usersLoading && !usersError && <Badge variant='outline'>{users.length} 人</Badge>}
            </div>
            <CardDescription>{selectedDeptId ? '当前展示所选部门的成员' : '当前展示全部成员'}</CardDescription>
          </CardHeader>
          <CardContent>
            {usersLoading ? (

              // 加载态
              <div className='flex flex-col gap-3'>
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className='h-12 w-full' />
                ))}
              </div>
            ) : usersError ? (

              // 错误态
              <div className='text-muted-foreground flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center text-sm'>
                <span>{usersError}</span>
                <Button variant='outline' size='sm' onClick={() => fetchUsers(selectedDeptId)}>
                  重试
                </Button>
              </div>
            ) : users.length === 0 ? (

              // 空态
              <div className='text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-sm'>
                <span>暂无成员数据</span>
                <span>可点击右上角「同步组织架构」从飞书拉取最新数据</span>
              </div>
            ) : (
              <>
                {/* 工具栏：统一 SearchInput（支持拼音）+ 在职状态筛选 + 列显隐自选 */}
                <DataTableToolbar table={table} enableGlobalSearch searchPlaceholder='搜索姓名、邮箱或工号'>
                  <DataTableColumnFilter
                    column={table.getColumn('status')}
                    label='状态'
                    options={MEMBER_STATUS_OPTIONS}
                  />
                  <DataTableViewOptions table={table} />
                </DataTableToolbar>

                <DataTable table={table} emptyText='没有匹配的成员' />

                <DataTablePagination table={table} />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default Organization
