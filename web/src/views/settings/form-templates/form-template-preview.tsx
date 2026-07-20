import type { PerfFormTemplateDimension, PerfFormTemplateVersion } from '@/lib/perf-api'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

import { FORM_FIELD_TYPE_LABEL, JOB_LEVEL_PREFIX_LABEL } from './form-template-constants'

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
        <div key={field.key ?? field.id ?? fieldIndex} className='bg-muted/40 rounded-md px-3 py-2 text-sm'>
          <span className='font-medium'>{field.title || '未命名表单字段'}</span>
          <span className='text-muted-foreground ml-2'>
            {FORM_FIELD_TYPE_LABEL[field.type]}
            {field.requiredRule === 'ALWAYS' ? ' · 必填' : ''}
            {field.requiredRule === 'CONDITIONAL' ? ` · ${field.requiredLevels.join('/')} 时必填` : ''}
          </span>
        </div>
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
