'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  AlertTriangleIcon,
  ArchiveIcon,
  CheckCircle2Icon,
  CopyPlusIcon,
  Loader2Icon,
  SaveIcon,
  SendIcon
} from 'lucide-react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ApiError } from '@/lib/api'
import type {
  ConfigTemplateValidationIssue,
  PerfConfigTemplateVersion,
  PerfConfigTemplateVersionSummary,
  PerfFormTemplateVersionSummary
} from '@/lib/perf-api'
import {
  archivePerfConfigTemplateVersion,
  createPerfConfigTemplateDraft,
  getPerfConfigTemplateVersion,
  listPerfConfigTemplateVersions,
  publishPerfConfigTemplateVersion,
  updatePerfConfigTemplateVersion,
  validatePerfConfigTemplateVersion
} from '@/lib/perf-api'

import { ConfigTemplateNav, type ConfigNavDestination } from './config-template-nav'
import { CONFIG_TEMPLATE_STATUS_LABEL } from './config-template-table-columns'
import {
  getConfigTemplateActions,
  issueSectionForPath,
  mergeConfigTemplateIssues
} from './config-template-utils'

const readIssues = (error: unknown): ConfigTemplateValidationIssue[] => {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== 'object') return []
  const body = error.body as { issues?: unknown; message?: unknown }

  if (Array.isArray(body.issues)) {
    return body.issues
      .map(issue => {
        if (typeof issue === 'string') return { code: 'VALIDATION_ERROR', message: issue }
        if (issue && typeof issue === 'object' && 'message' in issue) return issue as ConfigTemplateValidationIssue

        return null
      })
      .filter((issue): issue is ConfigTemplateValidationIssue => issue != null)
  }

  if (Array.isArray(body.message)) {
    return body.message.map(message => ({ code: 'VALIDATION_ERROR', message: String(message) }))
  }

  return []
}

type Props = {
  selected: PerfConfigTemplateVersionSummary | null
  candidates: PerfFormTemplateVersionSummary[]
  isAdmin: boolean
  onClose: () => void
  onChanged: () => void
}

const ConfigTemplateSheet = ({ selected, candidates, isAdmin, onClose, onChanged }: Props) => {
  const [detail, setDetail] = useState<PerfConfigTemplateVersion | null>(null)
  const [versions, setVersions] = useState<PerfConfigTemplateVersionSummary[]>([])
  const [activeVersionId, setActiveVersionId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [issues, setIssues] = useState<ConfigTemplateValidationIssue[]>([])
  const [destination, setDestination] = useState<ConfigNavDestination>('basic')
  const [publishOpen, setPublishOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)

  const loadVersion = useCallback(async (versionId: number) => {
    setLoading(true)
    setIssues([])

    try {
      const next = await getPerfConfigTemplateVersion(versionId)

      setDetail(next)
      setIssues(mergeConfigTemplateIssues(next))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载配置模板失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadHistory = useCallback(async (templateId: number) => {
    try {
      const response = await listPerfConfigTemplateVersions(templateId)

      setVersions(response.items ?? [])
    } catch {
      // HR 可能没有管理历史权限；详情仍保持当前已发布版本可读。
      setVersions([])
    }
  }, [])

  useEffect(() => {
    if (!selected) return

    const initialLoad = setTimeout(() => {
      setActiveVersionId(selected.id)
      setDestination('basic')
      void loadVersion(selected.id)
      void loadHistory(selected.templateId)
    }, 0)

    return () => clearTimeout(initialLoad)
  }, [selected, loadVersion, loadHistory])

  const saveDraft = async (): Promise<PerfConfigTemplateVersion | null> => {
    if (!detail) return null

    if (!detail.name.trim()) {
      toast.error('模板名称不能为空')

      return null
    }

    setSaving(true)

    try {
      const saved = await updatePerfConfigTemplateVersion(detail.id, {
        name: detail.name.trim(),
        description: detail.description,
        stageModes: detail.stageModes,
        ratings: detail.ratings,
        constraintProfiles: detail.constraintProfiles,
        reviewerRelationWeights: detail.reviewerRelationWeights,
        formTemplateVersionIds: detail.formTemplateVersionIds,
        schedulePreset: detail.schedulePreset,
        notificationRules: detail.notificationRules
      })

      setDetail(saved)
      onChanged()

      return saved
    } catch (error) {
      setIssues(readIssues(error))
      toast.error(error instanceof Error ? error.message : '保存失败')

      return null
    } finally {
      setSaving(false)
    }
  }

  const handleValidate = async () => {
    const saved = await saveDraft()

    if (!saved) return
    setSaving(true)

    try {
      const validation = await validatePerfConfigTemplateVersion(saved.id)

      setIssues(validation.issues)
      toast[validation.valid ? 'success' : 'warning'](
        validation.valid ? '发布校验已通过' : `发布校验发现 ${validation.issues.length} 个问题`
      )
    } catch (error) {
      const nextIssues = readIssues(error)

      setIssues(nextIssues)
      toast.error(error instanceof Error ? error.message : '校验失败')
    } finally {
      setSaving(false)
    }
  }

  const handlePublish = async () => {
    const saved = await saveDraft()

    if (!saved) return
    setSaving(true)

    try {
      const published = await publishPerfConfigTemplateVersion(saved.id)

      setDetail(published)
      setIssues([])
      setPublishOpen(false)
      toast.success(`v${published.version} 已发布，后续修改需创建新草稿`)
      await loadHistory(published.templateId)
      onChanged()
    } catch (error) {
      const nextIssues = readIssues(error)

      setIssues(nextIssues.length ? nextIssues : [{ code: 'PUBLISH_FAILED', message: error instanceof Error ? error.message : '发布失败' }])
      setPublishOpen(false)
      toast.error('发布校验未通过，请修正全部问题后重试')
    } finally {
      setSaving(false)
    }
  }

  const handleCreateDraft = async () => {
    if (!detail) return
    setSaving(true)

    try {
      const draft = await createPerfConfigTemplateDraft(detail.id)

      setDetail(draft)
      setActiveVersionId(draft.id)
      setDestination('basic')
      toast.success(`已从 v${detail.version} 创建新草稿`)
      await loadHistory(draft.templateId)
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建新草稿失败')
    } finally {
      setSaving(false)
    }
  }

  const handleArchive = async () => {
    if (!detail) return
    setSaving(true)

    try {
      const archived = await archivePerfConfigTemplateVersion(detail.id)

      setDetail(archived)
      setIssues(mergeConfigTemplateIssues(archived))
      setArchiveOpen(false)
      toast.success(`v${archived.version} 已归档`)
      await loadHistory(archived.templateId)
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '归档失败')
    } finally {
      setSaving(false)
    }
  }

  const locateIssue = (issue: ConfigTemplateValidationIssue) => {
    setDestination(issueSectionForPath(issue.path))
  }

  const actions = detail ? getConfigTemplateActions(detail.status, isAdmin) : null

  return (
    <>
      <Sheet open={selected != null} onOpenChange={open => !open && onClose()}>
        <SheetContent className='gap-0 data-[side=right]:sm:max-w-6xl'>
          <SheetHeader className='border-b px-6 py-4'>
            <SheetTitle>{detail ? `${detail.name} · v${detail.version}` : '配置模板'}</SheetTitle>
          </SheetHeader>

          {loading || !detail ? (
            <div className='text-muted-foreground flex flex-1 items-center justify-center gap-2'>
              <Loader2Icon className='size-4 animate-spin' />正在加载模板版本…
            </div>
          ) : (
            <>
              <ScrollArea className='min-h-0 flex-1'>
                <div className='flex flex-col gap-5 px-6 py-5'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <Badge>{CONFIG_TEMPLATE_STATUS_LABEL[detail.status]}</Badge>
                    {detail.sourceVersionId && <Badge variant='outline'>来源版本 #{detail.sourceVersionId}</Badge>}
                    {(detail.available === false || detail.isUsable === false) && <Badge variant='destructive'>当前不可用</Badge>}
                    {!actions?.canEdit && <span className='text-muted-foreground text-sm'>当前版本只读</span>}
                  </div>

                  {issues.length > 0 && (
                    <Alert variant='destructive'>
                      <AlertTriangleIcon />
                      <AlertTitle>发现 {issues.length} 个配置问题</AlertTitle>
                      <AlertDescription>
                        <div className='mt-2 flex flex-col gap-1'>
                          {issues.map((issue, index) => (
                            <Button
                              key={`${issue.code}-${issue.path ?? index}`}
                              variant='ghost'
                              className='text-destructive h-auto justify-start whitespace-normal px-2 py-1 text-left'
                              onClick={() => locateIssue(issue)}
                            >
                              {index + 1}. {issue.message}{issue.path ? `（${issue.path}）` : ''}
                            </Button>
                          ))}
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}

                  <ConfigTemplateNav
                    detail={detail}
                    candidates={candidates}
                    versions={versions}
                    activeVersionId={activeVersionId}
                    canEdit={Boolean(actions?.canEdit)}
                    destination={destination}
                    onDestinationChange={setDestination}
                    onDetailChange={setDetail}
                    onSelectVersion={versionId => {
                      setActiveVersionId(versionId)
                      void loadVersion(versionId)
                    }}
                  />
                </div>
              </ScrollArea>

              {isAdmin && actions && (actions.canEdit || actions.canCreateDraft || actions.canArchive) && (
                <div className='flex flex-wrap justify-end gap-2 border-t px-6 py-3'>
                  {actions.canEdit && <Button variant='outline' disabled={saving} onClick={() => void saveDraft()}><SaveIcon />保存草稿</Button>}
                  {actions.canValidate && <Button variant='outline' disabled={saving} onClick={() => void handleValidate()}><CheckCircle2Icon />发布校验</Button>}
                  {actions.canPublish && <Button disabled={saving} onClick={() => setPublishOpen(true)}><SendIcon />发布版本</Button>}
                  {actions.canCreateDraft && <Button disabled={saving} onClick={() => void handleCreateDraft()}><CopyPlusIcon />创建新草稿</Button>}
                  {actions.canArchive && <Button variant='destructive' disabled={saving} onClick={() => setArchiveOpen(true)}><ArchiveIcon />归档版本</Button>}
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={publishOpen}
        title='发布配置模板版本'
        description='发布前将再次保存并执行完整校验。发布后版本不可原地修改，确定继续吗？'
        confirmLabel='确认发布'
        saving={saving}
        onOpenChange={setPublishOpen}
        onConfirm={() => void handlePublish()}
      />
      <ConfirmDialog
        open={archiveOpen}
        title='归档配置模板版本'
        description='归档后不能再用于创建新周期，历史引用仍会保留。确定继续吗？'
        confirmLabel='确认归档'
        destructive
        saving={saving}
        onOpenChange={setArchiveOpen}
        onConfirm={() => void handleArchive()}
      />
    </>
  )
}

const ConfirmDialog = ({
  open,
  title,
  description,
  confirmLabel,
  destructive = false,
  saving,
  onOpenChange,
  onConfirm
}: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  saving: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <DialogFooter>
        <Button variant='outline' onClick={() => onOpenChange(false)}>取消</Button>
        <Button variant={destructive ? 'destructive' : 'default'} disabled={saving} onClick={onConfirm}>{saving && <Loader2Icon className='animate-spin' />}{confirmLabel}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
)

export default ConfigTemplateSheet
