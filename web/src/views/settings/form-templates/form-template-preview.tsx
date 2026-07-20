import type {
  PerfFormItemConfig,
  PerfFormItemType,
  PerfFormTemplateDimension,
  PerfFormTemplateVersion,
  PerfPerformanceLevel
} from '@/lib/perf-api'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

import { FORM_FIELD_TYPE_LABEL, JOB_LEVEL_PREFIX_LABEL } from './form-template-constants'

type PreviewField = {
  key?: string
  id?: number
  type: PerfFormItemType
  title: string
  description?: string | null
  placeholder?: string | null
  required?: boolean
  requiredRule?: 'OPTIONAL' | 'ALWAYS' | 'CONDITIONAL'
  requiredLevels?: PerfPerformanceLevel[]
  config?: PerfFormItemConfig | null
}

const FieldControlPreview = ({ field }: { field: PreviewField }) => {
  const config = field.config ?? {}

  if (field.type === 'SHORT_TEXT' || field.type === 'LINK') {
    return (
      <Input
        disabled
        type={field.type === 'LINK' ? 'url' : 'text'}
        value={config.defaultValue ?? ''}
        placeholder={field.placeholder ?? (field.type === 'LINK' ? 'https://example.com' : '请输入内容')}
      />
    )
  }

  if (field.type === 'LONG_TEXT' || field.type === 'MARKDOWN') {
    return (
      <Textarea
        disabled
        value={config.defaultValue ?? ''}
        placeholder={field.placeholder ?? (field.type === 'MARKDOWN' ? '支持 Markdown 格式' : '请输入内容')}
      />
    )
  }

  if (field.type === 'SINGLE_SELECT' || field.type === 'MULTI_SELECT') {
    return (
      <div className='flex flex-col gap-2'>
        {(config.options ?? []).map(option => (
          <span key={option.value} className='text-muted-foreground flex items-center gap-2 text-sm'>
            <span
              className={
                field.type === 'SINGLE_SELECT'
                  ? 'inline-block size-4 rounded-full border'
                  : 'inline-block size-4 rounded border'
              }
            />
            {option.label}
          </span>
        ))}
        {(config.options ?? []).length === 0 && <span className='text-muted-foreground text-sm'>尚未配置选项</span>}
      </div>
    )
  }

  if (field.type === 'ATTACHMENT') {
    return (
      <div className='text-muted-foreground rounded-md border border-dashed px-3 py-4 text-center text-sm'>
        上传附件（预览）
        <p className='mt-1 text-xs'>
          {config.maxFiles ? `最多 ${config.maxFiles} 个文件` : '文件数量不限'}
          {config.maxSizeMb ? ` · 单个不超过 ${config.maxSizeMb} MB` : ''}
          {config.allowedExtensions?.length ? ` · ${config.allowedExtensions.join('、')}` : ''}
        </p>
      </div>
    )
  }

  return <p className='text-muted-foreground text-sm'>旧计分控件仅供历史查阅。</p>
}

/** 受控字段的禁用填写态，供新版预览与旧晋升只读页复用。 */
export const FormFieldPreview = ({ field }: { field: PreviewField }) => {
  const requiredRule = field.requiredRule ?? (field.required ? 'ALWAYS' : 'OPTIONAL')

  const typeLabel =
    field.type === 'RATING' ? '评级' : field.type === 'SCORE' ? '0～100 分' : FORM_FIELD_TYPE_LABEL[field.type]

  return (
    <div className='bg-muted/40 flex flex-col gap-2 rounded-md px-3 py-3 text-sm'>
      <div>
        <span className='font-medium'>{field.title || '未命名表单字段'}</span>
        <span className='text-muted-foreground ml-2'>
          {typeLabel}
          {requiredRule === 'ALWAYS' ? ' · 必填' : ''}
          {requiredRule === 'CONDITIONAL' ? ` · ${(field.requiredLevels ?? []).join('/')} 时必填` : ''}
        </span>
      </div>
      {field.description && <p className='text-muted-foreground text-xs'>{field.description}</p>}
      <FieldControlPreview field={field} />
      {(field.config?.minLength != null || field.config?.maxLength != null) && (
        <p className='text-muted-foreground text-xs'>
          长度：{field.config.minLength ?? 0}～{field.config.maxLength ?? '不限'}
        </p>
      )}
      {field.config?.allowedProtocols?.length ? (
        <p className='text-muted-foreground text-xs'>允许协议：{field.config.allowedProtocols.join('、')}</p>
      ) : null}
    </div>
  )
}

const DimensionPreview = ({ dimension }: { dimension: PerfFormTemplateDimension }) => (
  <section className='rounded-md border p-3'>
    <div className='flex flex-wrap items-center gap-2'>
      <h4 className='font-medium'>{dimension.name || '未命名维度'}</h4>
      <Badge variant='secondary'>{dimension.type === 'SCORING' ? '计分维度' : '非计分维度'}</Badge>
      {dimension.type === 'SCORING' && (
        <Badge variant='outline'>{dimension.scoringMethod === 'SCORE' ? '0～100 分' : '评级'}</Badge>
      )}
      {dimension.type === 'SCORING' && dimension.weight != null && dimension.weight !== '' && (
        <Badge variant='outline'>{dimension.weight}%</Badge>
      )}
      {dimension.type === 'SCORING' && dimension.isCore && <Badge variant='secondary'>核心</Badge>}
    </div>
    {dimension.description && <p className='text-muted-foreground mt-2 text-sm'>{dimension.description}</p>}

    {dimension.type === 'SCORING' && (
      <div className='mt-3 rounded-md border border-dashed p-3'>
        <p className='mb-2 text-sm font-medium'>维度评分（正式提交必填）</p>
        {dimension.scoringMethod === 'SCORE' ? (
          <Input disabled type='number' placeholder='请输入 0～100 分' />
        ) : (
          <div className='flex gap-2'>
            {(['S', 'A', 'B', 'C'] as const).map(level => (
              <ButtonPreview key={level} label={level} />
            ))}
          </div>
        )}
      </div>
    )}

    <div className='mt-3 flex flex-col gap-2'>
      {dimension.fields.map((field, fieldIndex) => (
        <FormFieldPreview key={field.key ?? field.id ?? fieldIndex} field={field} />
      ))}
      {dimension.fields.length === 0 && dimension.type === 'NON_SCORING' && (
        <p className='text-muted-foreground text-sm'>该维度仅展示说明，无需填写。</p>
      )}
    </div>
  </section>
)

const ButtonPreview = ({ label }: { label: string }) => (
  <span className='bg-muted text-muted-foreground inline-flex size-9 items-center justify-center rounded-md border text-sm font-medium'>
    {label}
  </span>
)

/** 填写结构预览：计分控件属于维度，字段只承载补充内容。 */
const FormTemplatePreview = ({ value }: { value: PerfFormTemplateVersion }) => (
  <div className='flex flex-col gap-4'>
    <div className='flex flex-wrap items-center gap-2'>
      <Badge variant='outline'>{JOB_LEVEL_PREFIX_LABEL[value.jobLevelPrefix]}</Badge>
      <span className='text-muted-foreground text-sm'>预览只展示表单结构，不保存填写数据。</span>
    </div>
    {value.subforms.map(subform => (
      <Card key={subform.id ?? subform.type}>
        <CardHeader>
          <CardTitle>{subform.title}</CardTitle>
        </CardHeader>
        <CardContent className='flex flex-col gap-3'>
          {subform.dimensions.length === 0 && <p className='text-muted-foreground text-sm'>暂无维度</p>}
          {subform.dimensions.map((dimension, index) => (
            <DimensionPreview key={dimension.key ?? dimension.id ?? index} dimension={dimension} />
          ))}
        </CardContent>
      </Card>
    ))}
  </div>
)

export default FormTemplatePreview
