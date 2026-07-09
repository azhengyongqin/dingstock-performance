'use client'

// React Imports
import { useEffect, useMemo, useState } from 'react'

// Third-party Imports
import { Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'

// Component Imports
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

// Util Imports
import { ApiError, apiFetch } from '@/lib/api'
import type { PerfRole, PerfTemplate } from '@/lib/perf-api'
import { cn } from '@/lib/utils'

import DimensionSection from './dimension-section'
import type { DimensionDraft, LevelDraft } from './types'
import { EMPTY_LEVEL, summarizeWeights } from './types'

/** 模板详情（GET /templates/:id，含维度项） */
type TemplateDetail = Omit<PerfTemplate, 'dimensions'> & {
  dimensions: {
    id: number
    name: string
    type: string
    scoringMethod: string
    weight: string | number | null
    editableRoles: PerfRole[]
    applicableScope?: { jobCategory?: string } | null
    conclusionOptions?: string[] | null
  }[]
}

/**
 * 模板编辑侧滑抽屉（HR/ADMIN）：Tabs 分「基本信息 / 评分等级 / 评估维度」，
 * 全部行内编辑，「保存」统一 PATCH + PUT 两步提交后关闭；
 * 修改模板不影响已用其创建的周期（创建周期时为复制快照）。
 */
const TemplateSheet = ({
  templateId,
  onClose,
  onSaved
}: {
  templateId: number | null
  onClose: () => void
  onSaved: () => void
}) => {
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  // 打开/切换模板时重置加载态（渲染期间调整 state，规避 set-state-in-effect）
  const [activeId, setActiveId] = useState<number | null>(null)

  if (templateId !== activeId) {
    setActiveId(templateId)
    setLoaded(false)
  }

  // 编辑器草稿态
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [levels, setLevels] = useState<LevelDraft[]>([])
  const [dimensions, setDimensions] = useState<DimensionDraft[]>([])

  // ---- 打开时加载详情 ----

  useEffect(() => {
    if (templateId == null) return

    let cancelled = false

    const load = async () => {
      try {
        const detail = await apiFetch<TemplateDetail>(`/templates/${templateId}`)

        if (cancelled) return

        setName(detail.name)
        setDescription(detail.description ?? '')
        setIsDefault(detail.isDefault)
        setLevels(
          (detail.levels ?? []).map(item => ({
            level: item.level,
            min: String(item.scoreRange?.[0] ?? ''),
            max: String(item.scoreRange?.[1] ?? ''),
            description: item.description ?? ''
          }))
        )
        setDimensions(
          (detail.dimensions ?? []).map(dim => ({
            id: dim.id,
            name: dim.name,
            type: dim.type,
            scoringMethod: dim.scoringMethod,
            weight: dim.weight != null ? String(Number(dim.weight)) : '',
            editableRoles: dim.editableRoles,
            jobCategory: dim.applicableScope?.jobCategory ?? '',
            conclusionOptions: (dim.conclusionOptions ?? []).join('、')
          }))
        )
        setLoaded(true)
      } catch (err) {
        if (cancelled) return
        toast.error(err instanceof ApiError ? err.message : '加载模板详情失败')
        onClose()
      }
    }

    void load()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId])

  const weightSummary = useMemo(() => summarizeWeights(dimensions), [dimensions])

  // ---- 保存：PATCH 基本信息+等级，PUT 维度 ----

  const handleSave = async () => {
    if (templateId == null) return

    if (!name.trim()) {
      toast.error('模板名称不能为空')

      return
    }

    for (const item of weightSummary) {
      if (!item.ok) {
        toast.warning(`分组「${item.label}」权重合计为 ${item.total}，启动周期前需调整为 100`)
        break
      }
    }

    setSaving(true)

    try {
      await apiFetch(`/templates/${templateId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          description: description || undefined,
          isDefault,
          levels: levels.map(item => ({
            level: item.level,
            scoreRange: [Number(item.min) || 0, Number(item.max) || 0],
            description: item.description
          }))
        })
      })
      await apiFetch(`/templates/${templateId}/dimensions`, {
        method: 'PUT',
        body: JSON.stringify({
          items: dimensions.map((dim, index) => ({
            id: dim.id,
            name: dim.name,
            type: dim.type,
            scoringMethod: dim.scoringMethod,
            weight: dim.weight === '' ? undefined : Number(dim.weight),
            sortOrder: index,
            editableRoles: dim.editableRoles,
            visibleRoles: dim.editableRoles,
            applicableScope: dim.jobCategory ? { jobCategory: dim.jobCategory } : undefined,
            conclusionOptions:
              dim.scoringMethod === 'CONCLUSION' && dim.conclusionOptions
                ? dim.conclusionOptions.split(/[、,，]/).map(item => item.trim()).filter(Boolean)
                : undefined,
            employeeVisible: dim.type === 'PROMOTION' ? true : undefined
          }))
        })
      })
      toast.success('模板已保存；已创建的周期不受影响')
      onSaved()
      onClose()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={templateId != null} onOpenChange={value => !value && onClose()}>
      <SheetContent className='gap-0 data-[side=right]:sm:max-w-2xl'>
        {!loaded ? (
          <div className='text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm'>
            <Loader2Icon className='size-4 animate-spin' />
            正在加载模板详情…
          </div>
        ) : (
          <>
            <SheetHeader className='border-b px-6 pt-5 pb-4'>
              <SheetTitle className='sr-only'>编辑模板</SheetTitle>
              <div className='flex items-center gap-3 pr-8'>
                <Input className='max-w-64 font-medium' value={name} onChange={event => setName(event.target.value)} />
                <label className='flex items-center gap-2 text-sm'>
                  <Switch checked={isDefault} onCheckedChange={checked => setIsDefault(Boolean(checked))} />
                  默认模板
                </label>
              </div>
            </SheetHeader>

            <ScrollArea className='min-h-0 flex-1'>
              <div className='px-6 py-4'>
                <Tabs defaultValue='basic'>
                  <TabsList>
                    <TabsTrigger value='basic'>基本信息</TabsTrigger>
                    <TabsTrigger value='levels'>
                      评分等级
                      <Badge variant='outline' className='ml-1.5'>
                        {levels.length}
                      </Badge>
                    </TabsTrigger>
                    <TabsTrigger value='dimensions'>
                      评估维度
                      <Badge variant='outline' className='ml-1.5'>
                        {dimensions.length}
                      </Badge>
                    </TabsTrigger>
                  </TabsList>

                  {/* 基本信息 */}
                  <TabsContent value='basic' className='mt-4'>
                    <Field className='gap-2'>
                      <FieldLabel>模板说明</FieldLabel>
                      <Textarea
                        rows={3}
                        value={description}
                        placeholder='适用范围、维度设计说明…'
                        onChange={event => setDescription(event.target.value)}
                      />
                    </Field>
                    <p className='text-muted-foreground mt-3 text-xs'>
                      默认模板在新建周期向导中默认选中（全局唯一）；修改模板不影响已创建的周期（创建周期时为复制快照）。
                    </p>
                  </TabsContent>

                  {/* 评分等级：行内编辑，综合评分落入分数区间即得到对应绩效等级 */}
                  <TabsContent value='levels' className='mt-4 flex flex-col gap-2'>
                    <div className='text-muted-foreground grid grid-cols-[3.5rem_4.5rem_4.5rem_1fr_2rem] gap-2 px-0.5 text-xs'>
                      <span>等级</span>
                      <span>下限</span>
                      <span>上限</span>
                      <span>说明</span>
                      <span />
                    </div>
                    {levels.map((level, index) => (
                      <div key={index} className='grid grid-cols-[3.5rem_4.5rem_4.5rem_1fr_2rem] items-center gap-2'>
                        <Input
                          value={level.level}
                          onChange={event =>
                            setLevels(prev => prev.map((item, i) => (i === index ? { ...item, level: event.target.value } : item)))
                          }
                        />
                        <Input
                          type='number'
                          value={level.min}
                          onChange={event =>
                            setLevels(prev => prev.map((item, i) => (i === index ? { ...item, min: event.target.value } : item)))
                          }
                        />
                        <Input
                          type='number'
                          value={level.max}
                          onChange={event =>
                            setLevels(prev => prev.map((item, i) => (i === index ? { ...item, max: event.target.value } : item)))
                          }
                        />
                        <Input
                          value={level.description}
                          placeholder='如 远超预期'
                          onChange={event =>
                            setLevels(prev =>
                              prev.map((item, i) => (i === index ? { ...item, description: event.target.value } : item))
                            )
                          }
                        />
                        <Button
                          variant='ghost'
                          size='icon-sm'
                          onClick={() => setLevels(prev => prev.filter((_, i) => i !== index))}
                        >
                          <Trash2Icon className='size-4' />
                          <span className='sr-only'>删除等级</span>
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant='outline'
                      size='sm'
                      className='self-start'
                      onClick={() => setLevels(prev => [...prev, EMPTY_LEVEL])}
                    >
                      <PlusIcon className='size-4' />
                      添加等级
                    </Button>
                  </TabsContent>

                  {/* 评估维度：按岗位分组 + 行内展开编辑 */}
                  <TabsContent value='dimensions' className='mt-4'>
                    <DimensionSection dimensions={dimensions} onChange={setDimensions} />
                  </TabsContent>
                </Tabs>
              </div>
            </ScrollArea>

            {/* 底部：权重状态 + 操作 */}
            <div className='flex items-center gap-2 border-t px-6 py-3'>
              <div className='flex min-w-0 flex-1 flex-wrap gap-1.5'>
                {weightSummary.map(item => (
                  <Badge
                    key={item.label}
                    variant='outline'
                    className={cn(!item.ok && 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400')}
                  >
                    {item.label} {item.total}%{!item.ok && '（需为 100%）'}
                  </Badge>
                ))}
              </div>
              <Button variant='outline' onClick={onClose}>
                取消
              </Button>
              <Button disabled={saving} onClick={() => void handleSave()}>
                {saving && <Loader2Icon className='size-4 animate-spin' />}
                保存
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

export default TemplateSheet
