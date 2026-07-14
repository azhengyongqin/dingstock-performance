'use client'

// React Imports
import { useCallback, useEffect, useState } from 'react'

// Next Imports
import { useRouter, useSearchParams } from 'next/navigation'

// Third-party Imports
import { InfoIcon, Loader2Icon, PlusIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

// Component Imports
import { LarkMemberPickerDialog, UserAvatar, type LarkPickerMember } from '@/components/shared/lark'
import PageHeader from '@/components/shared/PageHeader'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

// Util Imports
import { ApiError, apiFetch } from '@/lib/api'
import type { LarkUserBrief } from '@/lib/perf-api'
import { avatarUrlOf } from '@/lib/perf-api'
import { groupReviewersByRelation, RELATION_LABEL } from './group-reviewers'

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

/** 评审员 → 弹窗成员：已提交锁定不可移除 */
const pickerMemberOf = (entry: SelectedReviewer): LarkPickerMember => ({
  openId: entry.reviewerOpenId,
  name: entry.name,
  avatarUrl: entry.avatarUrl,
  badge: entry.submitted ? '已提交' : undefined,
  removable: !entry.submitted
})

/** 成员 pill：未提交可移除，已提交锁定 */
const MemberPill = ({ entry, onRemove }: { entry: SelectedReviewer; onRemove: (openId: string) => void }) => (
  <div className='bg-muted/60 flex items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-1'>
    <UserAvatar openId={entry.reviewerOpenId} name={entry.name} avatarUrl={entry.avatarUrl} size='sm' />
    <span className='text-sm'>{entry.name ?? entry.reviewerOpenId}</span>
    {entry.submitted ? (
      <Badge className='bg-green-500/10 text-green-600'>已提交</Badge>
    ) : (
      <button
        type='button'
        aria-label={`移除 ${entry.name ?? entry.reviewerOpenId}`}
        className='text-muted-foreground hover:text-destructive'
        onClick={() => onRemove(entry.reviewerOpenId)}
      >
        <XIcon className='size-3.5' />
      </button>
    )}
  </div>
)

/** 推荐 chip：头像 + 姓名 + 推荐原因 + 一键添加；已在名单中的置灰 */
const RecommendationChip = ({
  item,
  added,
  onAdd
}: {
  item: Recommendation
  added: boolean
  onAdd: (item: Recommendation) => void
}) => (
  <div
    className='flex items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-0.5 data-[added=true]:opacity-40'
    data-added={added}
  >
    <UserAvatar openId={item.openId} name={item.user?.name} avatarUrl={avatarUrlOf(item.user)} size='sm' />
    <span className='text-sm'>{item.user?.name ?? item.openId}</span>
    <Badge variant='outline'>{item.reason}</Badge>
    <Button
      variant='ghost'
      size='icon-sm'
      className='size-5 rounded-full'
      disabled={added}
      aria-label={`添加 ${item.user?.name ?? item.openId}`}
      onClick={() => onAdd(item)}
    >
      <PlusIcon className='size-3' />
    </Button>
  </div>
)

/**
 * 评审人推荐与指定页（产品 §7.8）：分组直邀交互——
 * 推荐 chips 一键采纳；五类关系分组行尾「+」打开 LarkMemberPickerDialog，
 * 弹窗内搜索确认后直接以该组关系入组，无需二次调整分组。
 * 保存 = 覆盖式 PUT + knownAssignmentIds 乐观校验：
 * 加载后他人新增的指派不会被本次保存挤掉；移除已提交者会被服务端整单拒绝（409）。
 */
const ReviewerAssign = () => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const participantId = Number(searchParams.get('participant_id'))

  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [selected, setSelected] = useState<SelectedReviewer[]>([])

  /** 考核 Leader 快照：不可被指派为 360°评审员（选人时即时拦截，服务端另有硬校验兜底） */
  const [leaderOpenId, setLeaderOpenId] = useState<string | null>(null)
  const [knownAssignmentIds, setKnownAssignmentIds] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  /** 分组直邀弹窗当前作用的关系分组；null = 关闭 */
  const [inviteRelation, setInviteRelation] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!participantId) {
      setError('缺少 participant_id 参数')
      setLoading(false)

      return
    }

    setLoading(true)
    setError(null)

    try {
      const data = await apiFetch<{
        leaderOpenId?: string | null
        assignments: Assignment[]
        recommendations: Recommendation[]
      }>(`/participants/${participantId}/reviewers`)

      const active = (data.assignments ?? []).filter(assignment => assignment.status !== 'REPLACED')

      setLeaderOpenId(data.leaderOpenId ?? null)
      setRecommendations(data.recommendations ?? [])
      setKnownAssignmentIds(active.map(assignment => assignment.id))
      setSelected(
        active.map(assignment => ({
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

    // 考核 Leader 不进 360°名单（只挡新增，存量指派不受影响）
    if (leaderOpenId && item.openId === leaderOpenId) {
      toast.error('考核 Leader 不可被指派为 360°评审员：上级的评价由上级评估环节承载')

      return
    }

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

  const removeReviewer = (openId: string) => {
    setSelected(prev => prev.filter(item => item.reviewerOpenId !== openId))
  }

  const handleSave = async () => {
    setSaving(true)

    try {
      await apiFetch(`/participants/${participantId}/reviewers`, {
        method: 'PUT',
        body: JSON.stringify({
          items: selected.map(entry => ({ reviewerOpenId: entry.reviewerOpenId, relation: entry.relation })),
          knownAssignmentIds
        })
      })
      toast.success('评审员指派已保存，系统将发送任务通知')
      router.back()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // 服务端护栏整单拒绝（如试图移除已提交者）：提示并重新加载最新名单
        toast.error(err.message)
        void fetchData()
      } else {
        toast.error(err instanceof ApiError ? err.message : '保存失败')
      }
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

  // 五类关系分组默认全部展示（含空组）
  const groups = groupReviewersByRelation(selected, { includeEmpty: true })

  const inviteLabel = inviteRelation ? (RELATION_LABEL[inviteRelation] ?? inviteRelation) : ''

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='评审人推荐与指定'
        description='为被评估人指定 360°评估人；推荐仅是候选，采纳后才生效'
        backHref='/team-review'
        backLabel='团队看板'
      />

      <Card className='mx-auto w-full max-w-3xl'>
        <CardHeader>
          <CardTitle>邀请 360°评估人</CardTitle>
        </CardHeader>
        <CardContent className='flex flex-col gap-4'>
          {/* 360° 邀请规则说明（不设人数规则） */}
          <Alert>
            <InfoIcon />
            <AlertDescription>
              考核 Leader 与 HR 可为员工指定 360°评估人；评估结果仅作参考，员工不可见评估人身份与明细。
            </AlertDescription>
          </Alert>

          {recommendations.length > 0 && (
            <div className='flex flex-col gap-2'>
              <span className='text-sm font-medium'>根据组织架构与历史评审关系推荐</span>
              <div className='flex flex-wrap gap-1.5'>
                {recommendations.map(item => (
                  <RecommendationChip
                    key={item.openId}
                    item={item}
                    added={selected.some(entry => entry.reviewerOpenId === item.openId)}
                    onAdd={recommendation =>
                      addReviewer({
                        openId: recommendation.openId,
                        relation: recommendation.relation,
                        name: recommendation.user?.name,
                        avatarUrl: avatarUrlOf(recommendation.user)
                      })
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {/* 关系分组表格行：左标签列 + 成员 pills + 行尾分组直邀入口 */}
          <div className='overflow-hidden rounded-lg border'>
            {groups.map((group, groupIndex) => (
              <div key={group.relation} className='grid grid-cols-[7.5rem_1fr_auto]'>
                {groupIndex > 0 && <Separator className='col-span-3' />}
                <div className='bg-muted/40 text-muted-foreground flex items-start px-3 py-2.5 text-sm'>
                  {group.label}
                </div>
                <div className='flex flex-wrap items-center gap-1.5 px-3 py-2'>
                  {group.entries.length === 0 ? (
                    <span className='text-muted-foreground/60 text-sm'>暂无评审员</span>
                  ) : (
                    group.entries.map(entry => (
                      <MemberPill key={entry.reviewerOpenId} entry={entry} onRemove={removeReviewer} />
                    ))
                  )}
                </div>
                <div className='flex items-start px-2 py-1.5'>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label={`邀请${group.label}`}
                    onClick={() => setInviteRelation(group.relation)}
                  >
                    <PlusIcon className='size-4' />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className='flex justify-end gap-2'>
            <Button variant='outline' disabled={saving} onClick={() => router.back()}>
              取消
            </Button>
            <Button disabled={saving} onClick={() => void handleSave()}>
              {saving && <Loader2Icon className='size-4 animate-spin' />}
              确定
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 分组直邀弹窗：确认后直接以该组关系入组 */}
      <LarkMemberPickerDialog
        open={inviteRelation !== null}
        onOpenChange={open => {
          if (!open) setInviteRelation(null)
        }}
        title={`邀请「${inviteLabel}」评估人`}
        searchPlaceholder='通过姓名搜索添加评审员'
        members={selected.filter(entry => entry.relation === inviteRelation).map(pickerMemberOf)}
        membersLabel={`「${inviteLabel}」分组当前成员`}
        onConfirm={added => {
          for (const member of added)
            addReviewer({
              openId: member.openId,
              relation: inviteRelation ?? undefined,
              name: member.name,
              avatarUrl: member.avatarUrl
            })
          setInviteRelation(null)
        }}
        onRemoveMember={member => removeReviewer(member.openId)}
      />
    </div>
  )
}

export default ReviewerAssign
