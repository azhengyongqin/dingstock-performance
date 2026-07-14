'use client'

import { PlusIcon } from 'lucide-react'

import type { PerfFormAudience, PerfFormSubformType, PerfFormTemplateVersion } from '@/lib/perf-api'

import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import DimensionEditor from './dimension-editor'
import { FORM_SUBFORM_LABEL } from './form-template-constants'

const PROMOTION_AUDIENCES: { value: PerfFormAudience; label: string }[] = [
  { value: 'EMPLOYEE', label: '员工内容' },
  { value: 'LEADER', label: 'Leader 内容' }
]

type FormTemplateEditorProps = {
  value: PerfFormTemplateVersion
  editable: boolean
  onChange: (next: PerfFormTemplateVersion) => void
}

/** 四类评估子表单的受控编辑器；发布版本复用同一组件进入只读态。 */
const FormTemplateEditor = ({ value, editable, onChange }: FormTemplateEditorProps) => {
  const patchDimensions = (
    subformType: PerfFormSubformType,
    updater: (
      dimensions: PerfFormTemplateVersion['subforms'][number]['dimensions']
    ) => PerfFormTemplateVersion['subforms'][number]['dimensions']
  ) => {
    onChange({
      ...value,
      subforms: value.subforms.map(subform =>
        subform.type === subformType
          ? {
              ...subform,
              dimensions: updater(subform.dimensions).map((dimension, index) => ({ ...dimension, sortOrder: index }))
            }
          : subform
      )
    })
  }

  const addDimension = (subformType: PerfFormSubformType, audience: PerfFormAudience) => {
    patchDimensions(subformType, dimensions => [
      ...dimensions,
      {
        kind: subformType === 'PROMOTION' ? 'PROMOTION' : 'REGULAR',
        audience,
        name: '',
        weight: subformType === 'PROMOTION' ? null : '',
        isCore: false,
        sortOrder: dimensions.length,
        items: []
      }
    ])
  }

  const renderDimensions = (subformType: PerfFormSubformType, audience: PerfFormAudience) => {
    const subform = value.subforms.find(item => item.type === subformType)

    const entries = (subform?.dimensions ?? [])
      .map((dimension, index) => ({ dimension, index }))
      .filter(entry => entry.dimension.audience === audience)

    return (
      <div className='flex flex-col gap-4'>
        {entries.length === 0 && (
          <p className='text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm'>暂无维度</p>
        )}
        {entries.map(({ dimension, index }, position) => (
          <DimensionEditor
            key={dimension.id ?? index}
            dimension={dimension}
            editable={editable}
            weighted={subformType === 'PEER' || subformType === 'MANAGER'}
            canMoveUp={position > 0}
            canMoveDown={position < entries.length - 1}
            onChange={next =>
              patchDimensions(subformType, dimensions =>
                dimensions.map((current, currentIndex) => (currentIndex === index ? next : current))
              )
            }
            onRemove={() =>
              patchDimensions(subformType, dimensions => dimensions.filter((_, currentIndex) => currentIndex !== index))
            }
            onMoveUp={() =>
              patchDimensions(subformType, dimensions => {
                const previousIndex = entries[position - 1]?.index

                if (previousIndex == null) return dimensions

                const next = [...dimensions]
                const current = next[index]

                next[index] = next[previousIndex]
                next[previousIndex] = current

                return next
              })
            }
            onMoveDown={() =>
              patchDimensions(subformType, dimensions => {
                const nextIndex = entries[position + 1]?.index

                if (nextIndex == null) return dimensions

                const next = [...dimensions]
                const current = next[index]

                next[index] = next[nextIndex]
                next[nextIndex] = current

                return next
              })
            }
          />
        ))}
      </div>
    )
  }

  const defaultAudience: Record<Exclude<PerfFormSubformType, 'PROMOTION'>, PerfFormAudience> = {
    SELF: 'EMPLOYEE',
    PEER: 'REVIEWER',
    MANAGER: 'LEADER'
  }

  return (
    <Tabs defaultValue='SELF'>
      <TabsList className='w-full justify-start overflow-x-auto'>
        {(Object.keys(FORM_SUBFORM_LABEL) as PerfFormSubformType[]).map(type => (
          <TabsTrigger key={type} value={type}>
            {FORM_SUBFORM_LABEL[type]}
          </TabsTrigger>
        ))}
      </TabsList>

      {(Object.keys(FORM_SUBFORM_LABEL) as PerfFormSubformType[]).map(type => {
        const subform = value.subforms.find(item => item.type === type)

        return (
          <TabsContent key={type} value={type} className='mt-4'>
            {type === 'PROMOTION' ? (
              <div className='grid gap-4 lg:grid-cols-2'>
                {PROMOTION_AUDIENCES.map(audience => (
                  <section key={audience.value} className='flex min-w-0 flex-col gap-4 rounded-lg border p-4'>
                    <div className='flex items-start justify-between gap-3'>
                      <div>
                        <h3 className='font-medium'>{audience.label}</h3>
                        <p className='text-muted-foreground mt-1 text-sm'>
                          {audience.value === 'EMPLOYEE' ? '随员工自评填写的晋升材料' : '随上级评估填写的晋升意见'}
                        </p>
                      </div>
                      {editable && (
                        <Button variant='outline' size='sm' onClick={() => addDimension('PROMOTION', audience.value)}>
                          <PlusIcon />
                          添加 {audience.value === 'EMPLOYEE' ? '员工' : 'Leader'} 维度
                        </Button>
                      )}
                    </div>
                    {renderDimensions('PROMOTION', audience.value)}
                  </section>
                ))}
              </div>
            ) : (
              <div className='flex flex-col gap-4'>
                <div className='flex items-start justify-between gap-3'>
                  <div>
                    <h3 className='font-medium'>{subform?.title ?? FORM_SUBFORM_LABEL[type]}</h3>
                    <p className='text-muted-foreground mt-1 text-sm'>
                      {subform?.description || '配置该场景下的评估维度与评估项'}
                    </p>
                  </div>
                  {editable && (
                    <Button variant='outline' size='sm' onClick={() => addDimension(type, defaultAudience[type])}>
                      <PlusIcon />
                      添加维度
                    </Button>
                  )}
                </div>
                {renderDimensions(type, defaultAudience[type])}
              </div>
            )}
          </TabsContent>
        )
      })}
    </Tabs>
  )
}

export default FormTemplateEditor
