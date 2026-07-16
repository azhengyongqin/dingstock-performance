'use client'

import type { PerfFormSubformType, PerfFormTemplateVersion, PerfFormTemplateVersionSummary, PerfJobLevelPrefix } from '@/lib/perf-api'

import { MemberPill } from '@/components/shared/lark'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import { FORM_DESIGN_SECTIONS, FormTemplateEditorSection } from './form-template-editor'
import FormTemplatePreview from './form-template-preview'
import { FORM_TEMPLATE_STATUS_LABEL, JOB_LEVEL_PREFIX_LABEL } from './form-template-constants'

const JOB_LEVEL_OPTIONS: { value: PerfJobLevelPrefix; label: string }[] = [
  { value: 'D', label: JOB_LEVEL_PREFIX_LABEL.D },
  { value: 'M', label: JOB_LEVEL_PREFIX_LABEL.M }
]

export type FormNavDestination = 'basic' | PerfFormSubformType | 'preview' | 'history'

const DESTINATION_LABEL: Record<FormNavDestination, string> = {
  basic: '基本与来源',
  SELF: '员工自评',
  PEER: '360°评估',
  MANAGER: '上级评估',
  PROMOTION: '晋升评估',
  preview: '填写预览',
  history: '版本历史'
}

type Props = {
  detail: PerfFormTemplateVersion
  versions: PerfFormTemplateVersionSummary[]
  activeVersionId: number | null
  canEdit: boolean
  destination: FormNavDestination
  onDestinationChange: (destination: FormNavDestination) => void
  onDetailChange: (value: PerfFormTemplateVersion) => void
  onSelectVersion: (versionId: number) => void
}

/**
 * 评估表单模板 Sheet 导航：左侧分组轨（基本 / 四类子表单 / 预览 / 历史），右侧纯内容。
 * 布局对齐配置模板 ConfigTemplateNav，避免顶栏再嵌套一层 pill Tabs。
 */
export const FormTemplateNav = ({
  detail,
  versions,
  activeVersionId,
  canEdit,
  destination,
  onDestinationChange,
  onDetailChange,
  onSelectVersion
}: Props) => (
  <div className='grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)]'>
    <nav className='flex flex-col gap-1 border-r pr-3' aria-label='评估表单模板导航'>
      <NavButton
        label='基本与来源'
        active={destination === 'basic'}
        onClick={() => onDestinationChange('basic')}
      />

      <div className='text-muted-foreground mt-3 mb-1 px-2 text-[11px] font-medium tracking-wide uppercase'>
        表单设计
      </div>
      {FORM_DESIGN_SECTIONS.map(item => (
        <NavButton
          key={item.value}
          label={item.label}
          active={destination === item.value}
          indented
          onClick={() => onDestinationChange(item.value)}
        />
      ))}

      <div className='bg-border my-3 h-px' />

      <NavButton
        label='填写预览'
        active={destination === 'preview'}
        onClick={() => onDestinationChange('preview')}
      />
      <NavButton
        label='版本历史'
        active={destination === 'history'}
        onClick={() => onDestinationChange('history')}
      />
    </nav>

    <div className='min-w-0'>
      {/* 表单设计区由 FormTemplateEditorSection 自带标题，避免与侧栏选中项重复 */}
      {!FORM_DESIGN_SECTIONS.some(item => item.value === destination) && (
        <div className='mb-4'>
          <h3 className='font-medium'>{DESTINATION_LABEL[destination]}</h3>
        </div>
      )}
      <DestinationBody
        destination={destination}
        detail={detail}
        versions={versions}
        activeVersionId={activeVersionId}
        canEdit={canEdit}
        onDetailChange={onDetailChange}
        onSelectVersion={onSelectVersion}
      />
    </div>
  </div>
)

const NavButton = ({
  label,
  active,
  indented = false,
  onClick
}: {
  label: string
  active: boolean
  indented?: boolean
  onClick: () => void
}) => (
  <Button
    type='button'
    variant='ghost'
    onClick={onClick}
    className={cn(
      'h-8 w-full justify-start px-2 text-sm font-normal',
      indented && 'pl-4',
      active && 'bg-muted text-foreground font-medium'
    )}
  >
    {label}
  </Button>
)

const DestinationBody = ({
  destination,
  detail,
  versions,
  activeVersionId,
  canEdit,
  onDetailChange,
  onSelectVersion
}: {
  destination: FormNavDestination
  detail: PerfFormTemplateVersion
  versions: PerfFormTemplateVersionSummary[]
  activeVersionId: number | null
  canEdit: boolean
  onDetailChange: (value: PerfFormTemplateVersion) => void
  onSelectVersion: (versionId: number) => void
}) => {
  if (destination === 'basic') {
    return (
      <div className='grid gap-4 md:grid-cols-2'>
        <Field className='gap-2'>
          <FieldLabel>模板名称</FieldLabel>
          <Input
            value={detail.name}
            disabled={!canEdit}
            onChange={event => onDetailChange({ ...detail, name: event.target.value })}
          />
        </Field>
        <Field className='gap-2'>
          <FieldLabel>职级前缀</FieldLabel>
          <Select
            value={detail.jobLevelPrefix}
            items={JOB_LEVEL_OPTIONS}
            disabled={!canEdit}
            onValueChange={value =>
              onDetailChange({ ...detail, jobLevelPrefix: value as PerfJobLevelPrefix })
            }
          >
            <SelectTrigger className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {JOB_LEVEL_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field className='gap-2 md:col-span-2'>
          <FieldLabel>模板说明</FieldLabel>
          <Textarea
            value={detail.description ?? ''}
            disabled={!canEdit}
            onChange={event => onDetailChange({ ...detail, description: event.target.value })}
          />
        </Field>
        <div className='text-muted-foreground grid gap-3 rounded-lg border p-4 text-sm md:col-span-2'>
          <span>稳定模板 ID：#{detail.templateId}</span>
          <span>当前版本 ID：#{detail.id}</span>
          {detail.sourceVersionId != null && <span>来源版本：#{detail.sourceVersionId}</span>}
          <div className='flex flex-wrap items-center gap-2'>
            <span>创建人：</span>
            <MemberPill openId={detail.createdByOpenId} />
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <span>发布人：</span>
            <MemberPill openId={detail.publishedByOpenId} />
          </div>
        </div>
      </div>
    )
  }

  if (destination === 'preview') {
    return <FormTemplatePreview value={detail} />
  }

  if (destination === 'history') {
    if (versions.length === 0) {
      return (
        <p className='text-muted-foreground py-6 text-center text-sm'>当前角色没有可查看的其他版本</p>
      )
    }

    return (
      <div className='flex flex-col gap-2'>
        {versions.map(version => (
          <Button
            key={version.id}
            variant={version.id === activeVersionId ? 'secondary' : 'outline'}
            className='h-auto justify-between py-3'
            onClick={() => onSelectVersion(version.id)}
          >
            <span>
              v{version.version} · {FORM_TEMPLATE_STATUS_LABEL[version.status]}
            </span>
            <span className='text-muted-foreground'>
              {JOB_LEVEL_PREFIX_LABEL[version.jobLevelPrefix]}
            </span>
          </Button>
        ))}
      </div>
    )
  }

  return (
    <FormTemplateEditorSection
      subformType={destination}
      value={detail}
      editable={canEdit}
      onChange={onDetailChange}
    />
  )
}
