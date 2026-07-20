'use client'

import { useId } from 'react'

import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import {
  EVALUATION_LEVEL_NAME,
  EVALUATION_LEVEL_STYLES,
  EvaluationContentSection,
  EvaluationLevelRow
} from '@/components/shared/EvaluationReferenceSection'
import { UserAvatar } from '@/components/shared/lark'
import { EvaluationAnswerContent } from '@/components/shared/markdown'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { type ChartConfig, ChartContainer, ChartTooltip } from '@/components/ui/chart'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  avatarUrlOf,
  type PerfConfigReviewerRelation,
  type PerfPeerReviewAnalysis,
  type PerfPeerReviewAnalysisDimension,
  type PerfPeerReviewAnalysisField,
  type PerfPeerStageResult,
  type PerfPerformanceLevel
} from '@/lib/perf-api'
import { cn } from '@/lib/utils'

const LEVELS: PerfPerformanceLevel[] = ['C', 'B', 'A', 'S']
const RELATION_ORDER: PerfConfigReviewerRelation[] = ['ORG_OWNER', 'PROJECT_OWNER', 'PEER', 'CROSS_DEPT']

const DISTRIBUTION_CHART_CONFIG = {
  count: {
    label: '评审人数',
    color: 'var(--primary)'
  }
} satisfies ChartConfig

const RELATION_LABELS: Record<PerfConfigReviewerRelation, string> = {
  ORG_OWNER: '组织负责人',
  PROJECT_OWNER: '项目负责人',
  PEER: '同部门同事',
  CROSS_DEPT: '跨部门协作方'
}

const LEVEL_STYLES: Record<PerfPerformanceLevel, { badge: string }> = {
  S: { badge: EVALUATION_LEVEL_STYLES.S },
  A: { badge: EVALUATION_LEVEL_STYLES.A },
  B: { badge: EVALUATION_LEVEL_STYLES.B },
  C: { badge: EVALUATION_LEVEL_STYLES.C }
}

type ChartReviewer = PerfPeerReviewAnalysis['reviewers'][number]

type DistributionChartDatum = {
  level: PerfPerformanceLevel
  count: number
  reviewers: ChartReviewer[]
}

/** 柱状图 tooltip：等级徽章 + 人数，下方按评审关系分组展示评审员 */
const DistributionTooltip = ({
  active,
  payload
}: {
  active?: boolean
  payload?: Array<{ payload?: DistributionChartDatum }>
}) => {
  if (!active || !payload?.length) return null

  const datum = payload[0]?.payload

  if (!datum) return null

  const groups = RELATION_ORDER.flatMap(relation => {
    const reviewers = datum.reviewers.filter(review => review.relation === relation)

    return reviewers.length > 0 ? [{ relation, reviewers }] : []
  })

  return (
    <div className='bg-background min-w-60 rounded-xl border px-3 py-2.5 text-xs shadow-lg'>
      <div className='flex items-center justify-between gap-3 border-b pb-2'>
        <Badge variant='outline' className={cn('tabular-nums', LEVEL_STYLES[datum.level].badge)}>
          {datum.level} · {EVALUATION_LEVEL_NAME[datum.level]}
        </Badge>
        <span className='text-muted-foreground tabular-nums'>{datum.count} 人</span>
      </div>
      {groups.length > 0 && (
        <div className='mt-2 space-y-2'>
          {groups.map(({ relation, reviewers }) => (
            <div key={relation}>
              <p className='text-muted-foreground mb-1 text-[10px]'>{RELATION_LABELS[relation]}</p>
              <div className='grid grid-cols-2 gap-1'>
                {reviewers.map(review => {
                  const name = review.reviewer?.name ?? '未知评审员'

                  return (
                    <div key={review.submissionId} className='flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1'>
                      <UserAvatar
                        openId={review.reviewerOpenId}
                        name={name}
                        avatarUrl={avatarUrlOf(review.reviewer)}
                        size='sm'
                        withProfileCard={false}
                      />
                      <span className='truncate'>{name}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const formatScore = (value: string | null) => {
  if (value === null) return '—'
  const score = Number(value)

  return Number.isFinite(score) ? score.toFixed(2) : value
}

const fieldValue = (field: PerfPeerReviewAnalysisField) => {
  if (typeof field.value === 'string') return field.value
  if (Array.isArray(field.value)) return field.value.map(String).join('、')
  if (field.value !== null && field.value !== undefined) return JSON.stringify(field.value)

  return '—'
}

const RatingBadge = ({ level, label }: { level: PerfPerformanceLevel; label?: string }) => (
  <Badge variant='outline' className={cn('tabular-nums', LEVEL_STYLES[level].badge)}>
    {label ? `${label} ${level}` : level}
  </Badge>
)

/** 飞书式摘要：左侧色条标题 + 右侧等级；下一行「已提交 m/n，综合分 x：关系人数」 */
const PeerResultSummary = ({
  analysis,
  compositeScore,
  stageLevel
}: {
  analysis: PerfPeerReviewAnalysis
  compositeScore: string | null
  stageLevel: PerfPerformanceLevel | null
}) => (
  <section className='space-y-1.5'>
    <div className='flex items-center justify-between gap-3'>
      <div className='flex min-w-0 items-center gap-2'>
        <span className='bg-primary h-3.5 w-0.5 shrink-0 rounded-full' aria-hidden />
        <h2 className='min-w-0 truncate text-base font-semibold'>360°评估结果</h2>
      </div>
      {stageLevel && (
        <div className='flex shrink-0 items-center gap-1.5'>
          <Badge variant='outline' className={cn('text-sm font-semibold tabular-nums', LEVEL_STYLES[stageLevel].badge)}>
            {stageLevel}
          </Badge>
          <span className='text-sm font-medium'>{EVALUATION_LEVEL_NAME[stageLevel]}</span>
        </div>
      )}
    </div>
    <p className='text-muted-foreground text-xs leading-relaxed'>
      已提交{' '}
      <span className='text-primary font-semibold tabular-nums'>
        {analysis.submittedReviewerCount}/{analysis.assignedReviewerCount}
      </span>
      {compositeScore !== null && (
        <>
          ，综合分 <span className='text-primary font-semibold tabular-nums'>{formatScore(compositeScore)}</span>
        </>
      )}
      {analysis.relationCounts.length > 0 && (
        <>
          ：
          {analysis.relationCounts.map((item, index) => (
            <span key={item.relation}>
              {index > 0 ? '，' : null}
              {RELATION_LABELS[item.relation]}{' '}
              <span className='text-primary font-semibold tabular-nums'>{item.reviewerCount}</span>
            </span>
          ))}
        </>
      )}
    </p>
  </section>
)

const shortDimensionName = (name: string) => {
  if (name.includes('贡献')) return '贡献'
  if (name.includes('协作') || name.includes('价值观')) return '协作'
  if (name.includes('领导')) return '领导力'
  if (name.includes('业绩')) return '业绩'

  return name.length > 4 ? name.slice(0, 4) : name
}

/** 折叠态：维度简称 + 等级徽章横排摘要 */
const DimensionSummary = ({ dimensions }: { dimensions: PerfPeerReviewAnalysisDimension[] }) => (
  <div className='flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-5'>
    {dimensions.filter(item => item.mappedLevel !== null).map(item => (
      <span key={item.id} className='text-muted-foreground flex items-center gap-1.5 text-xs'>
        {shortDimensionName(item.name)}
        <Badge
          variant='outline'
          className={cn(
            'h-5 min-w-5 justify-center px-1.5 tabular-nums',
            EVALUATION_LEVEL_STYLES[item.mappedLevel!]
          )}
        >
          {item.mappedLevel}
        </Badge>
      </span>
    ))}
  </div>
)

/** 展开态：维度等级行 + 评语内容板块，复用 EvaluationReferenceSection */
const ExpandedReviewSections = ({
  dimensions
}: {
  dimensions: PerfPeerReviewAnalysisDimension[]
}) => (
  <div className='ml-5 space-y-6'>
    {dimensions.map(item => {
      return (
        <div key={item.id} className='space-y-6'>
          {item.mappedLevel && <EvaluationLevelRow title={item.name} level={item.mappedLevel} />}
          {item.fields.map(field => (
            <EvaluationContentSection key={field.fieldKey} title={field.title}>
              <EvaluationAnswerContent type={field.type} value={fieldValue(field)} />
            </EvaluationContentSection>
          ))}
        </div>
      )
    })}
  </div>
)

const PeerReviewAnalysisPanel = ({ result }: { result: PerfPeerStageResult }) => {
  const chartIdPrefix = useId().replace(/:/g, '')
  const { analysis } = result

  return (
    <Tabs defaultValue='overview' className='gap-4'>
      {/* 吸顶时保留与上方 ScrollableTabsList 相同的 pt-4 间距 */}
      {/* 与左侧参考区 Card 同底，避免 dark 下 bg-background 更深显出黑块 */}
      <div className='bg-card sticky top-0 z-10 space-y-3 pt-4 pb-1'>
        <PeerResultSummary
          analysis={analysis}
          compositeScore={result.compositeScore}
          stageLevel={result.stageLevel}
        />
        <TabsList>
          <TabsTrigger value='overview'>概览</TabsTrigger>
          <TabsTrigger value='details'>评审明细</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value='overview' className='space-y-4'>
        <div className='space-y-6'>
          {analysis.dimensions.length === 0 && (
            <p className='text-muted-foreground py-6 text-center text-sm'>暂无已提交的 360°评估</p>
          )}
          {analysis.dimensions.map((item, dimensionIndex) => {
            const chartData = LEVELS.map(level => ({
              level,
              count: item.distribution[level],
              reviewers: analysis.reviewers.filter(reviewer =>
                reviewer.dimensions.some(dimension => dimension.id === item.id && dimension.mappedLevel === level)
              )
            }))

            const chartDescription = chartData.map(entry => `${entry.level} ${entry.count} 人`).join('，')
            const descriptionId = `${chartIdPrefix}-peer-distribution-${dimensionIndex}-${item.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`

            return (
              <article key={item.id} className='space-y-2'>
                <div className='flex items-center justify-between gap-3'>
                  <h2 className='min-w-0 truncate text-xs font-semibold'>{item.name}</h2>
                  <div className='flex shrink-0 items-center gap-2'>
                    <span className='text-muted-foreground text-xs tabular-nums'>{formatScore(item.score)} 分</span>
                    <RatingBadge level={item.level} />
                  </div>
                </div>
                <div className='bg-muted/50 rounded-xl px-4 py-3.5'>
                  <ChartContainer
                    role='img'
                    aria-label={`${item.name}评级人数柱状图`}
                    aria-describedby={descriptionId}
                    config={DISTRIBUTION_CHART_CONFIG}
                    initialDimension={{ width: 320, height: 176 }}
                    className='aspect-auto h-44 w-full'
                  >
                    <BarChart accessibilityLayer data={chartData} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
                      <CartesianGrid vertical={false} strokeDasharray='4 4' />
                      <XAxis dataKey='level' tickLine={false} axisLine={false} />
                      <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={28} />
                      <ChartTooltip
                        cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
                        content={<DistributionTooltip />}
                      />
                      <Bar dataKey='count' fill='var(--color-count)' radius={[5, 5, 0, 0]} maxBarSize={34} />
                    </BarChart>
                  </ChartContainer>
                  <p id={descriptionId} className='sr-only'>
                    {chartDescription}
                  </p>
                </div>
              </article>
            )
          })}
        </div>
      </TabsContent>

      <TabsContent value='details' className='space-y-4'>
        {analysis.reviewers.length > 0 ? (
          <Accordion className='gap-0'>
            {analysis.reviewers.map(review => {
              const reviewerName = review.reviewer?.name ?? '未知评审员'
              const dimensions = review.dimensions

              return (
                <AccordionItem
                  key={review.submissionId}
                  value={String(review.submissionId)}
                  className='border-border/70 px-0'
                >
                  <AccordionTrigger className='items-start gap-2 py-3 hover:no-underline **:data-[slot=accordion-trigger-icon]:hidden'>
                    <span className='flex min-w-0 flex-1 flex-col gap-2'>
                      <span className='flex min-w-0 items-center gap-2'>
                        <ChevronRightIcon className='text-foreground size-3.5 shrink-0 group-aria-expanded/accordion-trigger:hidden' />
                        <ChevronDownIcon className='text-foreground hidden size-3.5 shrink-0 group-aria-expanded/accordion-trigger:inline' />
                        <UserAvatar
                          openId={review.reviewerOpenId}
                          name={reviewerName}
                          avatarUrl={avatarUrlOf(review.reviewer)}
                          size='sm'
                          withProfileCard={false}
                        />
                        <span className='truncate text-sm font-semibold'>{reviewerName}</span>
                        <span className='text-muted-foreground shrink-0 text-xs font-normal'>
                          {RELATION_LABELS[review.relation]}
                        </span>
                      </span>
                      <DimensionSummary dimensions={dimensions} />
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className='pb-3'>
                    <ExpandedReviewSections dimensions={dimensions} />
                  </AccordionContent>
                </AccordionItem>
              )
            })}
          </Accordion>
        ) : (
          <p className='text-muted-foreground py-6 text-center text-sm'>没有符合筛选条件的评审明细</p>
        )}
      </TabsContent>
    </Tabs>
  )
}

export default PeerReviewAnalysisPanel
