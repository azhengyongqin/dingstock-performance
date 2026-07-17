// 动态评估表单的本地状态与纯校验逻辑：不依赖 React，便于独立单测。
// 后端契约见 backend/src/evaluation/evaluation.dto.ts + evaluation.service-types.ts：
// RATING 项只收 rawLevel，SCORE 项只收 rawScore（0-100 整数），其余类型内容进 value。

import type {
  PerfEvalFormItem,
  PerfEvalFormSubform,
  PerfEvaluationItemAnswer,
  PerfEvaluationItemResult,
  PerfPerformanceLevel
} from '@/lib/perf-api'

/** 单个评估项的本地作答草稿；rawScoreText 保留用户原始输入（含未完成/非法文本），提交前再校验转换 */
export type EvaluationItemAnswer = {
  rawLevel?: PerfPerformanceLevel
  rawScoreText?: string
  value?: unknown
}

export type EvaluationAnswers = Record<string, EvaluationItemAnswer>

const SCORE_PATTERN = /^\d{1,3}$/

/** 附件行：仓库既有附件语义为 JSON 元数据数组（名称 + URL），无二进制上传通道 */
export type AttachmentRow = { name: string; url: string }

const isAttachmentRow = (row: unknown): row is AttachmentRow =>
  typeof row === 'object' && row !== null && 'name' in row && 'url' in row

export const asAttachmentRows = (value: unknown): AttachmentRow[] =>
  Array.isArray(value)
    ? value.filter(isAttachmentRow).map(row => ({ name: String(row.name ?? ''), url: String(row.url ?? '') }))
    : []

/** 剔除全空（name 和 url 都为空白）的附件行；校验与 payload 构建共用此过滤逻辑，避免两处漂移 */
export const nonEmptyAttachmentRows = (value: unknown): AttachmentRow[] =>
  asAttachmentRows(value).filter(row => row.name.trim() || row.url.trim())

export const asStringArray = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : [])

const isValidUrl = (text: string, allowedProtocols?: readonly string[]): boolean => {
  try {
    const url = new URL(text)
    const protocol = url.protocol.replace(':', '')
    const allowed = allowedProtocols && allowedProtocols.length > 0 ? allowedProtocols : ['http', 'https']

    return allowed.includes(protocol)
  } catch {
    return false
  }
}

/** SUBMITTED/DRAFT 明细行 → 本地作答草稿，供表单初始化编辑内容 */
export const toEvaluationAnswers = (items: PerfEvaluationItemResult[]): EvaluationAnswers => {
  const answers: EvaluationAnswers = {}

  for (const item of items) {
    if (item.itemType === 'RATING') {
      answers[item.itemKey] = { rawLevel: item.rawLevel ?? undefined }
    } else if (item.itemType === 'SCORE') {
      // 控件仅接受整数；历史小数草稿回显时四舍五入
      const n = item.rawScore != null ? Number(item.rawScore) : NaN

      answers[item.itemKey] = {
        rawScoreText: Number.isFinite(n) ? String(Math.round(n)) : ''
      }
    } else {
      answers[item.itemKey] = { value: item.value }
    }
  }

  return answers
}

/** 就地校验单个评估项：必填与 config 约束都在此判断，返回中文错误或 null（通过） */
export const validateEvaluationItem = (item: PerfEvalFormItem, answer: EvaluationItemAnswer | undefined): string | null => {
  const config = item.config ?? {}

  if (item.type === 'RATING') {
    if (!answer?.rawLevel) return item.required ? `「${item.title}」为必填项，请选择评级` : null

    return null
  }

  if (item.type === 'SCORE') {
    const text = answer?.rawScoreText?.trim() ?? ''

    if (!text) return item.required ? `「${item.title}」为必填项，请输入分数` : null
    if (!SCORE_PATTERN.test(text)) return `「${item.title}」请输入 0-100 的整数`

    const numeric = Number(text)

    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 100) {
      return `「${item.title}」请输入 0-100 的整数`
    }

    return null
  }

  if (item.type === 'SHORT_TEXT' || item.type === 'LONG_TEXT' || item.type === 'MARKDOWN') {
    const text = typeof answer?.value === 'string' ? answer.value.trim() : ''

    if (!text) return item.required ? `「${item.title}」为必填项` : null
    if (config.minLength && text.length < config.minLength) return `「${item.title}」至少输入 ${config.minLength} 个字符`
    if (config.maxLength && text.length > config.maxLength) return `「${item.title}」最多输入 ${config.maxLength} 个字符`

    return null
  }

  if (item.type === 'SINGLE_SELECT') {
    const value = typeof answer?.value === 'string' ? answer.value : ''

    if (!value) return item.required ? `「${item.title}」为必填项，请选择一项` : null

    return null
  }

  if (item.type === 'MULTI_SELECT') {
    const selected = asStringArray(answer?.value)
    const min = config.minSelections ?? (item.required ? 1 : 0)
    const max = config.maxSelections

    if (selected.length === 0) {
      return min > 0 ? `「${item.title}」至少选择 ${min} 项` : null
    }

    if (min && selected.length < min) return `「${item.title}」至少选择 ${min} 项`
    if (max && selected.length > max) return `「${item.title}」最多选择 ${max} 项`

    return null
  }

  if (item.type === 'ATTACHMENT') {
    const rows = nonEmptyAttachmentRows(answer?.value)

    if (rows.length === 0) return item.required ? `「${item.title}」为必填项，请添加至少一个附件` : null

    for (const row of rows) {
      if (!row.name.trim() || !row.url.trim()) return `「${item.title}」附件需填写名称和链接`
      if (!isValidUrl(row.url)) return `「${item.title}」附件链接格式不正确`
    }

    if (config.maxFiles && rows.length > config.maxFiles) return `「${item.title}」最多添加 ${config.maxFiles} 个附件`

    return null
  }

  if (item.type === 'LINK') {
    const text = typeof answer?.value === 'string' ? answer.value.trim() : ''

    if (!text) return item.required ? `「${item.title}」为必填项，请输入链接` : null
    if (!isValidUrl(text, config.allowedProtocols)) return `「${item.title}」请输入合法的链接地址`

    return null
  }

  return null
}

/** 遍历员工可填全部子表单/维度/评估项，返回 itemKey → 错误信息（无错误项不出现在结果中） */
export const validateEvaluationForm = (
  subforms: PerfEvalFormSubform[],
  answers: EvaluationAnswers
): Record<string, string> => {
  const errors: Record<string, string> = {}

  for (const subform of subforms) {
    for (const dimension of subform.dimensions) {
      for (const item of dimension.items) {
        const error = validateEvaluationItem(item, answers[item.key])

        if (error) errors[item.key] = error
      }
    }
  }

  return errors
}

/** 单个评估项 → API 载荷；未作答或格式不合法（如 SCORE 文本非法）返回 null（草稿场景下跳过而非报错） */
const toPayloadItem = (
  subformKey: string,
  dimensionKey: string,
  item: PerfEvalFormItem,
  answer: EvaluationItemAnswer | undefined
): PerfEvaluationItemAnswer | null => {
  if (item.type === 'RATING') {
    return answer?.rawLevel ? { subformKey, dimensionKey, itemKey: item.key, rawLevel: answer.rawLevel } : null
  }

  if (item.type === 'SCORE') {
    const text = answer?.rawScoreText?.trim()

    if (!text || !SCORE_PATTERN.test(text)) return null

    const numeric = Number(text)

    if (numeric < 0 || numeric > 100) return null

    return { subformKey, dimensionKey, itemKey: item.key, rawScore: numeric }
  }

  if (item.type === 'ATTACHMENT') {
    const rows = nonEmptyAttachmentRows(answer?.value)

    if (rows.length === 0) return null

    return { subformKey, dimensionKey, itemKey: item.key, value: rows }
  }

  const value = answer?.value

  if (value === undefined || value === null) return null
  if (typeof value === 'string' && value.trim() === '') return null
  if (Array.isArray(value) && value.length === 0) return null

  return { subformKey, dimensionKey, itemKey: item.key, value }
}

/** 草稿保存载荷：允许不完整，跳过未作答/格式不合法的项，不做必填拦截 */
export const buildDraftPayloadItems = (
  subforms: PerfEvalFormSubform[],
  answers: EvaluationAnswers
): PerfEvaluationItemAnswer[] => {
  const items: PerfEvaluationItemAnswer[] = []

  for (const subform of subforms) {
    for (const dimension of subform.dimensions) {
      for (const item of dimension.items) {
        const payloadItem = toPayloadItem(subform.key, dimension.key, item, answers[item.key])

        if (payloadItem) items.push(payloadItem)
      }
    }
  }

  return items
}

/** 提交前的就地必填校验：有错误时返回 errors 且 items 为空，调用方据此拦截，不发起请求 */
export const buildSubmitPayload = (
  subforms: PerfEvalFormSubform[],
  answers: EvaluationAnswers
): { errors: Record<string, string>; items: PerfEvaluationItemAnswer[] } => {
  const errors = validateEvaluationForm(subforms, answers)

  if (Object.keys(errors).length > 0) return { errors, items: [] }

  return { errors, items: buildDraftPayloadItems(subforms, answers) }
}
