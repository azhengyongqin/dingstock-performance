'use client'

import { useEffect, useState } from 'react'

import { RefreshCwIcon, TargetIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getParticipantOkr,
  triggerParticipantOkrSync,
  type OkrIndicatorView,
  type OkrObjectiveView,
  type OkrProgressView,
  type OkrRichText,
  type ParticipantOkrSnapshot
} from '@/lib/perf-api'

const POLL_INTERVAL_MS = 1500

type OkrReferenceContentProps = {
  data?: ParticipantOkrSnapshot | null
  loading?: boolean
  onSync?: () => void
}

/** SDK 富文本只做安全的纯文本投影；链接和人员提及保留可识别文案，不注入 HTML。 */
export const okrRichTextToPlainText = (content?: OkrRichText | null) => {
  if (!content?.blocks?.length) return ''

  return content.blocks
    .map(block => {
      if (block.block_element_type === 'gallery') return '[图片]'

      return (block.paragraph?.elements ?? [])
        .map(element => {
          if (element.paragraph_element_type === 'mention') {
            return element.mention?.user_id ? ` @${element.mention.user_id}` : ''
          }

          if (element.paragraph_element_type === 'docsLink') {
            return element.docs_link?.title ?? element.docs_link?.url ?? ''
          }

          return element.text_run?.text ?? ''
        })
        .join('')
    })
    .filter(Boolean)
    .join('\n')
}

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)))

const progressPercent = (
  progress: OkrProgressView,
  indicator: OkrIndicatorView,
  score: number | null
): number | null => {
  if (progress?.progressPercent != null) return clampPercent(progress.progressPercent)

  if (
    indicator?.currentValue != null &&
    indicator.startValue != null &&
    indicator.targetValue != null &&
    indicator.targetValue !== indicator.startValue
  ) {
    return clampPercent(
      ((indicator.currentValue - indicator.startValue) / (indicator.targetValue - indicator.startValue)) * 100
    )
  }

  if (score == null) return null

  return clampPercent(score <= 1 ? score * 100 : score)
}

const formatEpochDate = (value: string) => {
  const milliseconds = Number(value)
  const date = new Date(Number.isFinite(milliseconds) ? milliseconds : value)

  if (Number.isNaN(date.getTime())) return '日期未知'

  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
}

const formatSyncedAt = (value: string | null) => {
  if (!value) return null
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return null

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

const OkrSkeleton = () => (
  <div aria-label='正在加载 OKR' className='space-y-5 py-1'>
    {[0, 1].map(index => (
      <div key={index} className='space-y-3'>
        <div className='flex items-start gap-2.5'>
          <Skeleton className='bg-muted-foreground/15 size-6 shrink-0 rounded-full' />
          <div className='flex-1 space-y-2'>
            <Skeleton className='bg-muted-foreground/15 h-4 w-4/5' />
            <Skeleton className='bg-muted-foreground/15 h-2 w-full' />
          </div>
        </div>
        <div className='ml-8 space-y-2'>
          <Skeleton className='bg-muted-foreground/15 h-9 w-full' />
          <Skeleton className='bg-muted-foreground/15 h-9 w-11/12' />
        </div>
      </div>
    ))}
  </div>
)

const SyncOkrButton = ({ onSync, syncing = false }: { onSync?: () => void; syncing?: boolean }) => {
  if (!onSync) return null

  return (
    <Button type='button' variant='ghost' size='sm' disabled={syncing} onClick={onSync}>
      <RefreshCwIcon className={syncing ? 'animate-spin' : undefined} />
      {syncing ? '同步中' : '同步 OKR'}
    </Button>
  )
}

const EmptyOkr = ({ onSync }: { onSync?: () => void }) => (
  <div className='flex flex-col items-center rounded-xl border border-dashed px-5 py-12 text-center'>
    <div className='bg-muted mb-3 flex size-10 items-center justify-center rounded-full'>
      <TargetIcon className='text-muted-foreground size-5' />
    </div>
    <p className='text-sm font-medium'>暂无 OKR</p>
    <p className='text-muted-foreground mt-1 max-w-64 text-xs'>该员工当前没有可展示的 OKR</p>
    <div className='mt-3'>
      <SyncOkrButton onSync={onSync} />
    </div>
  </div>
)

const OkrObjective = ({ objective, index }: { objective: OkrObjectiveView; index: number }) => {
  const percent = progressPercent(objective.latestProgress, objective.indicator, objective.score)
  const title = okrRichTextToPlainText(objective.content) || '未命名目标'

  return (
    <div className='space-y-3'>
      <div className='flex items-start gap-2.5'>
        <span className='bg-primary text-primary-foreground mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold'>
          O{index + 1}
        </span>
        <div className='min-w-0 flex-1 space-y-2'>
          <div className='flex items-start justify-between gap-2'>
            <p className='text-sm font-medium whitespace-pre-wrap'>{title}</p>
            {objective.weight != null && (
              <span className='text-muted-foreground shrink-0 text-xs'>权重 {objective.weight}%</span>
            )}
          </div>
          {percent != null && (
            <div className='flex items-center gap-2'>
              <Progress value={percent} className='h-1.5 flex-1' />
              <span className='text-muted-foreground w-8 text-right text-[11px]'>{percent}%</span>
            </div>
          )}
          {objective.category?.name.zh && (
            <Badge variant='outline' className='text-[10px]'>
              {objective.category.name.zh}
            </Badge>
          )}
        </div>
      </div>

      {objective.keyResults.length > 0 ? (
        <ul className='divide-border ml-8 divide-y'>
          {objective.keyResults.map((keyResult, keyResultIndex) => {
            const keyResultPercent = progressPercent(
              keyResult.latestProgress,
              keyResult.indicator,
              keyResult.score
            )

            return (
              <li key={keyResult.id} className='flex items-start justify-between gap-3 py-2.5 text-sm'>
                <p className='text-muted-foreground min-w-0 whitespace-pre-wrap'>
                  <span className='text-foreground font-medium'>KR{keyResultIndex + 1}</span>{' '}
                  {okrRichTextToPlainText(keyResult.content) || '未填写关键结果内容'}
                </p>
                <span className='text-muted-foreground shrink-0 text-xs'>
                  {keyResultPercent != null ? `${keyResultPercent}%` : keyResult.weight != null ? `${keyResult.weight}%` : '—'}
                </span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className='text-muted-foreground ml-8 text-xs'>该目标暂无关键结果</p>
      )}
    </div>
  )
}

/** 纯展示组件，组件实验台可直接注入各种状态；真实页面由 ParticipantOkrContent 负责取数。 */
export const OkrReferenceContent = ({ data, loading = false, onSync }: OkrReferenceContentProps) => {
  const hasObjectives = Boolean(data?.cycles?.some(cycle => cycle.objectives.length > 0))

  if (!hasObjectives && (loading || data?.sync?.status === 'running')) return <OkrSkeleton />

  if (!hasObjectives) return <EmptyOkr onSync={onSync} />

  const syncedAt = formatSyncedAt(data?.lastSyncedAt ?? null)

  return (
    <div className='space-y-5'>
      <div className='text-muted-foreground flex min-h-6 items-center justify-between gap-2 text-[11px]'>
        {data?.sync?.status === 'running' ? (
          <span className='text-primary flex items-center gap-1.5'>
            <RefreshCwIcon className='size-3 animate-spin' />
            正在更新
          </span>
        ) : (
          <span>{syncedAt ? `更新于 ${syncedAt}` : '本地 OKR 快照'}</span>
        )}
        <SyncOkrButton onSync={onSync} syncing={loading || data?.sync?.status === 'running'} />
      </div>

      {data?.cycles?.map(cycle => (
        <section key={cycle.id} className='space-y-4'>
          <div className='flex items-center justify-between gap-3 border-b pb-2'>
            <p className='text-xs font-medium'>
              {formatEpochDate(cycle.startTime)} — {formatEpochDate(cycle.endTime)}
            </p>
            <Badge variant='secondary' className='text-[10px]'>
              {cycle.objectives.length} 个目标
            </Badge>
          </div>
          {cycle.objectives.length > 0 ? (
            <div className='space-y-5'>
              {cycle.objectives.map((objective, index) => (
                <OkrObjective key={objective.id} objective={objective} index={index} />
              ))}
            </div>
          ) : (
            <p className='text-muted-foreground text-xs'>该周期暂无目标</p>
          )}
        </section>
      ))}
    </div>
  )
}

/**
 * 页面进入即先读本地快照，再幂等触发被评人的单人同步；运行期间轮询同一读接口，
 * 因此有缓存时不会阻塞展示，无缓存时则保持骨架直到同步落库或明确失败。
 */
export const useParticipantOkr = (participantId: number, enabled = true) => {
  const [data, setData] = useState<ParticipantOkrSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [startingSync, setStartingSync] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!enabled) return

    let active = true
    let pollTimer: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      try {
        const next = await getParticipantOkr(participantId)

        if (!active) return
        setData(next)
        if (next.sync?.status === 'running') pollTimer = setTimeout(() => void poll(), POLL_INTERVAL_MS)
      } catch {
        // 同步错误仅供服务端诊断；前端保留已有数据，或统一落到无数据状态。
      }
    }

    const initialize = async () => {
      setLoading(true)
      setStartingSync(true)

      // 同一参与者重新初始化时保留旧快照；participantId 改变时必须清空，避免串人。
      setData(previous => (previous?.participantId === participantId ? previous : null))

      try {
        const cached = await getParticipantOkr(participantId)

        if (!active) return
        setData(cached)
      } catch {
        // 本地快照读取失败时不向用户暴露接口错误，继续尝试后台同步。
      } finally {
        if (active) setLoading(false)
      }

      try {
        const status = await triggerParticipantOkrSync(participantId)

        if (!active) return
        setData(previous => (previous ? { ...previous, sync: status } : previous))
        setStartingSync(false)
        if (status.status === 'running') pollTimer = setTimeout(() => void poll(), POLL_INTERVAL_MS)
        else await poll()
      } catch {
        if (!active) return
        setStartingSync(false)
      }
    }

    void initialize()

    return () => {
      active = false
      if (pollTimer) clearTimeout(pollTimer)
    }
  }, [enabled, participantId, reloadKey])

  return {
    data,
    loading: loading || startingSync,
    sync: () => setReloadKey(previous => previous + 1)
  }
}

export const useParticipantOkrReference = (
  participantId: number,
  previewData?: ParticipantOkrSnapshot
) => {
  const live = useParticipantOkr(participantId, !previewData)

  return previewData ? { data: previewData, loading: false, sync: undefined } : live
}

const LiveParticipantOkrContent = ({ participantId }: { participantId: number }) => {
  const state = useParticipantOkr(participantId)

  return <OkrReferenceContent data={state.data} loading={state.loading} onSync={state.sync} />
}

export const ParticipantOkrContent = ({
  participantId,
  previewData
}: {
  participantId: number

  /** 组件实验台注入固定状态时不访问真实接口。 */
  previewData?: ParticipantOkrSnapshot
}) =>
  previewData ? <OkrReferenceContent data={previewData} /> : <LiveParticipantOkrContent participantId={participantId} />

/** 页面尚未开放评估表单时仍按“进入即同步”执行，但不额外渲染 OKR 区域。 */
export const ParticipantOkrWarmup = ({ participantId }: { participantId: number }) => {
  useParticipantOkr(participantId)

  return null
}
