'use client'

import { useState } from 'react'

import { toast } from 'sonner'

import { EmptyState, RequestErrorState } from '@/components/shared/RequestErrorState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ApiError } from '@/lib/api'
import {
  normalizeRequestError,
  requestErrorMessage,
  type RequestErrorKind
} from '@/lib/request-error'

const KINDS: RequestErrorKind[] = ['network', 'forbidden', 'notFound', 'server', 'unauthorized', 'unknown']

const SAMPLE_ERRORS: Record<RequestErrorKind, unknown> = {
  network: new TypeError('Failed to fetch'),
  forbidden: new ApiError(403, '需要 HR / 超级管理员权限'),
  notFound: new ApiError(404, '参与者不存在'),
  server: new ApiError(500, 'Internal Server Error'),
  unauthorized: new ApiError(401, 'Unauthorized'),
  unknown: new ApiError(409, '评审员指派冲突，请刷新后重试')
}

/** 请求错误态全量示例：分类插画、尺寸、重试动效、空态与文案归一 */
const RequestErrorPreview = () => {
  const [activeKind, setActiveKind] = useState<RequestErrorKind>('network')
  const [retrying, setRetrying] = useState(false)
  const [retryCount, setRetryCount] = useState(0)

  const sampleError = SAMPLE_ERRORS[activeKind]
  const info = normalizeRequestError(sampleError)

  const handleRetry = () => {
    setRetrying(true)
    window.setTimeout(() => {
      setRetrying(false)
      setRetryCount(count => count + 1)
      toast.success(`已模拟重试（第 ${retryCount + 1} 次）`)
    }, 1200)
  }

  return (
    <div className='flex flex-col gap-4'>
      <Card>
        <CardHeader>
          <CardTitle>错误分类切换</CardTitle>
          <CardDescription>
            点击切换 kind，观察 unDraw 插画、标题说明与浮起动效；右侧展示 normalizeRequestError 结果。
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-4'>
          <div className='flex flex-wrap gap-2'>
            {KINDS.map(kind => (
              <Button
                key={kind}
                type='button'
                size='sm'
                variant={kind === activeKind ? 'default' : 'outline'}
                onClick={() => setActiveKind(kind)}
              >
                {kind}
              </Button>
            ))}
          </div>

          <div className='grid gap-4 xl:grid-cols-2'>
            <RequestErrorState
              error={sampleError}
              size='card'
              showDetail
              retrying={retrying}
              onRetry={handleRetry}
              secondaryAction={
                <Button type='button' variant='outline' size='default' onClick={() => toast.message('次要操作')}>
                  返回
                </Button>
              }
            />
            <div className='bg-muted/40 flex flex-col gap-2 rounded-lg border p-4 text-sm'>
              <div className='flex items-center gap-2'>
                <span className='font-medium'>归一结果</span>
                <Badge variant='secondary'>{info.kind}</Badge>
              </div>
              <p>
                <span className='text-muted-foreground'>title：</span>
                {info.title}
              </p>
              <p>
                <span className='text-muted-foreground'>description：</span>
                {info.description}
              </p>
              <p>
                <span className='text-muted-foreground'>toast 文案：</span>
                {requestErrorMessage(sampleError)}
              </p>
              <p className='text-muted-foreground font-mono text-xs'>
                raw: {sampleError instanceof Error ? sampleError.message : String(sampleError)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>尺寸变体</CardTitle>
          <CardDescription>page / card / compact，用于整页失败、卡片内嵌、侧栏小区域。</CardDescription>
        </CardHeader>
        <CardContent className='grid gap-4 xl:grid-cols-3'>
          <div className='flex flex-col gap-2'>
            <Badge variant='outline' className='w-fit'>
              page
            </Badge>
            <div className='rounded-xl border'>
              <RequestErrorState kind='server' size='page' onRetry={() => toast.message('page 重试')} />
            </div>
          </div>
          <div className='flex flex-col gap-2'>
            <Badge variant='outline' className='w-fit'>
              card
            </Badge>
            <RequestErrorState kind='network' size='card' onRetry={() => toast.message('card 重试')} />
          </div>
          <div className='flex flex-col gap-2'>
            <Badge variant='outline' className='w-fit'>
              compact
            </Badge>
            <RequestErrorState kind='forbidden' size='compact' onRetry={() => toast.message('compact 重试')} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>全部分类一览</CardTitle>
          <CardDescription>六种标准请求错误插画（unDraw），主色已收敛为中性 slate 以贴合系统主题。</CardDescription>
        </CardHeader>
        <CardContent className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
          {KINDS.map(kind => (
            <RequestErrorState
              key={kind}
              kind={kind}
              size='compact'
              showDetail={kind === 'server'}
              onRetry={() => {
                setActiveKind(kind)
                toast.message(`切换到 ${kind}`)
              }}
              retryLabel='查看'
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>空态（配套）</CardTitle>
          <CardDescription>与错误态同节奏的 EmptyState，使用 unDraw no-data 插画。</CardDescription>
        </CardHeader>
        <CardContent className='grid gap-4 xl:grid-cols-2'>
          <EmptyState
            title='无待办'
            description='当前周期没有需要你处理的事项'
            size='card'
          />
          <EmptyState
            title='暂无进行中的周期'
            description='你名下没有团队成员，或当前没有进行中的绩效周期'
            size='card'
            action={
              <Button type='button' variant='outline' size='sm' onClick={() => toast.message('去周期列表')}>
                查看周期
              </Button>
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>重试中动效</CardTitle>
          <CardDescription>按钮 loading + 插画轻微降透明度，避免重复点击。</CardDescription>
        </CardHeader>
        <CardContent>
          <RequestErrorState
            kind='network'
            size='card'
            retrying
            onRetry={() => {}}
            description='演示「重试中…」按钮与禁用态。'
          />
        </CardContent>
      </Card>
    </div>
  )
}

export default RequestErrorPreview
