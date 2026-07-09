'use client'

// React Imports
import { useCallback, useEffect, useState } from 'react'

// Third-party Imports
import { ChevronRightIcon, Loader2Icon, MoreVerticalIcon, PlusIcon, StarIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'

// Component Imports
import PageHeader from '@/components/shared/PageHeader'
import {
  DEFAULT_COMMENT_REQUIRED_RULES,
  DEFAULT_EVALUATION_RATINGS
} from '@/components/shared/evaluation-rule-editor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

// Util Imports
import { ApiError, apiFetch } from '@/lib/api'
import type { ListResponse, PerfTemplate } from '@/lib/perf-api'

import TemplateSheet from './template-sheet'

/**
 * 配置模板（HR/ADMIN）：行式列表 + 侧滑抽屉编辑（2026-07 原型验证的胜出交互：
 * 列表收敛为一行一模板，点行打开 Sheet 就地编辑，维度按岗位分组行内展开，无跳转无弹层）。
 * 修改模板不影响已用其创建的周期（创建周期时为复制快照）。
 */
const TemplateManager = () => {
  const [templates, setTemplates] = useState<PerfTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // 编辑抽屉与删除确认目标
  const [sheetId, setSheetId] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PerfTemplate | null>(null)

  const fetchTemplates = useCallback(async () => {
    setError(null)

    try {
      const data = await apiFetch<ListResponse<PerfTemplate>>('/templates')

      setTemplates(data.items ?? [])
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('需要 HR / 超级管理员权限')
      } else {
        setError(err instanceof Error ? err.message : '无法加载模板列表')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // 延迟到宏任务，避免在 effect 内同步 setState 触发级联渲染
    const initialLoad = setTimeout(() => void fetchTemplates(), 0)

    return () => clearTimeout(initialLoad)
  }, [fetchTemplates])

  /** 新建模板：默认四档评估规则骨架，创建后直接打开编辑抽屉完善配置 */
  const handleCreate = async () => {
    setCreating(true)

    try {
      const created = await apiFetch<PerfTemplate>('/templates', {
        method: 'POST',
        body: JSON.stringify({
          name: `新模板 ${new Date().toLocaleDateString('zh-CN')}`,
          levels: DEFAULT_EVALUATION_RATINGS,
          commentRequiredRules: DEFAULT_COMMENT_REQUIRED_RULES
        })
      })

      await fetchTemplates()
      setSheetId(created.id)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '创建失败')
    } finally {
      setCreating(false)
    }
  }

  /** 设为默认：全局唯一，后端负责取消其他模板的默认标记 */
  const handleSetDefault = async (id: number) => {
    try {
      await apiFetch(`/templates/${id}`, { method: 'PATCH', body: JSON.stringify({ isDefault: true }) })
      toast.success('已设为默认模板')
      await fetchTemplates()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '设置失败')
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await apiFetch(`/templates/${id}`, { method: 'DELETE' })
      toast.success('模板已删除（软删除；已创建的周期不受影响）')
      await fetchTemplates()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败')
    }
  }

  if (loading) {
    return (
      <div className='text-muted-foreground flex items-center justify-center gap-2 py-24'>
        <Loader2Icon className='size-4 animate-spin' />
        正在加载配置模板…
      </div>
    )
  }

  if (error) {
    return <div className='text-destructive py-24 text-center text-sm'>{error}</div>
  }

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='配置模板'
        description='评估规则 + 评估维度的跨周期复用母本；创建周期时复制为周期快照，改模板不影响已创建的周期'
        actions={
          <Button disabled={creating} onClick={() => void handleCreate()}>
            {creating ? <Loader2Icon className='size-4 animate-spin' /> : <PlusIcon className='size-4' />}
            新建模板
          </Button>
        }
      />

      {/* 行式列表：点行打开编辑抽屉 */}
      <Card className='py-0'>
        <CardContent className='divide-y px-0'>
          {templates.length === 0 && (
            <p className='text-muted-foreground px-6 py-10 text-center text-sm'>暂无模板，点击右上角「新建模板」创建</p>
          )}
          {templates.map(template => (
            <div
              key={template.id}
              className='hover:bg-muted/50 flex cursor-pointer items-center gap-3 px-5 py-3.5 first:rounded-t-xl last:rounded-b-xl'
              onClick={() => setSheetId(template.id)}
            >
              <div className='min-w-0 flex-1'>
                <div className='flex items-center gap-2'>
                  <span className='truncate text-sm font-medium'>{template.name}</span>
                  {template.isDefault && <Badge className='bg-primary/10 text-primary shrink-0'>默认</Badge>}
                </div>
                {template.description && (
                  <p className='text-muted-foreground mt-0.5 line-clamp-1 text-xs'>{template.description}</p>
                )}
              </div>
              <span className='text-muted-foreground hidden shrink-0 text-xs sm:block'>
                维度 {template._count?.dimensions ?? 0} 个 · 已用于 {template._count?.cycles ?? 0} 个周期
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant='ghost' size='icon-sm' onClick={event => event.stopPropagation()} />}
                >
                  <MoreVerticalIcon className='size-4' />
                  <span className='sr-only'>更多操作</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  {!template.isDefault && (
                    <DropdownMenuItem onClick={() => void handleSetDefault(template.id)}>
                      <StarIcon className='size-4' />
                      设为默认
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem variant='destructive' onClick={() => setDeleteTarget(template)}>
                    <Trash2Icon className='size-4' />
                    删除模板
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <ChevronRightIcon className='text-muted-foreground size-4 shrink-0' />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 编辑抽屉 */}
      <TemplateSheet templateId={sheetId} onClose={() => setSheetId(null)} onSaved={() => void fetchTemplates()} />

      {/* 删除确认 */}
      <Dialog open={deleteTarget != null} onOpenChange={value => !value && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除模板</DialogTitle>
            <DialogDescription>
              确定删除「{deleteTarget?.name}」吗？软删除后不可在新建周期时选择；已用该模板创建的周期不受影响。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button
              variant='destructive'
              onClick={() => {
                if (deleteTarget) void handleDelete(deleteTarget.id)
                setDeleteTarget(null)
              }}
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default TemplateManager
