'use client'

import { useCallback, useEffect, useState } from 'react'

import { useRouter } from 'next/navigation'

import { toast } from 'sonner'

import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { ApiError, apiFetch } from '@/lib/api'
import type {
  ListResponse,
  PerfConfigTemplateVersionSummary,
  PerfCycle,
  PerfCycleConfigSnapshot,
  ActivePerfCycleConfigImpact,
  ActivePerfCycleConfigInput,
  ActivePerfCycleDimensionOverride,
  PerfCyclePlan,
  PerfCycleSetupParticipant,
  PerfParticipantPrefixCheck,
  PerfConfigTemplateVersion,
  StartCheckItem
} from '@/lib/perf-api'
import {
  createPerfCycle,
  applyActivePerfCycleConfig,
  getPerfCycleConfigSnapshot,
  getPerfCycleParticipantPrefixCheck,
  getPerfCyclePlan,
  getPerfCycleStartCheck,
  initializePerfCycleSetup,
  listPerfConfigTemplates,
  previewActivePerfCycleConfig,
  reapplyPerfCycleConfigSnapshot,
  returnPerfCycleToDraft,
  schedulePerfCycle,
  updatePerfCycleBasic,
  updatePerfCycleAdvancedConfig,
  updatePerfCyclePlan
} from '@/lib/perf-api'

import CycleAdvancedConfigSheet from './cycle-advanced-config-sheet'
import ActiveConfigImpactDialog from './active-config-impact-dialog'
import { requiresActiveConfigRepreview } from './active-config-flow'
import CycleSetupEditor, { type CycleSetupDraft } from './cycle-setup-editor'
import { toDateTimeInputValue, toIsoDateTimeValue } from './cycle-setup-utils'

const EMPTY_PLAN: PerfCyclePlan = {
  allowStageOverlap: true,
  stages: [],
  notificationRules: { stages: [] }
}

const errorMessage = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback)

const CycleEdit = ({ cycleId }: { cycleId: string }) => {
  const router = useRouter()
  const initialCycleId = cycleId === 'new' ? null : Number(cycleId)
  const [realCycleId, setRealCycleId] = useState<number | null>(initialCycleId)
  const [status, setStatus] = useState<PerfCycle['status']>('DRAFT')

  const [draft, setDraft] = useState<CycleSetupDraft>({
    name: '',
    configTemplateVersionId: '',
    plannedStartAt: ''
  })

  const [configTemplates, setConfigTemplates] = useState<PerfConfigTemplateVersionSummary[]>([])
  const [sourceConfigLabel, setSourceConfigLabel] = useState('')
  const [snapshot, setSnapshot] = useState<PerfCycleConfigSnapshot | null>(null)
  const [participants, setParticipants] = useState<PerfCycleSetupParticipant[]>([])
  const [prefixChecks, setPrefixChecks] = useState<PerfParticipantPrefixCheck[]>([])
  const [plan, setPlan] = useState<PerfCyclePlan>(EMPTY_PLAN)
  const [checkItems, setCheckItems] = useState<StartCheckItem[]>([])
  const [checkOk, setCheckOk] = useState(false)
  const [saving, setSaving] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [activeConfigImpact, setActiveConfigImpact] = useState<ActivePerfCycleConfigImpact | null>(null)
  const [pendingActiveConfig, setPendingActiveConfig] = useState<ActivePerfCycleConfigInput | null>(null)

  const [withdrawTarget, setWithdrawTarget] = useState<{
    participantId: number
    name: string
  } | null>(null)

  const [withdrawReason, setWithdrawReason] = useState('')

  const editable = status !== 'ARCHIVED'
  const activeConfigEditable = status === 'ACTIVE'
  const participantAction = !editable ? 'NONE' : status === 'ACTIVE' ? 'WITHDRAW' : 'REMOVE'

  const loadParticipants = useCallback(async (id: number) => {
    const [participantData, prefixData] = await Promise.all([
      apiFetch<ListResponse<PerfCycleSetupParticipant>>(`/cycles/${id}/participants`),
      getPerfCycleParticipantPrefixCheck(id)
    ])

    setParticipants(participantData.items ?? [])
    setPrefixChecks(prefixData.items ?? [])
  }, [])

  const loadCycleSetup = useCallback(
    async (id: number) => {
      const cycle = await apiFetch<PerfCycle>(`/cycles/${id}`)

      setStatus(cycle.status)
      setDraft({
        name: cycle.name,
        configTemplateVersionId: '',
        plannedStartAt: toDateTimeInputValue(cycle.plannedStartAt)
      })

      if (cycle.currentConfigVersionId) {
        const [configSnapshot, cyclePlan] = await Promise.all([getPerfCycleConfigSnapshot(id), getPerfCyclePlan(id)])

        setSnapshot(configSnapshot)
        setPlan(cyclePlan)
        setSourceConfigLabel(
          configSnapshot.source
            ? `${configSnapshot.source.name} · v${configSnapshot.source.version}`
            : `配置模板版本 #${configSnapshot.sourceConfigTemplateVersionId ?? '-'}`
        )
        setDraft(current => ({
          ...current,
          configTemplateVersionId: configSnapshot.sourceConfigTemplateVersionId
            ? String(configSnapshot.sourceConfigTemplateVersionId)
            : ''
        }))
      } else {
        // 迁移后的旧 DRAFT 没有快照：保留基础信息并让用户重新选择已发布配置。
        setSnapshot(null)
        setPlan(EMPTY_PLAN)
        setSourceConfigLabel('')
      }

      await loadParticipants(id)
    },
    [loadParticipants]
  )

  useEffect(() => {
    const initialLoad = setTimeout(() => {
      void listPerfConfigTemplates()
        .then(response => setConfigTemplates(response.items ?? []))
        .catch(() => undefined)

      if (realCycleId) {
        void loadCycleSetup(realCycleId).catch(error => toast.error(errorMessage(error, '加载周期配置失败')))
      }
    }, 0)

    return () => clearTimeout(initialLoad)
  }, [realCycleId, loadCycleSetup])

  const saveBasic = async (): Promise<boolean> => {
    // ACTIVE 的计划启动时间已经成为历史锚点；进行中编辑从参与者和实际计划开始，不重写基础锚点。
    if (status === 'ACTIVE') return true

    if (!draft.name.trim() || !draft.plannedStartAt || (!snapshot && !draft.configTemplateVersionId)) {
      toast.error('请填写周期名称、配置模板版本和计划启动时间')

      return false
    }

    setSaving(true)

    try {
      if (!realCycleId) {
        const created = await createPerfCycle({
          name: draft.name.trim(),
          configTemplateVersionId: Number(draft.configTemplateVersionId),
          plannedStartAt: toIsoDateTimeValue(draft.plannedStartAt)
        })

        setRealCycleId(created.id)
        setStatus(created.status)
        window.history.replaceState(null, '', `/cycles/${created.id}/edit`)
        await loadCycleSetup(created.id)
        toast.success('周期草稿已创建，配置与表单已复制为独立快照')
      } else if (!snapshot) {
        const initialized = await initializePerfCycleSetup(realCycleId, {
          name: draft.name.trim(),
          configTemplateVersionId: Number(draft.configTemplateVersionId),
          plannedStartAt: toIsoDateTimeValue(draft.plannedStartAt)
        })

        setStatus(initialized.status)
        await loadCycleSetup(realCycleId)
        toast.success('旧周期已补齐配置与表单快照')
      } else {
        const updated = await updatePerfCycleBasic(realCycleId, {
          name: draft.name.trim(),
          plannedStartAt: toIsoDateTimeValue(draft.plannedStartAt)
        })

        setStatus(updated.status)
        await loadCycleSetup(realCycleId)
        toast.success('基本信息已保存')
      }

      return true
    } catch (error) {
      toast.error(errorMessage(error, '保存基本信息失败'))

      return false
    } finally {
      setSaving(false)
    }
  }

  const refreshParticipants = async () => {
    if (!realCycleId) return

    try {
      await loadParticipants(realCycleId)
    } catch (error) {
      toast.error(errorMessage(error, '刷新参与者检查失败'))
    }
  }

  /** 组织多选确认：人名单与部门圈人分接口提交，再统一刷新参与者表 */
  const addParticipants = async (payload: { openIds: string[]; departmentIds: string[] }) => {
    if (!realCycleId) return
    if (payload.openIds.length === 0 && payload.departmentIds.length === 0) return

    try {
      let added = 0

      if (payload.openIds.length > 0) {
        const byUsers = await apiFetch<{ added?: number }>(`/cycles/${realCycleId}/participants`, {
          method: 'POST',
          body: JSON.stringify({ openIds: payload.openIds })
        })

        added += byUsers.added ?? payload.openIds.length
      }

      if (payload.departmentIds.length > 0) {
        const byDepartments = await apiFetch<{ added: number }>(`/cycles/${realCycleId}/participants/by-departments`, {
          method: 'POST',
          body: JSON.stringify({ departmentIds: payload.departmentIds })
        })

        added += byDepartments.added
      }

      toast.success(`已添加 ${added} 人`)
      await refreshParticipants()
    } catch (error) {
      toast.error(errorMessage(error, '添加参与者失败'))
    }
  }

  const removeMember = async (participantId: number) => {
    if (!realCycleId) return

    if (status === 'ACTIVE') {
      const participant = participants.find(item => item.id === participantId)

      setWithdrawTarget({
        participantId,
        name: participant?.employee?.name ?? participant?.employeeOpenId ?? `参与者 #${participantId}`
      })
      setWithdrawReason('')

      return
    }

    setSaving(true)

    try {
      await apiFetch(`/cycles/${realCycleId}/participants/${participantId}`, {
        method: 'DELETE'
      })
      await refreshParticipants()
    } catch (error) {
      toast.error(errorMessage(error, '移除参与者失败'))
    } finally {
      setSaving(false)
    }
  }

  const confirmWithdraw = async () => {
    if (!realCycleId || !withdrawTarget || !withdrawReason.trim()) return
    setSaving(true)

    try {
      await apiFetch(`/cycles/${realCycleId}/participants/${withdrawTarget.participantId}/withdraw`, {
        method: 'POST',
        body: JSON.stringify({ reason: withdrawReason.trim() })
      })
      toast.success(`${withdrawTarget.name} 已设为中途退出，历史过程数据已保留`)
      setWithdrawTarget(null)
      setWithdrawReason('')
      await refreshParticipants()
    } catch (error) {
      toast.error(errorMessage(error, '设置中途退出失败'))
    } finally {
      setSaving(false)
    }
  }

  const savePlan = async (reason?: string): Promise<boolean> => {
    if (!realCycleId) return false
    setSaving(true)

    try {
      const saved = await updatePerfCyclePlan(realCycleId, { ...plan, reason })

      setPlan(saved)
      toast.success('计划与通知规则已保存')

      return true
    } catch (error) {
      toast.error(errorMessage(error, '保存计划失败'))

      return false
    } finally {
      setSaving(false)
    }
  }

  const saveAdvancedConfig = async (
    value: PerfConfigTemplateVersion,
    dimensionOverrides: ActivePerfCycleDimensionOverride[]
  ) => {
    if (!realCycleId || !snapshot) return
    setSaving(true)

    try {
      const config = {
        ratings: value.ratings,
        reviewerRelationWeights: value.reviewerRelationWeights
      }

      if (status === 'ACTIVE') {
        const input = { ...config, expectedConfigVersionId: snapshot.id, dimensionOverrides }
        const impact = await previewActivePerfCycleConfig(realCycleId, input)

        setPendingActiveConfig(input)
        setActiveConfigImpact(impact)
        setAdvancedOpen(false)

        return
      }

      const updated = await updatePerfCycleAdvancedConfig(realCycleId, {
        ...config
      })

      setSnapshot(updated)
      setAdvancedOpen(false)
      setCheckOk(false)
      toast.success('周期高级配置已保存')
    } catch (error) {
      toast.error(errorMessage(error, '保存高级配置失败'))
    } finally {
      setSaving(false)
    }
  }

  const applyActiveConfig = async (reason: string) => {
    if (!realCycleId || !pendingActiveConfig || !activeConfigImpact) return
    setSaving(true)

    try {
      const result = await applyActivePerfCycleConfig(realCycleId, {
        ...pendingActiveConfig,
        impactRevision: activeConfigImpact.impactRevision,
        reason,
        confirmed: true
      })

      toast.success(`已创建周期配置 v${result.version} 并统一重算阶段结果`)
      setActiveConfigImpact(null)
      setPendingActiveConfig(null)
      await loadCycleSetup(realCycleId)
    } catch (error) {
      if (requiresActiveConfigRepreview(error)) {
        setActiveConfigImpact(null)
        setPendingActiveConfig(null)
        setAdvancedOpen(true)
        toast.error('影响范围已变化，请重新预览后再确认')

        return
      }

      toast.error(errorMessage(error, '活动周期配置重算失败'))
    } finally {
      setSaving(false)
    }
  }

  /** 重新套用模板：整体覆盖当前配置快照（不做字段级合并），成功后刷新快照/来源标签/计划/参与者检查。 */
  const reapplyTemplate = async (configTemplateVersionId: number): Promise<boolean> => {
    if (!realCycleId) return false
    setSaving(true)

    try {
      await reapplyPerfCycleConfigSnapshot(realCycleId, configTemplateVersionId)
      toast.success('已重新套用模板：评估规则与评估维度已整套覆盖为所选模板版本快照')
      await loadCycleSetup(realCycleId)

      return true
    } catch (error) {
      toast.error(errorMessage(error, '重新套用模板失败'))

      return false
    } finally {
      setSaving(false)
    }
  }

  const runChecks = async () => {
    if (!realCycleId) return

    try {
      const result = await getPerfCycleStartCheck(realCycleId)

      setCheckItems(result.items)
      setCheckOk(result.ok)
    } catch (error) {
      toast.error(errorMessage(error, '启动检查失败'))
    }
  }

  const scheduleCycle = async () => {
    if (!realCycleId) return
    setSaving(true)

    try {
      const result = await schedulePerfCycle(realCycleId)

      setStatus(result.cycle.status)
      toast.success('周期已设为待启动，到达计划时间前不会生成可填写任务')
    } catch (error) {
      toast.error(errorMessage(error, '设置待启动失败'))
    } finally {
      setSaving(false)
    }
  }

  const returnToDraft = async () => {
    if (!realCycleId) return
    setSaving(true)

    try {
      const result = await returnPerfCycleToDraft(realCycleId)

      setStatus(result.cycle.status)
      setCheckOk(false)
      toast.success('周期已退回草稿，可继续调整配置与名单')
    } catch (error) {
      toast.error(errorMessage(error, '退回草稿失败'))
    } finally {
      setSaving(false)
    }
  }

  const title = realCycleId ? `编辑绩效周期${draft.name ? ` · ${draft.name}` : ''}` : '新建绩效周期'

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title={title}
        description={
          status === 'ACTIVE'
            ? '调整进行中周期的参与者、任务时间、通知规则与计算配置'
            : '通过四步完成周期快照、参与者匹配、实际计划与启动检查'
        }
        backHref={realCycleId ? `/cycles/${realCycleId}` : '/cycles'}
        backLabel={realCycleId ? '周期详情' : '绩效周期'}
      />

      <CycleSetupEditor
        status={status}
        draft={draft}
        configTemplates={configTemplates}
        sourceConfigLabel={sourceConfigLabel}
        snapshotManuallyModified={snapshot?.manuallyModified}
        participants={participants}
        prefixChecks={prefixChecks}
        plan={plan}
        checkItems={checkItems}
        checkOk={checkOk}
        editable={editable}
        participantAction={participantAction}
        saving={saving}
        setupReady={realCycleId != null && snapshot != null}
        onDraftChange={setDraft}
        onSaveBasic={saveBasic}
        onAddParticipants={payload => void addParticipants(payload)}
        onRemoveMember={participantId => void removeMember(participantId)}
        onPlanChange={setPlan}
        onSavePlan={savePlan}
        onRunChecks={() => void runChecks()}
        onSaveDraft={() => realCycleId && router.push(`/cycles/${realCycleId}`)}
        onSchedule={() => void scheduleCycle()}
        onReturnToDraft={() => void returnToDraft()}
        onOpenAdvanced={() => setAdvancedOpen(true)}
        onReapplyTemplate={reapplyTemplate}
      />

      <CycleAdvancedConfigSheet
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        snapshot={snapshot}
        editable={editable || activeConfigEditable}
        active={activeConfigEditable}
        saving={saving}
        onSave={saveAdvancedConfig}
      />

      {activeConfigImpact && (
        <ActiveConfigImpactDialog
          open
          impact={activeConfigImpact}
          applying={saving}
          onCancel={() => {
            setActiveConfigImpact(null)
            setPendingActiveConfig(null)
          }}
          onConfirm={applyActiveConfig}
        />
      )}

      <Dialog open={withdrawTarget != null} onOpenChange={open => !open && setWithdrawTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>将参与者设为中途退出</DialogTitle>
            <DialogDescription>
              {withdrawTarget?.name} 将不再继续本周期评审，未完成任务会收口；已有答卷与过程数据会完整保留。
            </DialogDescription>
          </DialogHeader>
          <Field className='gap-2'>
            <FieldLabel htmlFor='participant-withdraw-reason'>退出原因</FieldLabel>
            <Textarea
              id='participant-withdraw-reason'
              value={withdrawReason}
              maxLength={500}
              placeholder='例如：员工离职、组织调整'
              onChange={event => setWithdrawReason(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant='outline' onClick={() => setWithdrawTarget(null)}>
              取消
            </Button>
            <Button
              variant='destructive'
              disabled={saving || !withdrawReason.trim()}
              onClick={() => void confirmWithdraw()}
            >
              确认中途退出
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default CycleEdit
