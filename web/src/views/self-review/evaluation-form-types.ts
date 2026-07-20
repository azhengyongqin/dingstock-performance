// 动态评估表单的本地状态与纯校验逻辑：不依赖 React，便于独立单测。
// 后端契约见 backend/src/evaluation/evaluation.dto.ts + evaluation.service-types.ts：
// 计分维度只收 rawLevel/rawScore，非计分字段内容统一进入 value。

import type {
  PerfConfigTemplateRating,
  PerfEvalFormDimension,
  PerfEvalFormField,
  PerfEvalFormSubform,
  PerfEvaluationDimensionAnswer,
  PerfEvaluationDimensionAnswerInput,
  PerfPerformanceLevel
} from '@/lib/perf-api'

/** 单个维度字段的本地作答草稿；rawScoreText 保留用户原始输入（含未完成/非法文本），提交前再校验转换 */
export type EvaluationItemAnswer = {
  rawLevel?: PerfPerformanceLevel
  rawScoreText?: string
  value?: unknown
}

export type EvaluationAnswers = Record<string, EvaluationItemAnswer>

export type WeightedEvaluationPreview = {
  compositeScore: string
  initialLevel: PerfPerformanceLevel
  finalLevel: PerfPerformanceLevel
}

/** 填写页只消费当前阶段的精确子表单，避免接口异常时跨阶段渲染或提交。 */
export const subformsForStage = (
  subforms: PerfEvalFormSubform[],
  stage: PerfEvalFormSubform['type']
): PerfEvalFormSubform[] => subforms.filter(subform => subform.type === stage)

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

const DECIMAL_SCORE_PATTERN = /^(?:100(?:\.0{1,2})?|\d{1,2}(?:\.\d{1,2})?)$/

/** 将最多两位小数精确转换为整数“分”，避免 79.995 一类边界被二进制浮点误差影响。 */
const toHundredths = (value: string | number): number | null => {
  const matched = String(value)
    .trim()
    .match(/^(\d+)(?:\.(\d{1,2}))?$/)

  if (!matched) return null

  return Number(matched[1]) * 100 + Number((matched[2] ?? '').padEnd(2, '0'))
}

const levelForScoreHundredths = (score: number, ratings: PerfConfigTemplateRating[]): PerfPerformanceLevel | null => {
  for (const rating of ratings) {
    const min = toHundredths(rating.minScore)
    const max = toHundredths(rating.maxScore)

    if (min == null || max == null) return null
    if (score >= min && (score < max || (max === 10_000 && score <= max))) return rating.symbol
  }

  return null
}

const lowerLevel = (current: PerfPerformanceLevel, target: PerfPerformanceLevel): PerfPerformanceLevel => {
  const rank: Record<PerfPerformanceLevel, number> = { S: 4, A: 3, B: 2, C: 1 }

  return rank[current] <= rank[target] ? current : target
}

/**
 * 当前人工评估答卷的实时加权预览。
 * 只在所有计分维度完整且权重合计 100% 时返回，计算顺序与后端统一阶段计算器保持一致。
 */
export const calculateWeightedEvaluationPreview = (
  subforms: PerfEvalFormSubform[],
  answers: EvaluationAnswers,
  ratings: PerfConfigTemplateRating[]
): WeightedEvaluationPreview | null => {
  const dimensions = subforms.flatMap(subform => subform.dimensions.filter(dimension => dimension.type === 'SCORING'))

  if (dimensions.length === 0 || dimensions.filter(dimension => dimension.isCore).length !== 1) return null

  let totalWeight = 0
  let weightedScoreNumerator = 0
  const dimensionLevels = new Map<string, PerfPerformanceLevel>()

  for (const dimension of dimensions) {
    const answer = answers[dimension.key]
    const weight = dimension.weight == null ? null : toHundredths(dimension.weight)
    let score: number | null = null

    if (dimension.scoringMethod === 'RATING' && answer?.rawLevel) {
      const rating = ratings.find(candidate => candidate.symbol === answer.rawLevel)

      score = rating ? toHundredths(rating.mappingScore) : null
    } else if (dimension.scoringMethod === 'SCORE') {
      const rawScore = answer?.rawScoreText?.trim() ?? ''

      score = DECIMAL_SCORE_PATTERN.test(rawScore) ? toHundredths(rawScore) : null
    }

    if (weight == null || weight <= 0 || score == null) return null
    const dimensionLevel = levelForScoreHundredths(score, ratings)

    if (!dimensionLevel) return null
    totalWeight += weight
    weightedScoreNumerator += score * weight
    dimensionLevels.set(dimension.key, dimensionLevel)
  }

  // weight 以百分比的百分之一存储，因此 100% 等于 10_000。
  if (totalWeight !== 10_000) return null

  const compositeScoreHundredths = Math.floor((weightedScoreNumerator + 5_000) / 10_000)
  const initialLevel = levelForScoreHundredths(compositeScoreHundredths, ratings)
  const core = dimensions.find(dimension => dimension.isCore)!
  const coreLevel = dimensionLevels.get(core.key)

  if (!initialLevel || !coreLevel) return null

  let finalLevel = initialLevel

  if (coreLevel === 'C') finalLevel = lowerLevel(finalLevel, 'C')
  if (coreLevel === 'B') finalLevel = lowerLevel(finalLevel, 'B')
  if ([...dimensionLevels.values()].includes('C')) finalLevel = lowerLevel(finalLevel, 'B')

  return {
    compositeScore: `${Math.floor(compositeScoreHundredths / 100)}.${String(compositeScoreHundredths % 100).padStart(2, '0')}`,
    initialLevel,
    finalLevel
  }
}

/** 新版维度/字段回答回填为统一表单本地状态。 */
export const toDimensionEvaluationAnswers = (dimensions: PerfEvaluationDimensionAnswer[]): EvaluationAnswers => {
  const answers: EvaluationAnswers = {}

  for (const dimension of dimensions) {
    answers[dimension.dimensionKey] = {
      rawLevel: dimension.rawLevel ?? undefined,
      rawScoreText: dimension.rawScore ?? undefined
    }
    for (const field of dimension.fields) answers[field.fieldKey] = { value: field.value }
  }

  return answers
}

/** 左闭右开、最高档右闭；分数维度先派生等级再判断条件必填。 */
export const levelForDimensionAnswer = (
  dimension: PerfEvalFormDimension,
  answer: EvaluationItemAnswer | undefined,
  ratings: PerfConfigTemplateRating[]
): PerfPerformanceLevel | null => {
  if (dimension.scoringMethod === 'RATING') return answer?.rawLevel ?? null
  const text = answer?.rawScoreText?.trim() ?? ''

  if (!DECIMAL_SCORE_PATTERN.test(text)) return null
  const score = toHundredths(text)

  return score == null ? null : levelForScoreHundredths(score, ratings)
}

const dimensionFieldRequired = (
  field: PerfEvalFormField,
  level: PerfPerformanceLevel | null
): boolean =>
  field.requiredRule === 'ALWAYS' ||
  (field.requiredRule === 'CONDITIONAL' && level != null && (field.requiredLevels ?? []).includes(level))

const validateDimensionField = (
  field: PerfEvalFormField,
  answer: EvaluationItemAnswer | undefined,
  required: boolean
): string | null => {
  const config = field.config ?? {}

  if (field.type === 'SHORT_TEXT' || field.type === 'LONG_TEXT' || field.type === 'MARKDOWN') {
    const text = typeof answer?.value === 'string' ? answer.value.trim() : ''

    if (!text) return required ? `「${field.title}」为必填项` : null
    if (config.minLength && text.length < config.minLength) return `「${field.title}」至少输入 ${config.minLength} 个字符`
    if (config.maxLength && text.length > config.maxLength) return `「${field.title}」最多输入 ${config.maxLength} 个字符`

    return null
  }

  if (field.type === 'SINGLE_SELECT') {
    const value = typeof answer?.value === 'string' ? answer.value : ''

    return !value && required ? `「${field.title}」为必填项，请选择一项` : null
  }

  if (field.type === 'MULTI_SELECT') {
    const selected = asStringArray(answer?.value)
    const min = config.minSelections ?? (required ? 1 : 0)

    if (selected.length < min) return `「${field.title}」至少选择 ${min} 项`
    if (config.maxSelections && selected.length > config.maxSelections) return `「${field.title}」最多选择 ${config.maxSelections} 项`

    return null
  }

  if (field.type === 'ATTACHMENT') {
    const rows = nonEmptyAttachmentRows(answer?.value)

    if (rows.length === 0) return required ? `「${field.title}」为必填项，请添加至少一个附件` : null

    for (const row of rows) {
      if (!row.name.trim() || !row.url.trim()) return `「${field.title}」附件需填写名称和链接`
      if (!isValidUrl(row.url)) return `「${field.title}」附件链接格式不正确`
    }

    if (config.maxFiles && rows.length > config.maxFiles) return `「${field.title}」最多添加 ${config.maxFiles} 个附件`

    return null
  }

  const text = typeof answer?.value === 'string' ? answer.value.trim() : ''

  if (!text) return required ? `「${field.title}」为必填项，请输入链接` : null
  if (!isValidUrl(text, config.allowedProtocols)) return `「${field.title}」请输入合法的链接地址`

  return null
}

/** 新版 SELF 正式提交前校验：计分维度固定必填，字段按自身规则校验。 */
export const validateDimensionEvaluationForm = (
  subforms: PerfEvalFormSubform[],
  answers: EvaluationAnswers,
  ratings: PerfConfigTemplateRating[]
): Record<string, string> => {
  const errors: Record<string, string> = {}

  for (const subform of subforms) {
    for (const dimension of subform.dimensions) {
      const dimensionAnswer = answers[dimension.key]
      const level = levelForDimensionAnswer(dimension, dimensionAnswer, ratings)

      if (dimension.type === 'SCORING') {
        if (dimension.scoringMethod === 'RATING' && !dimensionAnswer?.rawLevel) {
          errors[dimension.key] = `计分维度「${dimension.name}」请选择评级`
        } else if (dimension.scoringMethod === 'SCORE') {
          const text = dimensionAnswer?.rawScoreText?.trim() ?? ''

          if (!text) errors[dimension.key] = `计分维度「${dimension.name}」请输入分数`
          else if (!DECIMAL_SCORE_PATTERN.test(text)) errors[dimension.key] = `计分维度「${dimension.name}」请输入 0-100、最多两位小数的分数`
        }
      }

      for (const field of dimension.fields ?? []) {
        const error = validateDimensionField(field, answers[field.key], dimensionFieldRequired(field, level))

        if (error) errors[field.key] = error
      }
    }
  }

  return errors
}

const dimensionFieldPayload = (field: PerfEvalFormField, answer: EvaluationItemAnswer | undefined) => {
  if (field.type === 'ATTACHMENT') {
    const value = nonEmptyAttachmentRows(answer?.value)

    return value.length > 0 ? { fieldKey: field.key, value } : null
  }

  const value = answer?.value

  if (value === undefined || value === null) return null
  if (typeof value === 'string' && value.trim() === '') return null
  if (Array.isArray(value) && value.length === 0) return null

  return { fieldKey: field.key, value }
}

/** 新版 SELF 草稿载荷：缺计分输入合法；无任何真实输入的说明维度不生成空回答。 */
export const buildDraftPayloadDimensions = (
  subforms: PerfEvalFormSubform[],
  answers: EvaluationAnswers
): PerfEvaluationDimensionAnswerInput[] => {
  const dimensions: PerfEvaluationDimensionAnswerInput[] = []

  for (const subform of subforms) {
    for (const dimension of subform.dimensions) {
      const answer = answers[dimension.key]

      const fields = (dimension.fields ?? []).flatMap(field => {
        const payload = dimensionFieldPayload(field, answers[field.key])

        return payload ? [payload] : []
      })

      const rawLevel = dimension.scoringMethod === 'RATING' ? answer?.rawLevel : undefined
      const scoreText = dimension.scoringMethod === 'SCORE' ? answer?.rawScoreText?.trim() : undefined
      const rawScore = scoreText && DECIMAL_SCORE_PATTERN.test(scoreText) ? Number(scoreText) : undefined

      if (rawLevel === undefined && rawScore === undefined && fields.length === 0) continue
      dimensions.push({ subformKey: subform.key, dimensionKey: dimension.key, rawLevel, rawScore, fields })
    }
  }

  return dimensions
}

export const buildDimensionSubmitPayload = (
  subforms: PerfEvalFormSubform[],
  answers: EvaluationAnswers,
  ratings: PerfConfigTemplateRating[]
): { errors: Record<string, string>; dimensions: PerfEvaluationDimensionAnswerInput[] } => {
  const errors = validateDimensionEvaluationForm(subforms, answers, ratings)

  return {
    errors,
    dimensions: Object.keys(errors).length > 0 ? [] : buildDraftPayloadDimensions(subforms, answers)
  }
}
