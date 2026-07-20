'use client'

import { MemberPill } from '@/components/shared/lark'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type {
  PerfConfigTemplateVersion,
  PerfConfigTemplateVersionSummary,
  PerfFormTemplateVersionSummary
} from '@/lib/perf-api'

import ConfigCalculationPreview from './config-calculation-preview'
import { ConfigTemplateEditorSection } from './config-template-editor'
import { CONFIG_TEMPLATE_STATUS_LABEL } from './config-template-table-columns'
import type { ConfigTemplateSection } from './config-template-utils'

/** Sheet 侧栏可到达的区块（与 ConfigTemplateSection 对齐）。 */
export type ConfigNavDestination = Exclude<ConfigTemplateSection, never>

const RULE_ITEMS: Array<{
  id: Extract<ConfigNavDestination, 'ratings' | 'relations' | 'bindings' | 'schedule'>
  label: string
}> = [
  { id: 'ratings', label: '评级区间' },
  { id: 'relations', label: '关系权重' },
  { id: 'bindings', label: '表单绑定' },
  { id: 'schedule', label: '日程通知' }
]

const DESTINATION_LABEL: Record<ConfigNavDestination, string> = {
  basic: '基本与来源',
  ratings: '评级区间',
  relations: '关系权重',
  bindings: '表单绑定',
  schedule: '日程通知',
  preview: '计算预览',
  history: '版本历史'
}

type Props = {
  detail: PerfConfigTemplateVersion
  candidates: PerfFormTemplateVersionSummary[]
  versions: PerfConfigTemplateVersionSummary[]
  activeVersionId: number | null
  canEdit: boolean
  destination: ConfigNavDestination
  onDestinationChange: (destination: ConfigNavDestination) => void
  onDetailChange: (value: PerfConfigTemplateVersion) => void
  onSelectVersion: (versionId: number) => void
}

/**
 * 配置模板 Sheet 导航：左侧分组轨（基本 / 规则子项 / 预览 / 历史），右侧纯内容，不再嵌套双层 Tab。
 */
export const ConfigTemplateNav = ({
  detail,
  candidates,
  versions,
  activeVersionId,
  canEdit,
  destination,
  onDestinationChange,
  onDetailChange,
  onSelectVersion
}: Props) => (
  <div className='grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)]'>
    <nav className='flex flex-col gap-1 border-r pr-3' aria-label='配置模板导航'>
      <NavButton label='基本与来源' active={destination === 'basic'} onClick={() => onDestinationChange('basic')} />

      <div className='text-muted-foreground mt-3 mb-1 px-2 text-[11px] font-medium tracking-wide uppercase'>
        规则配置
      </div>
      {RULE_ITEMS.map(item => (
        <NavButton
          key={item.id}
          label={item.label}
          active={destination === item.id}
          indented
          onClick={() => onDestinationChange(item.id)}
        />
      ))}

      <div className='bg-border my-3 h-px' />

      <NavButton label='计算预览' active={destination === 'preview'} onClick={() => onDestinationChange('preview')} />
      <NavButton label='版本历史' active={destination === 'history'} onClick={() => onDestinationChange('history')} />
    </nav>

    <div className='min-w-0'>
      <div className='mb-4'>
        <h3 className='font-medium'>{DESTINATION_LABEL[destination]}</h3>
      </div>
      <DestinationBody
        destination={destination}
        detail={detail}
        candidates={candidates}
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
  candidates,
  versions,
  activeVersionId,
  canEdit,
  onDetailChange,
  onSelectVersion
}: {
  destination: ConfigNavDestination
  detail: PerfConfigTemplateVersion
  candidates: PerfFormTemplateVersionSummary[]
  versions: PerfConfigTemplateVersionSummary[]
  activeVersionId: number | null
  canEdit: boolean
  onDetailChange: (value: PerfConfigTemplateVersion) => void
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
          <FieldLabel>来源版本</FieldLabel>
          <Input value={detail.sourceVersionId ? `#${detail.sourceVersionId}` : '初始版本'} disabled />
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
    return <ConfigCalculationPreview version={detail} candidates={candidates} />
  }

  if (destination === 'history') {
    if (versions.length === 0) {
      return <p className='text-muted-foreground py-8 text-center text-sm'>当前角色没有可查看的其他版本</p>
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
              v{version.version} · {CONFIG_TEMPLATE_STATUS_LABEL[version.status]}
            </span>
            <span className='text-muted-foreground'>
              {version.sourceVersionId ? `来源 #${version.sourceVersionId}` : '初始版本'}
            </span>
          </Button>
        ))}
      </div>
    )
  }

  return (
    <ConfigTemplateEditorSection
      section={destination}
      value={detail}
      candidates={candidates}
      editable={canEdit}
      onChange={onDetailChange}
    />
  )
}
