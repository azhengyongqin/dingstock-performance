'use client'

import { useState } from 'react'

import { Loader2Icon, PlayIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type {
  PerfConfigTemplateVersion,
  PerfFormTemplateVersionSummary,
  PerfJobLevelPrefix,
  PerfPerformanceLevel
} from '@/lib/perf-api'
import { getPerfFormTemplateVersion, previewPerfConfigTemplateCalculation } from '@/lib/perf-api'

import { resolveBindingSubforms } from './config-template-utils'

type PreviewDimension = { id: number; name: string; value: string }

const ConfigCalculationPreview = ({
  version,
  candidates
}: {
  version: PerfConfigTemplateVersion
  candidates: PerfFormTemplateVersionSummary[]
}) => {
  const [stage, setStage] = useState<'SELF' | 'PEER' | 'MANAGER' | 'AI'>('PEER')
  const [prefix, setPrefix] = useState<PerfJobLevelPrefix>('D')
  const [directRating, setDirectRating] = useState<PerfPerformanceLevel>('B')
  const [dimensions, setDimensions] = useState<PreviewDimension[]>([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [unavailable, setUnavailable] = useState<string[]>([])

  const binding = version.formBindings?.find(item => item.jobLevelPrefix === prefix)

  const bindingId = (() => {
    const expanded = binding?.formTemplateVersionId

    if (expanded) return expanded

    return version.formTemplateVersionIds.find(
      id => candidates.find(candidate => candidate.id === id)?.jobLevelPrefix === prefix
    )
  })()

  const prepare = async () => {
    if (stage === 'SELF' || stage === 'AI') {
      setDimensions([])
      setUnavailable([])
      setResult(null)

      return
    }

    if (!bindingId) {
      setUnavailable([`尚未绑定 ${prefix} 职级的已发布评估表单版本`])

      return
    }

    setLoading(true)
    setUnavailable([])
    setResult(null)

    try {
      const subforms = resolveBindingSubforms(binding) ?? (await getPerfFormTemplateVersion(bindingId)).subforms
      const subform = subforms.find(item => item.type === stage)
      const expectedType = version.stageModes[stage] === 'WEIGHTED_RATING' ? 'RATING' : 'SCORE'

      const nextDimensions = (subform?.dimensions ?? [])
        .filter(dimension => dimension.type === 'SCORING')
        .filter(dimension => dimension.scoringMethod === expectedType)
        .filter(dimension => dimension.id != null)
        .map(dimension => ({
          id: dimension.id as number,
          name: dimension.name,
          value: expectedType === 'RATING' ? 'B' : '75'
        }))

      if (nextDimensions.length === 0) {
        setUnavailable([`${prefix} 表单没有与${stage === 'PEER' ? '360°' : '上级'}阶段模式兼容的常规计分维度`])
      }

      setDimensions(nextDimensions)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法加载预览表单')
    } finally {
      setLoading(false)
    }
  }

  const calculate = async () => {
    setLoading(true)
    setUnavailable([])

    try {
      const response = await previewPerfConfigTemplateCalculation(version.id, {
        stage,
        jobLevelPrefix: prefix,
        ...(stage === 'SELF' || stage === 'AI' ? { directRating } : {}),
        ...(stage === 'PEER' || stage === 'MANAGER'
          ? {
              dimensions: dimensions.map(dimension => ({
                dimensionId: dimension.id,
                relations:
                  stage === 'PEER'
                    ? Object.keys(version.reviewerRelationWeights).map(type => ({
                        type: type as 'ORG_OWNER' | 'PROJECT_OWNER' | 'PEER' | 'CROSS_DEPT',
                        rawValues: [String(dimension.value)]
                      }))
                    : [{ type: 'LEADER' as const, rawValues: [String(dimension.value)] }]
              }))
            }
          : {})
      })

      if (response.status === 'UNAVAILABLE') {
        setUnavailable(response.issues.map(issue => issue.message))
        setResult(null)
      } else {
        setResult(response.result)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '计算预览失败')
    } finally {
      setLoading(false)
    }
  }

  const mode = version.stageModes[stage]

  return (
    <div className='flex flex-col gap-5'>
      <div>
        <h3 className='font-medium'>共享引擎计算预览</h3>
        <p className='text-muted-foreground text-sm'>
          选择阶段和职级，以绑定表单的常规维度构造样例输入，并由后端权威计算。
        </p>
      </div>
      <div className='grid gap-4 md:grid-cols-3'>
        <Field className='gap-2'>
          <FieldLabel>阶段</FieldLabel>
          <Select
            value={stage}
            items={[
              { value: 'SELF', label: '员工自评' },
              { value: 'PEER', label: '360°评估' },
              { value: 'MANAGER', label: '上级评估' },
              { value: 'AI', label: 'AI 评估' }
            ]}
            onValueChange={next => {
              setStage(next as 'SELF' | 'PEER' | 'MANAGER' | 'AI')
              setDimensions([])
              setResult(null)
            }}
          >
            <SelectTrigger className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='SELF'>员工自评</SelectItem>
              <SelectItem value='PEER'>360°评估</SelectItem>
              <SelectItem value='MANAGER'>上级评估</SelectItem>
              <SelectItem value='AI'>AI 评估</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field className='gap-2'>
          <FieldLabel>职级前缀</FieldLabel>
          <Select
            value={prefix}
            items={[
              { value: 'D', label: 'D 普通岗' },
              { value: 'M', label: 'M 管理岗' }
            ]}
            onValueChange={next => {
              setPrefix(next as PerfJobLevelPrefix)
              setDimensions([])
              setResult(null)
            }}
          >
            <SelectTrigger className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='D'>D 普通岗</SelectItem>
              <SelectItem value='M'>M 管理岗</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <div className='flex items-end'>
          <Button variant='outline' className='w-full' disabled={loading} onClick={() => void prepare()}>
            {loading && <Loader2Icon className='animate-spin' />}准备样例
          </Button>
        </div>
      </div>

      {unavailable.length > 0 && (
        <Alert variant='destructive'>
          <AlertTitle>当前不可预览</AlertTitle>
          <AlertDescription>
            <ul className='list-disc pl-5'>
              {unavailable.map(message => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {(stage === 'SELF' || stage === 'AI') && (
        <div className='flex flex-col gap-3 rounded-lg border p-4'>
          <Field className='max-w-xs gap-2'>
            <FieldLabel>直接评级样例</FieldLabel>
            <Select
              value={directRating}
              items={['S', 'A', 'B', 'C'].map(value => ({ value, label: value }))}
              onValueChange={next => setDirectRating(next as PerfPerformanceLevel)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['S', 'A', 'B', 'C'].map(value => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Button className='self-end' disabled={loading} onClick={() => void calculate()}>
            {loading ? <Loader2Icon className='animate-spin' /> : <PlayIcon />}运行计算预览
          </Button>
        </div>
      )}

      {dimensions.length > 0 && (
        <div className='flex flex-col gap-3'>
          <div className='flex items-center gap-2'>
            <Badge variant='outline'>{mode === 'WEIGHTED_RATING' ? '加权评级' : '加权评分'}</Badge>
            <span className='text-muted-foreground text-sm'>修改样例值后发起权威预览</span>
          </div>
          {dimensions.map((dimension, index) => (
            <Field
              key={dimension.id}
              className='grid items-center gap-3 rounded-md border p-3 sm:grid-cols-[1fr_12rem]'
            >
              <FieldLabel>{dimension.name}</FieldLabel>
              {mode === 'WEIGHTED_RATING' ? (
                <Select
                  value={dimension.value}
                  items={['S', 'A', 'B', 'C'].map(value => ({ value, label: value }))}
                  onValueChange={next =>
                    setDimensions(items =>
                      items.map((item, itemIndex) => (itemIndex === index ? { ...item, value: String(next) } : item))
                    )
                  }
                >
                  <SelectTrigger aria-label={`${dimension.name} 样例评级`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['S', 'A', 'B', 'C'].map(value => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  aria-label={`${dimension.name} 样例评分`}
                  type='number'
                  min={0}
                  max={100}
                  step='0.01'
                  value={dimension.value}
                  onChange={event =>
                    setDimensions(items =>
                      items.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, value: event.target.value } : item
                      )
                    )
                  }
                />
              )}
            </Field>
          ))}
          <Button className='self-end' disabled={loading} onClick={() => void calculate()}>
            {loading ? <Loader2Icon className='animate-spin' /> : <PlayIcon />}运行计算预览
          </Button>
        </div>
      )}

      {result && <PreviewResult result={result} />}
    </div>
  )
}

const PreviewResult = ({ result }: { result: Record<string, unknown> }) => {
  if (result.type === 'DIRECT_RATING') {
    return (
      <Alert>
        <AlertTitle>计算完成</AlertTitle>
        <AlertDescription className='mt-2'>
          <Badge>直接等级 {String(result.level ?? '-')}</Badge>
        </AlertDescription>
      </Alert>
    )
  }

  const compositeScore = result.compositeScore
  const initialLevel = result.initialLevel
  const finalLevel = result.finalLevel
  const matchedConstraints = Array.isArray(result.matchedConstraints) ? result.matchedConstraints : []

  return (
    <Alert>
      <AlertTitle>计算完成</AlertTitle>
      <AlertDescription>
        <div className='mt-2 flex flex-wrap gap-2'>
          <Badge variant='outline'>综合分 {String(compositeScore ?? '-')}</Badge>
          <Badge variant='outline'>初始等级 {String(initialLevel ?? '-')}</Badge>
          <Badge>最终等级 {String(finalLevel ?? '-')}</Badge>
          <Badge variant='outline'>命中约束 {matchedConstraints.length} 条</Badge>
        </div>
      </AlertDescription>
    </Alert>
  )
}

export default ConfigCalculationPreview
