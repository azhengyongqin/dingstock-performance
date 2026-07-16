'use client'

import { useState } from 'react'

import type {
  PerfConfigTemplateVersion,
  PerfFormTemplateVersionSummary
} from '@/lib/perf-api'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { ConfigRatingsEditor } from './config-ratings-editor'
import type { ConfigTemplateSection } from './config-template-utils'
import {
  BindingsSection,
  ConstraintsSection,
  RelationsSection,
  ScheduleSection,
  StageModesSection
} from './config-rule-sections'

export const CONFIG_EDITOR_SECTIONS: Array<{ value: ConfigTemplateSection; label: string }> = [
  { value: 'ratings', label: '评级与模式' },
  { value: 'constraints', label: '等级约束' },
  { value: 'relations', label: '关系权重' },
  { value: 'bindings', label: '表单绑定' },
  { value: 'schedule', label: '日程通知' }
]

type Props = {
  value: PerfConfigTemplateVersion
  candidates: PerfFormTemplateVersionSummary[]
  editable: boolean
  onChange: (value: PerfConfigTemplateVersion) => void
  section?: ConfigTemplateSection
  onSectionChange?: (section: ConfigTemplateSection) => void
  visibleSections?: ConfigTemplateSection[]
  /** 由外层导航接管时隐藏内层 Tabs，只渲染当前 section 内容 */
  hideSectionTabs?: boolean
}

type SectionBodyProps = {
  section: ConfigTemplateSection
  value: PerfConfigTemplateVersion
  candidates: PerfFormTemplateVersionSummary[]
  editable: boolean
  onChange: (value: PerfConfigTemplateVersion) => void
}

/** 规则配置某一子区块正文（无导航）。 */
export const ConfigTemplateEditorSection = ({
  section,
  value,
  candidates,
  editable,
  onChange
}: SectionBodyProps) => {
  const sectionProps = { value, candidates, editable, onChange }

  if (section === 'ratings') {
    return (
      <div className='flex flex-col gap-6'>
        <StageModesSection {...sectionProps} />
        <ConfigRatingsEditor
          ratings={value.ratings}
          editable={editable}
          onChange={ratings => onChange({ ...value, ratings })}
        />
      </div>
    )
  }

  if (section === 'constraints') return <ConstraintsSection {...sectionProps} />
  if (section === 'relations') return <RelationsSection {...sectionProps} />
  if (section === 'bindings') return <BindingsSection {...sectionProps} />
  if (section === 'schedule') return <ScheduleSection {...sectionProps} />

  return null
}

/** 配置模板草稿编辑器：所有可变项均来自固定枚举，不接受公式、脚本或自由扩展评级。 */
const ConfigTemplateEditor = ({
  value,
  candidates,
  editable,
  onChange,
  section = 'ratings',
  onSectionChange,
  visibleSections = CONFIG_EDITOR_SECTIONS.map(item => item.value),
  hideSectionTabs = false
}: Props) => {
  const [internalSection, setInternalSection] = useState<ConfigTemplateSection>(section)
  const requestedSection = onSectionChange ? section : internalSection
  const activeSection = visibleSections.includes(requestedSection)
    ? requestedSection
    : (visibleSections[0] ?? 'ratings')

  const sectionProps = { value, candidates, editable, onChange }

  if (hideSectionTabs) {
    return <ConfigTemplateEditorSection section={activeSection} {...sectionProps} />
  }

  return (
    <Tabs
      value={activeSection}
      onValueChange={next => {
        const nextSection = next as ConfigTemplateSection

        setInternalSection(nextSection)
        onSectionChange?.(nextSection)
      }}
      className='flex flex-col gap-4'
    >
      <TabsList className='h-auto flex-wrap justify-start'>
        {CONFIG_EDITOR_SECTIONS.filter(item => visibleSections.includes(item.value)).map(item => (
          <TabsTrigger key={item.value} value={item.value}>
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value='ratings' className='flex flex-col gap-6'>
        <ConfigTemplateEditorSection section='ratings' {...sectionProps} />
      </TabsContent>
      <TabsContent value='constraints'>
        <ConfigTemplateEditorSection section='constraints' {...sectionProps} />
      </TabsContent>
      <TabsContent value='relations'>
        <ConfigTemplateEditorSection section='relations' {...sectionProps} />
      </TabsContent>
      <TabsContent value='bindings'>
        <ConfigTemplateEditorSection section='bindings' {...sectionProps} />
      </TabsContent>
      <TabsContent value='schedule'>
        <ConfigTemplateEditorSection section='schedule' {...sectionProps} />
      </TabsContent>
    </Tabs>
  )
}

export default ConfigTemplateEditor
