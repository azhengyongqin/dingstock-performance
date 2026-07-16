'use client'

import { useState } from 'react'

import { PlusIcon } from 'lucide-react'

import type { PerfFormAudience, PerfFormSubformType, PerfFormTemplateVersion } from '@/lib/perf-api'

import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import DimensionEditor from './dimension-editor'
import { FORM_SUBFORM_LABEL } from './form-template-constants'
import {
  createClientKey,
  formRowKey,
  runReorderTransition,
  toViewTransitionName
} from './form-template-utils'

const PROMOTION_AUDIENCES: { value: PerfFormAudience; label: string }[] = [
  { value: 'EMPLOYEE', label: '员工内容' },
  { value: 'LEADER', label: 'Leader 内容' }
]

const DEFAULT_AUDIENCE: Record<Exclude<PerfFormSubformType, 'PROMOTION'>, PerfFormAudience> = {
  SELF: 'EMPLOYEE',
  PEER: 'REVIEWER',
  MANAGER: 'LEADER'
}

export const FORM_DESIGN_SECTIONS = (Object.keys(FORM_SUBFORM_LABEL) as PerfFormSubformType[]).map(type => ({
  value: type,
  label: FORM_SUBFORM_LABEL[type]
}))

type FormTemplateEditorProps = {
  value: PerfFormTemplateVersion
  editable: boolean
  onChange: (next: PerfFormTemplateVersion) => void
  /** 由外层导航接管时隐藏内层 Tabs，只渲染当前子表单 */
  hideSubformTabs?: boolean
  subform?: PerfFormSubformType
  onSubformChange?: (subform: PerfFormSubformType) => void
}

type SectionProps = {
  subformType: PerfFormSubformType
  value: PerfFormTemplateVersion
  editable: boolean
  onChange: (next: PerfFormTemplateVersion) => void
}

const patchDimensions = (
  value: PerfFormTemplateVersion,
  onChange: (next: PerfFormTemplateVersion) => void,
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
            dimensions: updater(subform.dimensions).map((dimension, index) => ({
              ...dimension,
              sortOrder: index
            }))
          }
        : subform
    )
  })
}

/** 单一评估子表单正文（无导航），供 Sheet 侧栏与内层 Tabs 复用。 */
export const FormTemplateEditorSection = ({
  subformType,
  value,
  editable,
  onChange
}: SectionProps) => {
  const subform = value.subforms.find(item => item.type === subformType)

  const addDimension = (audience: PerfFormAudience) => {
    patchDimensions(value, onChange, subformType, dimensions => [
      ...dimensions,
      {
        kind: subformType === 'PROMOTION' ? 'PROMOTION' : 'REGULAR',
        audience,
        name: '',
        weight: subformType === 'PROMOTION' ? null : '',
        isCore: false,
        sortOrder: dimensions.length,
        items: [],
        clientKey: createClientKey()
      } as (typeof dimensions)[number]
    ])
  }

  const renderDimensions = (audience: PerfFormAudience) => {
    const entries = (subform?.dimensions ?? [])
      .map((dimension, index) => ({ dimension, index }))
      .filter(entry => entry.dimension.audience === audience)

    return (
      <div className='flex flex-col gap-4'>
        {entries.length === 0 && (
          <p className='text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm'>
            暂无维度
          </p>
        )}
        {entries.map(({ dimension, index }, position) => {
          const rowKey = formRowKey(dimension, `dim-${audience}-${index}`)

          return (
            <div
              key={rowKey}
              style={{ viewTransitionName: toViewTransitionName('form-dim', rowKey) }}
            >
              <DimensionEditor
                dimension={dimension}
                editable={editable}
                weighted={subformType === 'PEER' || subformType === 'MANAGER'}
                defaultOpen={position === 0}
                canMoveUp={position > 0}
                canMoveDown={position < entries.length - 1}
                onChange={next =>
                  patchDimensions(value, onChange, subformType, dimensions =>
                    dimensions.map((current, currentIndex) =>
                      currentIndex === index ? next : current
                    )
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
                      const previousIndex = entries[position - 1]?.index

                      if (previousIndex == null) return dimensions

                      const next = [...dimensions]
                      const current = next[index]

                      next[index] = next[previousIndex]
                      next[previousIndex] = current

                      return next
                    })
                  )
                }
                onMoveDown={() =>
                  runReorderTransition(() =>
                    patchDimensions(value, onChange, subformType, dimensions => {
                      const nextIndex = entries[position + 1]?.index

                      if (nextIndex == null) return dimensions

                      const next = [...dimensions]
                      const current = next[index]

                      next[index] = next[nextIndex]
                      next[nextIndex] = current

                      return next
                    })
                  )
                }
              />
            </div>
          )
        })}
      </div>
    )
  }

  // 晋升评估与其它子表单同一套单栏结构；仅在下方按受众拆成两段（员工 / Leader）
  if (subformType === 'PROMOTION') {
    return (
      <div className='flex flex-col gap-8'>
        <div>
          <h3 className='font-medium'>{subform?.title ?? FORM_SUBFORM_LABEL.PROMOTION}</h3>
          <p className='text-muted-foreground mt-1 text-sm'>
            {subform?.description || '配置晋升场景下的评估维度与评估项'}
          </p>
        </div>

        {PROMOTION_AUDIENCES.map(audience => (
          <div key={audience.value} className='flex flex-col gap-4'>
            <div className='flex items-start justify-between gap-3'>
              <div>
                <h4 className='font-medium'>{audience.label}</h4>
                <p className='text-muted-foreground mt-1 text-sm'>
                  {audience.value === 'EMPLOYEE'
                    ? '随员工自评填写的晋升材料'
                    : '随上级评估填写的晋升意见'}
                </p>
              </div>
              {editable && (
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => addDimension(audience.value)}
                >
                  <PlusIcon />
                  添加 {audience.value === 'EMPLOYEE' ? '员工' : 'Leader'} 维度
                </Button>
              )}
            </div>
            {renderDimensions(audience.value)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex items-start justify-between gap-3'>
        <div>
          <h3 className='font-medium'>{subform?.title ?? FORM_SUBFORM_LABEL[subformType]}</h3>
          <p className='text-muted-foreground mt-1 text-sm'>
            {subform?.description || '配置该场景下的评估维度与评估项'}
          </p>
        </div>
        {editable && (
          <Button
            variant='outline'
            size='sm'
            onClick={() => addDimension(DEFAULT_AUDIENCE[subformType])}
          >
            <PlusIcon />
            添加维度
          </Button>
        )}
      </div>
      {renderDimensions(DEFAULT_AUDIENCE[subformType])}
    </div>
  )
}

/** 四类评估子表单的受控编辑器；发布版本复用同一组件进入只读态。 */
const FormTemplateEditor = ({
  value,
  editable,
  onChange,
  hideSubformTabs = false,
  subform = 'SELF',
  onSubformChange
}: FormTemplateEditorProps) => {
  const [internalSubform, setInternalSubform] = useState<PerfFormSubformType>(subform)
  const activeSubform = onSubformChange ? subform : internalSubform

  if (hideSubformTabs) {
    return (
      <FormTemplateEditorSection
        subformType={activeSubform}
        value={value}
        editable={editable}
        onChange={onChange}
      />
    )
  }

  return (
    <Tabs
      value={activeSubform}
      onValueChange={next => {
        const nextSubform = next as PerfFormSubformType

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
          <FormTemplateEditorSection
            subformType={item.value}
            value={value}
            editable={editable}
            onChange={onChange}
          />
        </TabsContent>
      ))}
    </Tabs>
  )
}

export default FormTemplateEditor
