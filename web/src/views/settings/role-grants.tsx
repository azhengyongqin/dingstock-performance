'use client'

// React Imports
import { useCallback, useEffect, useMemo, useState } from 'react'

// Third-party Imports
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { Loader2Icon, PlusIcon, ShieldCheckIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

// Component Imports
import { DataTable } from '@/components/datatable'
import { LarkMemberSelector } from '@/components/shared/lark'
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
import { Field, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// Context Imports
import { useAuth } from '@/contexts/authContext'

// Util Imports
import { ApiError, apiFetch } from '@/lib/api'
import type { ListResponse } from '@/lib/perf-api'

import { buildRoleGrantColumns } from './role-grant-columns'
import type { RoleGrantRow } from './role-grant-columns'

type Department = { open_department_id: string; name: string }

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

  // 新增授权表单态
  const [selectedUser, setSelectedUser] = useState<{ openId: string; name?: string } | null>(null)
  const [role, setRole] = useState<'HR' | 'ADMIN'>('HR')
  const [orgScope, setOrgScope] = useState<string[]>([])
  const [scopeDept, setScopeDept] = useState('')

  // 组织范围下拉选项（排除已加入范围的部门）
  const scopeDeptOptions = departments
    .filter(dept => !orgScope.includes(dept.open_department_id))
    .map(dept => ({ value: dept.open_department_id, label: dept.name }))

  const [saving, setSaving] = useState(false)

  // 撤销确认弹窗
  const [revokeTarget, setRevokeTarget] = useState<RoleGrantRow | null>(null)

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
    (id: string) => departments.find(dept => dept.open_department_id === id)?.name ?? id,
    [departments]
  )

  const handleCreate = async () => {
    if (!selectedUser) {
      toast.error('请先选择被授权人')

      return
    }

    setSaving(true)

    try {
      await apiFetch('/role-grants', {
        method: 'POST',
        body: JSON.stringify({
          userOpenId: selectedUser.openId,
          role,
          orgScope: role === 'HR' ? orgScope : []
        })
      })
      toast.success(`已授予 ${selectedUser.name ?? selectedUser.openId} ${role === 'ADMIN' ? '超级管理员' : 'HR'} 角色`)
      setSelectedUser(null)
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
        {/* 新增授权（仅 ADMIN） */}
        {canManage && (
          <div className='flex flex-wrap items-end gap-3 rounded-lg border p-4'>
            <Field className='gap-2'>
              <FieldLabel>被授权人</FieldLabel>
              {selectedUser ? (
                <div className='flex h-9 items-center gap-2'>
                  <Badge variant='outline' className='gap-1.5'>
                    {selectedUser.name ?? selectedUser.openId}
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='size-4 rounded-sm'
                      aria-label='移除被授权人'
                      onClick={() => setSelectedUser(null)}
                    >
                      <XIcon className='size-3' />
                    </Button>
                  </Badge>
                </div>
              ) : (
                <LarkMemberSelector
                  placeholder='搜索并选择员工'
                  onSelect={option => {
                    if (option.id) {
                      setSelectedUser({ openId: option.id as string, name: (option.name ?? option.label) as string })
                    }
                  }}
                />
              )}
            </Field>

            <Field className='gap-2'>
              <FieldLabel>角色</FieldLabel>
              <Select value={role} items={GRANT_ROLES} onValueChange={value => setRole(value as 'HR' | 'ADMIN')}>
                <SelectTrigger className='w-full'>
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

            {/* 组织范围：仅 HR 角色可限定；留空 = 全局 */}
            {role === 'HR' && (
              <Field className='gap-2'>
                <FieldLabel>组织范围（可选，留空 = 全局；含子部门）</FieldLabel>
                <div className='flex flex-wrap items-center gap-2'>
                  <Select
                    value={scopeDept || null}
                    items={scopeDeptOptions}
                    onValueChange={value => setScopeDept((value as string | null) ?? '')}
                  >
                    <SelectTrigger className='min-w-44'>
                      <SelectValue placeholder='选择部门…' />
                    </SelectTrigger>
                    <SelectContent>
                      {scopeDeptOptions.map(option => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={!scopeDept}
                    onClick={() => {
                      setOrgScope(prev => [...prev, scopeDept])
                      setScopeDept('')
                    }}
                  >
                    <PlusIcon />
                    添加
                  </Button>
                  {orgScope.map(id => (
                    <Badge key={id} variant='outline' className='gap-1.5'>
                      {departmentNameOf(id)}
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        className='size-4 rounded-sm'
                        aria-label='移除组织范围'
                        onClick={() => setOrgScope(prev => prev.filter(item => item !== id))}
                      >
                        <XIcon className='size-3' />
                      </Button>
                    </Badge>
                  ))}
                </div>
              </Field>
            )}

            <Button disabled={saving || !selectedUser} onClick={() => void handleCreate()}>
              {saving && <Loader2Icon className='size-4 animate-spin' />}
              授予角色
            </Button>
          </div>
        )}

        {/* 授权列表：basic 变体 */}
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

      {/* 撤销确认 */}
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
