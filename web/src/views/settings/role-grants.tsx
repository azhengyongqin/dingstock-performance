'use client'

// React Imports
import { useCallback, useEffect, useMemo, useState } from 'react'

// Third-party Imports
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { Loader2Icon, ShieldCheckIcon, UsersIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

// Component Imports
import { DataTable } from '@/components/datatable'
import {
  LarkOrgMemberMultiSelectDialog,
  type OrgMultiSelectDepartment,
  type OrgMultiSelectItem,
  type OrgMultiSelectUser
} from '@/components/shared/lark'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// Context Imports
import { useAuth } from '@/contexts/authContext'

// Util Imports
import { ApiError, apiFetch } from '@/lib/api'
import type { ListResponse } from '@/lib/perf-api'

import { buildRoleGrantColumns } from './role-grant-columns'
import type { RoleGrantRow } from './role-grant-columns'

type Department = { open_department_id: string; name: string; member_count?: number }

/** 可授予的显式角色 */
const GRANT_ROLES = [
  { value: 'HR', label: 'HR' },
  { value: 'ADMIN', label: '超级管理员' }
]

/**
 * 角色授权管理（产品 §3.8）：
 * 列表展示 role_grants；ADMIN 可授予 HR/ADMIN、撤销授权；HR 只读。
 * EMPLOYEE/REVIEWER/LEADER 为任务关系派生角色，不在此维护。
 */
const RoleGrantManager = () => {
  const { roles } = useAuth()
  const canManage = roles.includes('ADMIN')

  const [grants, setGrants] = useState<RoleGrantRow[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 一次组织多选：人选 = 被授权人；部门（仅 HR）= 组织范围
  const [selectedUsers, setSelectedUsers] = useState<OrgMultiSelectUser[]>([])
  const [orgScope, setOrgScope] = useState<OrgMultiSelectDepartment[]>([])
  const [role, setRole] = useState<'HR' | 'ADMIN'>('HR')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  // 撤销确认弹窗
  const [revokeTarget, setRevokeTarget] = useState<RoleGrantRow | null>(null)

  const pickerInitialSelected = useMemo<OrgMultiSelectItem[]>(
    () => (role === 'HR' ? [...selectedUsers, ...orgScope] : selectedUsers),
    [role, selectedUsers, orgScope]
  )

  const fetchGrants = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const data = await apiFetch<ListResponse<RoleGrantRow>>('/role-grants')

      setGrants(data.items ?? [])
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('需要 HR / 超级管理员权限')
      } else {
        setError(err instanceof Error ? err.message : '无法加载授权列表')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // 延迟到宏任务，避免在 effect 内同步 setState 触发级联渲染
    const initialLoad = setTimeout(() => {
      void fetchGrants()
      apiFetch<{ items: Department[] }>('/contact/departments')
        .then(data => setDepartments(data.items ?? []))
        .catch(() => undefined)
    }, 0)

    return () => clearTimeout(initialLoad)
  }, [fetchGrants])

  const departmentNameOf = useCallback(
    (id: string) =>
      orgScope.find(dept => dept.openDepartmentId === id)?.name ??
      departments.find(dept => dept.open_department_id === id)?.name ??
      id,
    [departments, orgScope]
  )

  const handleRoleChange = (value: 'HR' | 'ADMIN') => {
    setRole(value)
    // 超级管理员无组织范围
    if (value === 'ADMIN') setOrgScope([])
  }

  const handlePickerConfirm = (items: OrgMultiSelectItem[]) => {
    setSelectedUsers(items.filter((item): item is OrgMultiSelectUser => item.kind === 'user'))
    setOrgScope(
      role === 'HR'
        ? items.filter((item): item is OrgMultiSelectDepartment => item.kind === 'department')
        : []
    )
  }

  const handleCreate = async () => {
    if (selectedUsers.length === 0) {
      toast.error('请先选择被授权人')

      return
    }

    setSaving(true)

    try {
      const scopeIds = role === 'HR' ? orgScope.map(dept => dept.openDepartmentId) : []
      let successCount = 0

      for (const user of selectedUsers) {
        await apiFetch('/role-grants', {
          method: 'POST',
          body: JSON.stringify({
            userOpenId: user.openId,
            role,
            orgScope: scopeIds
          })
        })
        successCount += 1
      }

      toast.success(`已授予 ${successCount} 人${role === 'ADMIN' ? '超级管理员' : ' HR '}角色`)
      setSelectedUsers([])
      setOrgScope([])
      await fetchGrants()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '授权失败')
    } finally {
      setSaving(false)
    }
  }

  const handleRevoke = async () => {
    if (!revokeTarget) return

    try {
      await apiFetch(`/role-grants/${revokeTarget.id}`, { method: 'DELETE' })
      toast.success('授权已撤销')
      setRevokeTarget(null)
      await fetchGrants()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '撤销失败')
    }
  }

  const columns = useMemo(
    () => buildRoleGrantColumns({ onRevoke: setRevokeTarget, departmentNameOf, canManage }),
    [departmentNameOf, canManage]
  )

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: grants,
    columns,
    getCoreRowModel: getCoreRowModel(),
    enableSorting: false
  })

  return (
    <Card>
      <CardHeader>
        <div className='flex items-center gap-3'>
          <div className='bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg'>
            <ShieldCheckIcon className='size-5' />
          </div>
          <CardTitle>角色授权管理</CardTitle>
        </div>
        <CardDescription className='mt-2'>
          显式授予 HR / 超级管理员角色；员工、评审员、Leader 由任务关系自动派生，无需授权。飞书租户超级管理员自动拥有
          ADMIN 权限。{canManage ? '' : '（只读：授予与撤销需要超级管理员）'}
        </CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        {canManage && (
          <div className='flex flex-wrap items-end gap-3 rounded-lg border p-4'>
            <Field className='gap-2'>
              <FieldLabel>角色</FieldLabel>
              <Select value={role} items={GRANT_ROLES} onValueChange={value => handleRoleChange(value as 'HR' | 'ADMIN')}>
                <SelectTrigger className='w-40'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GRANT_ROLES.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field className='min-w-56 flex-1 gap-2'>
              <FieldLabel>授权对象</FieldLabel>
              <div className='flex flex-wrap items-center gap-2'>
                <Button type='button' variant='outline' onClick={() => setPickerOpen(true)}>
                  <UsersIcon />
                  选择
                </Button>
                {selectedUsers.map(user => (
                  <Badge key={user.openId} variant='outline' className='gap-1.5'>
                    {user.name}
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='size-4 rounded-sm'
                      aria-label={`移除 ${user.name}`}
                      onClick={() => setSelectedUsers(prev => prev.filter(item => item.openId !== user.openId))}
                    >
                      <XIcon className='size-3' />
                    </Button>
                  </Badge>
                ))}
                {role === 'HR' &&
                  orgScope.map(dept => (
                    <Badge key={dept.openDepartmentId} variant='secondary' className='gap-1.5'>
                      {dept.name}
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        className='size-4 rounded-sm'
                        aria-label={`移除 ${dept.name}`}
                        onClick={() =>
                          setOrgScope(prev => prev.filter(item => item.openDepartmentId !== dept.openDepartmentId))
                        }
                      >
                        <XIcon className='size-3' />
                      </Button>
                    </Badge>
                  ))}
              </div>
              <FieldDescription>
                {role === 'HR'
                  ? '勾选人员为被授权人；勾选部门为组织范围（可选，留空 = 全局，含子部门）'
                  : '勾选人员为被授权人'}
              </FieldDescription>
            </Field>

            <Button disabled={saving || selectedUsers.length === 0} onClick={() => void handleCreate()}>
              {saving && <Loader2Icon className='size-4 animate-spin' />}
              授予角色
            </Button>

            <LarkOrgMemberMultiSelectDialog
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              allowDepartments={role === 'HR'}
              initialSelected={pickerInitialSelected}
              confirmLabel='确定'
              searchPlaceholder={role === 'HR' ? '搜索人员或部门' : '搜索被授权人'}
              onConfirm={handlePickerConfirm}
            />
          </div>
        )}

        {loading ? (
          <div className='text-muted-foreground flex items-center justify-center gap-2 py-10'>
            <Loader2Icon className='size-4 animate-spin' />
            正在加载授权列表…
          </div>
        ) : error ? (
          <div className='text-destructive py-10 text-center text-sm'>{error}</div>
        ) : (
          <DataTable table={table} emptyText='暂无显式授权；飞书租户超级管理员自动拥有 ADMIN 权限' />
        )}
      </CardContent>

      <Dialog open={Boolean(revokeTarget)} onOpenChange={open => !open && setRevokeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>撤销授权</DialogTitle>
            <DialogDescription>
              确定撤销 {revokeTarget?.user?.name ?? revokeTarget?.userOpenId} 的
              {revokeTarget?.role === 'ADMIN' ? '超级管理员' : ' HR '}角色吗？撤销后立即生效并记录审计日志。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setRevokeTarget(null)}>
              取消
            </Button>
            <Button variant='destructive' onClick={() => void handleRevoke()}>
              确认撤销
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

export default RoleGrantManager
