'use client'

import { useCallback, useEffect, useState } from 'react'

import { useRouter } from 'next/navigation'

import { toast } from 'sonner'

import PageHeader from '@/components/shared/PageHeader'
import { ApiError, apiFetch } from '@/lib/api'
import type {
  ListResponse,
  PerfConfigTemplateVersionSummary,
  PerfCycle,
  PerfCycleConfigSnapshot,
  PerfCyclePlan,
  PerfCycleSetupParticipant,
  PerfParticipantPrefixCheck,
  PerfConfigTemplateVersion,
  StartCheckItem
} from '@/lib/perf-api'
import {
  createPerfCycle,
  getPerfCycleConfigSnapshot,
  getPerfCycleParticipantPrefixCheck,
  getPerfCyclePlan,
  getPerfCycleStartCheck,
  initializePerfCycleSetup,
  listPerfConfigTemplates,
  returnPerfCycleToDraft,
  schedulePerfCycle,
  updatePerfCycleBasic,
  updatePerfCycleAdvancedConfig,
  updatePerfCyclePlan
} from '@/lib/perf-api'

import CycleAdvancedConfigSheet from './cycle-advanced-config-sheet'
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
  const [departments, setDepartments] = useState<{ open_department_id: string; name: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const editable = status === 'DRAFT' || status === 'SCHEDULED'

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
        const [configSnapshot, cyclePlan] = await Promise.all([
          getPerfCycleConfigSnapshot(id),
          getPerfCyclePlan(id)
        ])

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
      void apiFetch<{ items: { open_department_id: string; name: string }[] }>('/contact/departments')
        .then(response => setDepartments(response.items ?? []))
        .catch(() => undefined)

      if (realCycleId) {
        void loadCycleSetup(realCycleId).catch(error => toast.error(errorMessage(error, '加载周期配置失败')))
      }
    }, 0)

    return () => clearTimeout(initialLoad)
  }, [realCycleId, loadCycleSetup])

  const saveBasic = async (): Promise<boolean> => {
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

  const addMember = async (openId: string) => {
    if (!realCycleId) return

    try {
      await apiFetch(`/cycles/${realCycleId}/participants`, {
        method: 'POST',
        body: JSON.stringify({ openIds: [openId] })
      })
      await refreshParticipants()
    } catch (error) {
      toast.error(errorMessage(error, '添加参与者失败'))
    }
  }

  const addDepartment = async (departmentId: string) => {
    if (!realCycleId) return

    try {
      const result = await apiFetch<{ added: number }>(`/cycles/${realCycleId}/participants/by-departments`, {
        method: 'POST',
        body: JSON.stringify({ departmentIds: [departmentId] })
      })

      toast.success(`已添加 ${result.added} 人`)
      await refreshParticipants()
    } catch (error) {
      toast.error(errorMessage(error, '按部门添加参与者失败'))
    }
  }

  const removeMember = async (participantId: number) => {
    if (!realCycleId) return

    try {
      await apiFetch(`/cycles/${realCycleId}/participants/${participantId}`, { method: 'DELETE' })
      await refreshParticipants()
    } catch (error) {
      toast.error(errorMessage(error, '移除参与者失败'))
    }
  }

  const togglePromotion = async (participant: PerfCycleSetupParticipant) => {
    if (!realCycleId) return

    try {
      await apiFetch(`/cycles/${realCycleId}/participants/${participant.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isPromotionEnabled: !participant.isPromotionEnabled })
      })
      await refreshParticipants()
    } catch (error) {
      toast.error(errorMessage(error, '更新晋升评估标记失败'))
    }
  }

  const savePlan = async (): Promise<boolean> => {
    if (!realCycleId) return false
    setSaving(true)

    try {
      const saved = await updatePerfCyclePlan(realCycleId, plan)

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

  const saveAdvancedConfig = async (value: PerfConfigTemplateVersion) => {
    if (!realCycleId) return
    setSaving(true)

    try {
      const updated = await updatePerfCycleAdvancedConfig(realCycleId, {
        stageModes: value.stageModes,
        ratings: value.ratings,
        constraintProfiles: value.constraintProfiles,
        reviewerRelationWeights: value.reviewerRelationWeights
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
        description='通过四步完成周期快照、参与者匹配、实际计划与启动检查'
        backHref={realCycleId ? `/cycles/${realCycleId}` : '/cycles'}
        backLabel={realCycleId ? '周期详情' : '绩效周期'}
      />

      <CycleSetupEditor
        status={status}
        draft={draft}
        configTemplates={configTemplates}
        sourceConfigLabel={sourceConfigLabel}
        participants={participants}
        prefixChecks={prefixChecks}
        plan={plan}
        checkItems={checkItems}
        checkOk={checkOk}
        editable={editable}
        saving={saving}
        setupReady={realCycleId != null && snapshot != null}
        departments={departments}
        onDraftChange={setDraft}
        onSaveBasic={saveBasic}
        onAddMember={openId => void addMember(openId)}
        onAddDepartment={departmentId => void addDepartment(departmentId)}
        onRemoveMember={participantId => void removeMember(participantId)}
        onTogglePromotion={participant => void togglePromotion(participant)}
        onPlanChange={setPlan}
        onSavePlan={savePlan}
        onRunChecks={() => void runChecks()}
        onSaveDraft={() => realCycleId && router.push(`/cycles/${realCycleId}`)}
        onSchedule={() => void scheduleCycle()}
        onReturnToDraft={() => void returnToDraft()}
        onOpenAdvanced={() => setAdvancedOpen(true)}
      />

      <CycleAdvancedConfigSheet
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        snapshot={snapshot}
        editable={editable}
        saving={saving}
        onSave={saveAdvancedConfig}
      />
    </div>
  )
}

export default CycleEdit
