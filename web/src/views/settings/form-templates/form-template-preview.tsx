import type { PerfFormTemplateDimension, PerfFormTemplateVersion } from '@/lib/perf-api'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import { FORM_ITEM_TYPE_LABEL, JOB_LEVEL_PREFIX_LABEL } from './form-template-constants'

const DimensionPreview = ({ dimension, index }: { dimension: PerfFormTemplateDimension; index: number }) => (
  <section key={dimension.id ?? index} className='rounded-md border p-3'>
    <div className='flex flex-wrap items-center gap-2'>
      <h4 className='font-medium'>{dimension.name || '未命名维度'}</h4>
      {dimension.isCore && <Badge variant='secondary'>核心</Badge>}
      {dimension.weight != null && dimension.weight !== '' && <Badge variant='outline'>{dimension.weight}%</Badge>}
    </div>
    <div className='mt-3 flex flex-col gap-2'>
      {dimension.items.map((item, itemIndex) => (
        <div key={item.id ?? itemIndex} className='bg-muted/40 rounded-md px-3 py-2 text-sm'>
          <span className='font-medium'>{item.title || '未命名评估项'}</span>
          <span className='text-muted-foreground ml-2'>
            {FORM_ITEM_TYPE_LABEL[item.type] ?? item.type}
            {item.required ? ' · 必填' : ''}
          </span>
        </div>
      ))}
    </div>
  </section>
)

/** 填写结构预览：不产生答案，只验证发布版本会向各角色展示什么内容。 */
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
          {subform.type === 'PROMOTION' ? (
            <div className='grid gap-4 lg:grid-cols-2'>
              {(
                [
                  { audience: 'EMPLOYEE', label: '员工内容' },
                  { audience: 'LEADER', label: 'Leader 内容' }
                ] as const
              ).map(group => (
                <section key={group.audience} className='flex flex-col gap-3 rounded-md border border-dashed p-3'>
                  <h4 className='font-medium'>{group.label}</h4>
                  {subform.dimensions.filter(dimension => dimension.audience === group.audience).length === 0 && (
                    <p className='text-muted-foreground text-sm'>暂无内容</p>
                  )}
                  {subform.dimensions
                    .filter(dimension => dimension.audience === group.audience)
                    .map((dimension, index) => (
                      <DimensionPreview key={dimension.id ?? index} dimension={dimension} index={index} />
                    ))}
                </section>
              ))}
            </div>
          ) : (
            subform.dimensions.map((dimension, index) => (
              <DimensionPreview key={dimension.id ?? index} dimension={dimension} index={index} />
            ))
          )}
        </CardContent>
      </Card>
    ))}
  </div>
)

export default FormTemplatePreview
