'use client'

import { useCallback, useEffect, useState } from 'react'

import { AlertTriangleIcon, ArchiveIcon, CopyPlusIcon, Loader2Icon, SaveIcon, SendIcon } from 'lucide-react'
import { toast } from 'sonner'

import { ApiError } from '@/lib/api'
import type {
  FormTemplateValidationIssue,
  PerfFormTemplateVersion,
  PerfFormTemplateVersionSummary
} from '@/lib/perf-api'
import {
  archivePerfFormTemplateVersion,
  createPerfFormTemplateDraft,
  getPerfFormTemplateVersion,
  listPerfFormTemplateVersions,
  publishPerfFormTemplateVersion,
  updatePerfFormTemplateVersion
} from '@/lib/perf-api'

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

import { FORM_TEMPLATE_STATUS_LABEL, JOB_LEVEL_PREFIX_LABEL } from './form-template-constants'
import { FormTemplateNav, type FormNavDestination } from './form-template-nav'
import { collectFormIssueMarkers, getFormTemplateActions, issueDestinationForPath } from './form-template-utils'

const readValidationIssues = (error: unknown): FormTemplateValidationIssue[] => {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== 'object') return []
  const body = error.body as { issues?: unknown; message?: unknown }

  if (Array.isArray(body.issues)) {
    return body.issues
      .map(issue => {
        if (typeof issue === 'string') return { code: 'VALIDATION_ERROR', message: issue }
        if (issue && typeof issue === 'object' && 'message' in issue) return issue as FormTemplateValidationIssue

        return null
      })
      .filter((issue): issue is FormTemplateValidationIssue => issue != null)
  }

  if (Array.isArray(body.message)) {
    return body.message.map(message => ({ code: 'VALIDATION_ERROR', message: String(message) }))
  }

  return []
}

type FormTemplateSheetProps = {
  selected: PerfFormTemplateVersionSummary | null
  isAdmin: boolean
  onClose: () => void
  onChanged: () => void
}

/** 版本详情、草稿设计、填写预览和生命周期动作的统一侧滑面板。 */
const FormTemplateSheet = ({ selected, isAdmin, onClose, onChanged }: FormTemplateSheetProps) => {
  const [activeVersionId, setActiveVersionId] = useState<number | null>(null)
  const [detail, setDetail] = useState<PerfFormTemplateVersion | null>(null)
  const [versions, setVersions] = useState<PerfFormTemplateVersionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [issues, setIssues] = useState<FormTemplateValidationIssue[]>([])
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [destination, setDestination] = useState<FormNavDestination>('basic')

  const loadVersion = useCallback(async (versionId: number) => {
    setLoading(true)
    setIssues([])

    try {
      setDetail(await getPerfFormTemplateVersion(versionId))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载评估表单模板失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadHistory = useCallback(async (templateId: number) => {
    try {
      const response = await listPerfFormTemplateVersions(templateId)

      setVersions(response.items ?? [])
    } catch {
      // HR 只读接口若不提供管理历史，保留当前已发布版本即可。
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

  const saveDraft = async (): Promise<PerfFormTemplateVersion | null> => {
    if (!detail) return null

    if (!detail.name.trim()) {
      toast.error('模板名称不能为空')

      return null
    }

    setSaving(true)
    setIssues([])

    try {
      const saved = await updatePerfFormTemplateVersion(detail.id, {
        name: detail.name.trim(),
        description: detail.description,
        jobLevelPrefix: detail.jobLevelPrefix,
        subforms: detail.subforms
      })

      setDetail(saved)
      toast.success('草稿已保存')
      onChanged()

      return saved
    } catch (error) {
      const nextIssues = readValidationIssues(error)

      setIssues(nextIssues)
      toast.error(error instanceof Error ? error.message : '保存失败')

      return null
    } finally {
      setSaving(false)
    }
  }

  const handlePublish = async () => {
    if (!detail) return
    const saved = await saveDraft()

    if (!saved) return
    setSaving(true)

    try {
      const published = await publishPerfFormTemplateVersion(saved.id)

      setDetail(published)
      setIssues([])
      toast.success(`v${published.version} 已发布，后续修改需创建新草稿`)
      await loadHistory(published.templateId)
      onChanged()
    } catch (error) {
      const nextIssues = readValidationIssues(error)

      setIssues(
        nextIssues.length > 0
          ? nextIssues
          : [{ code: 'PUBLISH_FAILED', message: error instanceof Error ? error.message : '发布失败' }]
      )
      toast.error('发布校验未通过，请修正全部问题后重试')
    } finally {
      setSaving(false)
    }
  }

  const handleCreateDraft = async () => {
    if (!detail) return
    setSaving(true)

    try {
      const draft = await createPerfFormTemplateDraft(detail.id)

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
      const archived = await archivePerfFormTemplateVersion(detail.id)

      setDetail(archived)
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

  const actions = detail ? getFormTemplateActions(detail.status, isAdmin) : null
  const issueMarkers = collectFormIssueMarkers(issues)

  const locateIssue = (issue: FormTemplateValidationIssue) => {
    setDestination(issueDestinationForPath(issue.path))
  }

  return (
    <>
      <Sheet open={selected != null} onOpenChange={open => !open && onClose()}>
        <SheetContent className='gap-0 data-[side=right]:sm:max-w-6xl'>
          <SheetHeader className='border-b px-6 py-4'>
            <SheetTitle>{detail ? `${detail.name} · v${detail.version}` : '评估表单模板'}</SheetTitle>
          </SheetHeader>

          {loading || !detail ? (
            <div className='text-muted-foreground flex flex-1 items-center justify-center gap-2'>
              <Loader2Icon className='size-4 animate-spin' />
              正在加载模板版本…
            </div>
          ) : (
            <>
              <ScrollArea className='min-h-0 flex-1'>
                <div className='flex flex-col gap-5 px-6 py-5'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <Badge>{FORM_TEMPLATE_STATUS_LABEL[detail.status]}</Badge>
                    <Badge variant='outline'>{JOB_LEVEL_PREFIX_LABEL[detail.jobLevelPrefix]}</Badge>
                    {detail.sourceVersionId && <Badge variant='outline'>来源 #{detail.sourceVersionId}</Badge>}
                    {!actions?.canEdit && <span className='text-muted-foreground text-sm'>当前版本只读</span>}
                  </div>

                  {issues.length > 0 && (
                    <Alert variant='destructive'>
                      <AlertTriangleIcon />
                      <AlertTitle>发布校验发现 {issues.length} 个问题</AlertTitle>
                      <AlertDescription>
                        <div className='mt-2 flex flex-col gap-1'>
                          {issues.map((issue, index) => (
                            <Button
                              key={`${issue.code}-${issue.path ?? index}`}
                              variant='ghost'
                              className='text-destructive h-auto justify-start px-2 py-1 text-left whitespace-normal'
                              onClick={() => locateIssue(issue)}
                            >
                              {index + 1}. {issue.message}
                            </Button>
                          ))}
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}

                  <FormTemplateNav
                    detail={detail}
                    versions={versions}
                    activeVersionId={activeVersionId}
                    canEdit={Boolean(actions?.canEdit)}
                    destination={destination}
                    issueMarkers={issueMarkers}
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
                  {actions.canEdit && (
                    <Button variant='outline' disabled={saving} onClick={() => void saveDraft()}>
                      <SaveIcon />
                      保存草稿
                    </Button>
                  )}
                  {actions.canPublish && (
                    <Button disabled={saving} onClick={() => void handlePublish()}>
                      {saving ? <Loader2Icon className='animate-spin' /> : <SendIcon />}
                      发布版本
                    </Button>
                  )}
                  {actions.canCreateDraft && (
                    <Button disabled={saving} onClick={() => void handleCreateDraft()}>
                      <CopyPlusIcon />
                      创建新草稿
                    </Button>
                  )}
                  {actions.canArchive && (
                    <Button variant='destructive' disabled={saving} onClick={() => setArchiveOpen(true)}>
                      <ArchiveIcon />
                      归档版本
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>归档当前版本</DialogTitle>
            <DialogDescription>归档后该版本不能再用于新的配置模板，但历史引用仍会保留。确定继续吗？</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setArchiveOpen(false)}>
              取消
            </Button>
            <Button variant='destructive' disabled={saving} onClick={() => void handleArchive()}>
              确认归档
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default FormTemplateSheet
