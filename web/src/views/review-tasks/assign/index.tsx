'use client'

// React Imports
import { useCallback, useEffect, useState } from 'react'

// Next Imports
import { useRouter, useSearchParams } from 'next/navigation'

// Third-party Imports
import { Loader2Icon, PlusIcon, SaveIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'

// Component Imports
import { LarkMemberSelector, UserAvatar } from '@/components/shared/lark'
import PageHeader from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// Util Imports
import { ApiError, apiFetch } from '@/lib/api'
import type { LarkUserBrief } from '@/lib/perf-api'
import { avatarUrlOf } from '@/lib/perf-api'

// ===== 类型（GET /participants/:pid/reviewers 响应） =====

type Assignment = {
  id: number
  reviewerOpenId: string
  relation: string
  source: string
  status: 'PENDING' | 'SUBMITTED' | 'REPLACED'
  recommendReason?: string | null
  reviewer: LarkUserBrief | null
}

type Recommendation = {
  openId: string
  relation: string
  reason: string
  user: LarkUserBrief | null
}

/** 本地编辑态的一条评审员选择 */
type SelectedReviewer = {
  reviewerOpenId: string
  relation: string
  name?: string
  avatarUrl?: string
  submitted?: boolean
}

const RELATION_LABEL: Record<string, string> = {
  LEADER: '直属上级',
  PEER: '同事',
  CROSS_DEPT: '跨部门协作',
  ORG_OWNER: '组织负责人',
  PROJECT_OWNER: '项目负责人'
}

/** 评审关系下拉选项 */
const RELATION_OPTIONS = Object.entries(RELATION_LABEL).map(([value, label]) => ({ value, label }))

/**
 * 评审人推荐与指定页（产品 §7.8）：
 * 左侧系统推荐（直属上级/组织负责人/同部门/历史评审关系），右侧当前指派名单。
 * 保存 = 覆盖式 PUT，未提交的被移除者置 REPLACED（后端保证留痕）。
 */
const ReviewerAssign = () => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const participantId = Number(searchParams.get('participant_id'))

  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [selected, setSelected] = useState<SelectedReviewer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    if (!participantId) {
      setError('缺少 participant_id 参数')
      setLoading(false)

      return
    }

    setLoading(true)
    setError(null)

    try {
      const data = await apiFetch<{ assignments: Assignment[]; recommendations: Recommendation[] }>(
        `/participants/${participantId}/reviewers`
      )

      setRecommendations(data.recommendations ?? [])
      setSelected(
        (data.assignments ?? [])
          .filter(assignment => assignment.status !== 'REPLACED')
          .map(assignment => ({
            reviewerOpenId: assignment.reviewerOpenId,
            relation: assignment.relation,
            name: assignment.reviewer?.name,
            avatarUrl: avatarUrlOf(assignment.reviewer),
            submitted: assignment.status === 'SUBMITTED'
          }))
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法加载评审员数据')
    } finally {
      setLoading(false)
    }
  }, [participantId])

  useEffect(() => {
    // 延迟到宏任务，避免在 effect 内同步 setState 触发级联渲染
    const initialLoad = setTimeout(() => void fetchData(), 0)

    return () => clearTimeout(initialLoad)
  }, [fetchData])

  const addReviewer = (item: { openId?: string; relation?: string; name?: string; avatarUrl?: string }) => {
    if (!item.openId) return

    setSelected(prev => {
      if (prev.some(entry => entry.reviewerOpenId === item.openId)) {
        toast.info('该评审员已在名单中')

        return prev
      }

      return [
        ...prev,
        {
          reviewerOpenId: item.openId!,
          relation: item.relation ?? 'PEER',
          name: item.name,
          avatarUrl: item.avatarUrl
        }
      ]
    })
  }

  const handleSave = async () => {
    if (selected.length === 0) {
      toast.error('请至少保留一名评审员')

      return
    }

    setSaving(true)

    try {
      await apiFetch(`/participants/${participantId}/reviewers`, {
        method: 'PUT',
        body: JSON.stringify({
          items: selected.map(entry => ({ reviewerOpenId: entry.reviewerOpenId, relation: entry.relation }))
        })
      })
      toast.success('评审员指派已保存，系统将发送任务通知')
      router.back()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className='text-muted-foreground flex items-center justify-center gap-2 py-24'>
        <Loader2Icon className='size-4 animate-spin' />
        正在加载评审员数据…
      </div>
    )
  }

  if (error) {
    return (
      <div className='text-destructive flex flex-col items-center gap-3 py-24 text-sm'>
        {error}
        <Button variant='outline' size='sm' onClick={() => void fetchData()}>
          重试
        </Button>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='评审人推荐与指定'
        description='系统按直属上级 / 组织负责人 / 同部门 / 历史评审关系推荐；Leader 确认或 HR 补充后生效'
        actions={
          <Button disabled={saving} onClick={() => void handleSave()}>
            {saving ? <Loader2Icon className='size-4 animate-spin' /> : <SaveIcon />}
            保存指派
          </Button>
        }
      />

      <div className='grid gap-6 lg:grid-cols-2'>
        {/* 左侧：系统推荐 */}
        <Card>
          <CardHeader>
            <CardTitle>系统推荐</CardTitle>
            <CardDescription>点击「添加」加入右侧指派名单</CardDescription>
          </CardHeader>
          <CardContent className='flex flex-col gap-2'>
            {recommendations.length === 0 ? (
              <span className='text-muted-foreground py-6 text-center text-sm'>暂无推荐</span>
            ) : (
              recommendations.map(item => {
                const added = selected.some(entry => entry.reviewerOpenId === item.openId)

                return (
                  <div key={item.openId} className='flex items-center justify-between rounded-lg border p-2.5'>
                    <div className='flex items-center gap-2'>
                      <UserAvatar
                        openId={item.openId}
                        name={item.user?.name}
                        avatarUrl={avatarUrlOf(item.user)}
                        size='sm'
                      />
                      <div className='flex flex-col'>
                        <span className='text-sm font-medium'>{item.user?.name ?? item.openId}</span>
                        <span className='text-muted-foreground text-xs'>{item.user?.job_title ?? ''}</span>
                      </div>
                      <Badge variant='outline'>{item.reason}</Badge>
                    </div>
                    <Button
                      variant='outline'
                      size='sm'
                      disabled={added}
                      onClick={() =>
                        addReviewer({
                          openId: item.openId,
                          relation: item.relation,
                          name: item.user?.name,
                          avatarUrl: avatarUrlOf(item.user)
                        })
                      }
                    >
                      <PlusIcon />
                      {added ? '已添加' : '添加'}
                    </Button>
                  </div>
                )
              })
            )}

            <div className='mt-2 border-t pt-3'>
              <div className='text-muted-foreground mb-2 text-xs'>没有合适人选？直接搜索添加：</div>
              <LarkMemberSelector
                placeholder='搜索并选择评审员'
                onSelect={option =>
                  addReviewer({
                    openId: option.id as string | undefined,
                    name: (option.name ?? option.label) as string | undefined,
                    avatarUrl: option.avatarUrl as string | undefined
                  })
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* 右侧：当前指派名单 */}
        <Card>
          <CardHeader>
            <CardTitle>当前指派名单（{selected.length} 人）</CardTitle>
            <CardDescription>已提交评估的评审员不可移除；移除未提交者将保留更换痕迹</CardDescription>
          </CardHeader>
          <CardContent className='flex flex-col gap-2'>
            {selected.length === 0 ? (
              <span className='text-muted-foreground py-6 text-center text-sm'>尚未指派评审员</span>
            ) : (
              selected.map(entry => (
                <div key={entry.reviewerOpenId} className='flex items-center justify-between rounded-lg border p-2.5'>
                  <div className='flex items-center gap-2'>
                    <UserAvatar
                      openId={entry.reviewerOpenId}
                      name={entry.name}
                      avatarUrl={entry.avatarUrl}
                      size='sm'
                    />
                    <span className='text-sm font-medium'>{entry.name ?? entry.reviewerOpenId}</span>
                    {entry.submitted && <Badge className='bg-green-500/10 text-green-600'>已提交</Badge>}
                  </div>
                  <div className='flex items-center gap-2'>
                    <Select
                      value={entry.relation}
                      items={RELATION_OPTIONS}
                      disabled={entry.submitted}
                      onValueChange={value =>
                        setSelected(prev =>
                          prev.map(item =>
                            item.reviewerOpenId === entry.reviewerOpenId
                              ? { ...item, relation: value as string }
                              : item
                          )
                        )
                      }
                    >
                      <SelectTrigger className='min-w-32' size='sm'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RELATION_OPTIONS.map(option => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!entry.submitted && (
                      <Button
                        variant='ghost'
                        size='icon-sm'
                        onClick={() =>
                          setSelected(prev => prev.filter(item => item.reviewerOpenId !== entry.reviewerOpenId))
                        }
                      >
                        <Trash2Icon className='text-destructive size-3.5' />
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default ReviewerAssign
