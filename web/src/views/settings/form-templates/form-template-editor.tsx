'use client'

import { useState } from 'react'

import { PlusIcon } from 'lucide-react'

import type { PerfFormAudience, PerfFormTemplateSubformType, PerfFormTemplateVersion } from '@/lib/perf-api'

import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

import DimensionEditor from './dimension-editor'
import { FORM_SUBFORM_LABEL } from './form-template-constants'
import {
  createClientKey,
  formRowKey,
  runReorderTransition,
  toViewTransitionName,
  type FormSubformIssueMarkers
} from './form-template-utils'

const DEFAULT_AUDIENCE: Record<PerfFormTemplateSubformType, PerfFormAudience> = {
  SELF: 'EMPLOYEE',
  PEER: 'REVIEWER',
  MANAGER: 'LEADER'
}

export const FORM_DESIGN_SECTIONS = (Object.keys(FORM_SUBFORM_LABEL) as PerfFormTemplateSubformType[]).map(type => ({
  value: type,
  label: FORM_SUBFORM_LABEL[type]
}))

type FormTemplateEditorProps = {
  value: PerfFormTemplateVersion
  editable: boolean
  onChange: (next: PerfFormTemplateVersion) => void
  hideSubformTabs?: boolean
  subform?: PerfFormTemplateSubformType
  onSubformChange?: (subform: PerfFormTemplateSubformType) => void
}

type SectionProps = {
  subformType: PerfFormTemplateSubformType
  value: PerfFormTemplateVersion
  editable: boolean
  issueMarkers?: FormSubformIssueMarkers
  onChange: (next: PerfFormTemplateVersion) => void
}

const patchDimensions = (
  value: PerfFormTemplateVersion,
  onChange: (next: PerfFormTemplateVersion) => void,
  subformType: PerfFormTemplateSubformType,
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
            dimensions: updater(subform.dimensions).map((dimension, index) => ({
              ...dimension,
              sortOrder: index
            }))
          }
        : subform
    )
  })
}

/** 单一绩效子表单正文，供 Sheet 侧栏与内层 Tabs 复用。 */
export const FormTemplateEditorSection = ({ subformType, value, editable, issueMarkers, onChange }: SectionProps) => {
  const subform = value.subforms.find(item => item.type === subformType)
  const sectionInvalid = Boolean(issueMarkers?.hasError)
  const audience = DEFAULT_AUDIENCE[subformType]
  const entries = (subform?.dimensions ?? []).map((dimension, index) => ({ dimension, index }))

  const addDimension = () => {
    patchDimensions(value, onChange, subformType, dimensions => [
      ...dimensions,
      {
        type: 'SCORING',
        scoringMethod: 'RATING',
        audience,
        name: '',
        weight: '',
        isCore: false,
        sortOrder: dimensions.length,
        fields: [],
        clientKey: createClientKey()
      }
    ])
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex items-start justify-between gap-3'>
        <div>
          <h3 className={cn('font-medium', sectionInvalid && 'text-destructive')}>
            {subform?.title ?? FORM_SUBFORM_LABEL[subformType]}
          </h3>
          <p className='text-muted-foreground mt-1 text-sm'>
            {subform?.description || '配置该场景下的评估维度与表单字段'}
          </p>
        </div>
        {editable && (
          <Button variant='outline' size='sm' onClick={addDimension}>
            <PlusIcon />
            添加维度
          </Button>
        )}
      </div>

      {entries.length === 0 && (
        <p className='text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm'>暂无维度</p>
      )}

      <div className='flex flex-col gap-4'>
        {entries.map(({ dimension, index }, position) => {
          const rowKey = formRowKey(dimension, `dim-${audience}-${index}`)
          const dimensionMarkers = issueMarkers?.dimensions.get(index)

          return (
            <div key={rowKey} style={{ viewTransitionName: toViewTransitionName('form-dim', rowKey) }}>
              <DimensionEditor
                dimension={dimension}
                editable={editable}
                defaultOpen={position === 0 || Boolean(dimensionMarkers?.hasError)}
                invalid={Boolean(dimensionMarkers?.hasError)}
                invalidProperties={dimensionMarkers?.properties}
                invalidFields={dimensionMarkers?.fields}
                canMoveUp={position > 0}
                canMoveDown={position < entries.length - 1}
                onChange={next =>
                  patchDimensions(value, onChange, subformType, dimensions =>
                    dimensions.map((current, currentIndex) => (currentIndex === index ? next : current))
                  )
                }
                onRemove={() =>
                  patchDimensions(value, onChange, subformType, dimensions =>
                    dimensions.filter((_, currentIndex) => currentIndex !== index)
                  )
                }
                onMoveUp={() =>
                  runReorderTransition(() =>
                    patchDimensions(value, onChange, subformType, dimensions => {
                      if (index === 0) return dimensions

                      const next = [...dimensions]

                      ;[next[index - 1], next[index]] = [next[index], next[index - 1]]

                      return next
                    })
                  )
                }
                onMoveDown={() =>
                  runReorderTransition(() =>
                    patchDimensions(value, onChange, subformType, dimensions => {
                      if (index >= dimensions.length - 1) return dimensions

                      const next = [...dimensions]

                      ;[next[index], next[index + 1]] = [next[index + 1], next[index]]

                      return next
                    })
                  )
                }
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 三类绩效评估子表单的受控编辑器；发布版本复用同一组件进入只读态。 */
const FormTemplateEditor = ({
  value,
  editable,
  onChange,
  hideSubformTabs = false,
  subform = 'SELF',
  onSubformChange
}: FormTemplateEditorProps) => {
  const [internalSubform, setInternalSubform] = useState<PerfFormTemplateSubformType>(subform)
  const activeSubform = onSubformChange ? subform : internalSubform

  if (hideSubformTabs) {
    return (
      <FormTemplateEditorSection subformType={activeSubform} value={value} editable={editable} onChange={onChange} />
    )
  }

  return (
    <Tabs
      value={activeSubform}
      onValueChange={next => {
        const nextSubform = next as PerfFormTemplateSubformType

        setInternalSubform(nextSubform)
        onSubformChange?.(nextSubform)
      }}
    >
      <TabsList className='w-full justify-start overflow-x-auto'>
        {FORM_DESIGN_SECTIONS.map(item => (
          <TabsTrigger key={item.value} value={item.value}>
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {FORM_DESIGN_SECTIONS.map(item => (
        <TabsContent key={item.value} value={item.value} className='mt-4'>
          <FormTemplateEditorSection subformType={item.value} value={value} editable={editable} onChange={onChange} />
        </TabsContent>
      ))}
    </Tabs>
  )
}

export default FormTemplateEditor
