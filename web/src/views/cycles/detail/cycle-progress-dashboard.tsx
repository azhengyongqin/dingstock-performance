'use client'

import { AlertCircleIcon, ArrowRightIcon, CheckCircle2Icon, Clock3Icon, PlayCircleIcon } from 'lucide-react'

import { StatsCards } from '@/components/shared/StatsCards'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { CycleSetupStepTarget, PerfCycleProgress } from '@/lib/perf-api'

import { buildCycleProgressView } from './cycle-progress-utils'

type Props = {
  progress: PerfCycleProgress
  onNavigate?: (target: CycleSetupStepTarget) => void
}

/** 周期运营看板：仅消费任务开放/完成事实，周期状态只决定粗粒度生命周期文案。 */
const CycleProgressDashboard = ({ progress, onNavigate }: Props) => {
  const view = buildCycleProgressView(progress)
  const completion = view.summary.total > 0 ? Math.round((view.summary.completed / view.summary.total) * 100) : 0

  return (
    <div className='flex flex-col gap-4'>
      <Alert>
        {progress.cycle.status === 'ACTIVE' ? <PlayCircleIcon /> : <Clock3Icon />}
        <AlertTitle>{view.headline}</AlertTitle>
        <AlertDescription className='flex flex-wrap items-center justify-between gap-3'>
          <span>{view.description}</span>
          {view.nextAction.target && onNavigate && (
            <Button size='sm' variant='outline' onClick={() => onNavigate(view.nextAction.target!)}>
              {view.nextAction.label}
              <ArrowRightIcon />
            </Button>
          )}
        </AlertDescription>
      </Alert>

      <StatsCards
        items={[
          { label: '任务总数', value: view.summary.total, description: 'SELF / PEER / MANAGER / AI' },
          { label: '等待开放', value: view.summary.waiting, description: '开始时间前不可填写', icon: <Clock3Icon /> },
          { label: '开放中', value: view.summary.open, description: '提醒时间不会关闭任务', icon: <PlayCircleIcon /> },
          { label: '已完成', value: view.summary.completed, description: `总体完成度 ${completion}%`, icon: <CheckCircle2Icon /> }
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle>任务事实进度</CardTitle>
          <CardDescription>阶段可并行开放；AI 是独立异步参考，不作为周期阶段。</CardDescription>
        </CardHeader>
        <CardContent className='grid gap-3 md:grid-cols-2'>
          {view.stages.map(stage => (
            <div key={stage.stage} className='flex flex-col gap-2 rounded-lg border p-4'>
              <div className='flex items-center justify-between gap-3'>
                <span className='font-medium'>{stage.label}</span>
                <Badge variant='outline'>{stage.completed}/{stage.total} 完成</Badge>
              </div>
              <Progress value={stage.percent} aria-label={`${stage.label}完成度 ${stage.percent}%`} />
              <div className='text-muted-foreground flex flex-wrap gap-3 text-xs'>
                <span>等待开放 {stage.waiting}</span>
                <span>开放中 {stage.open}</span>
                <span>已完成 {stage.completed}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>缺失项与下一步</CardTitle>
          <CardDescription>填写提醒时间是软截止；超过后仍可首次提交、编辑和重新提交。</CardDescription>
        </CardHeader>
        <CardContent>
          {view.missingItems.length === 0 ? (
            <div className='text-muted-foreground flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm'>
              <CheckCircle2Icon className='text-emerald-600' />当前没有未完成的人工任务。
            </div>
          ) : (
            <div className='flex flex-col gap-2'>
              {view.missingItems.map((item, index) => (
                <div
                  key={`${item.code}-${item.taskId ?? item.participantId ?? index}`}
                  className='flex items-start gap-2 rounded-lg border p-3 text-sm'
                >
                  <AlertCircleIcon className='text-amber-600 mt-0.5 size-4 shrink-0' />
                  <span>{item.message}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default CycleProgressDashboard
