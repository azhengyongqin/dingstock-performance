// 配置模板共享类型与常量：草稿态类型 + 选项/标签映射 + 权重合计
import type { PerfRole } from '@/lib/perf-api'

/** 评分等级草稿（编辑器本地态，min/max 用字符串承载输入框值） */
export type LevelDraft = { level: string; min: string; max: string; description: string }

/** 评估维度草稿（编辑器本地态） */
export type DimensionDraft = {
  id?: number
  name: string
  type: string
  scoringMethod: string
  weight: string
  editableRoles: PerfRole[]
  jobCategory: string
  conclusionOptions: string
}

export const DIMENSION_TYPES = [
  { value: 'REGULAR', label: '常规评估' },
  { value: 'PROMOTION', label: '晋升评估' },
  { value: 'TEXT', label: '文本反馈' },
  { value: 'METRIC', label: '系统指标' }
]

export const SCORING_METHODS = [
  { value: 'LEVEL', label: '等级' },
  { value: 'SCORE', label: '分值' },
  { value: 'CONCLUSION', label: '结论型' },
  { value: 'TEXT', label: '文本' }
]

export const EDITABLE_ROLES: { value: PerfRole; label: string }[] = [
  { value: 'EMPLOYEE', label: '员工' },
  { value: 'REVIEWER', label: '评审员' },
  { value: 'LEADER', label: '上级' }
]

export const DIMENSION_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  DIMENSION_TYPES.map(item => [item.value, item.label])
)

export const SCORING_METHOD_LABEL: Record<string, string> = Object.fromEntries(
  SCORING_METHODS.map(item => [item.value, item.label])
)

export const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  EDITABLE_ROLES.map(item => [item.value, item.label])
)

/** 新增等级默认值 */
export const EMPTY_LEVEL: LevelDraft = { level: '', min: '', max: '', description: '' }

/** 新增维度默认值：常规评估 + 等级计分 + 评审员/上级填写 */
export const EMPTY_DIMENSION: DimensionDraft = {
  name: '',
  type: 'REGULAR',
  scoringMethod: 'LEVEL',
  weight: '',
  editableRoles: ['REVIEWER', 'LEADER'],
  jobCategory: '',
  conclusionOptions: ''
}

/**
 * 权重按「岗位分组」合计（保存前预校验与界面提示同口径）：
 * 全员通用部分叠加进每个岗位分组，分组合计 = 分组自身 + 全员部分；晋升维度不计权重。
 */
export const summarizeWeights = (dimensions: DimensionDraft[]) => {
  const weighted = dimensions.filter(dim => dim.weight !== '' && dim.type !== 'PROMOTION')

  if (weighted.length === 0) return []

  const groups = new Map<string, number>()

  for (const dim of weighted) {
    const key = dim.jobCategory || '__ALL__'

    groups.set(key, (groups.get(key) ?? 0) + Number(dim.weight))
  }

  const globalSum = groups.get('__ALL__') ?? 0
  const rows: { label: string; total: number; ok: boolean }[] = []

  for (const [key, sum] of groups) {
    if (key === '__ALL__' && groups.size > 1) continue

    // 取整到 3 位小数，避免浮点合计显示 100.00000000000001 之类
    const total = Math.round((key === '__ALL__' ? sum : sum + globalSum) * 1000) / 1000

    rows.push({ label: key === '__ALL__' ? '全员' : key, total, ok: Math.abs(total - 100) <= 0.001 })
  }

  return rows
}
