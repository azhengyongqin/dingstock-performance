import { clampScore, getRatingColor, setBoundary } from '@/components/shared/evaluation-rule-editor/utils'
import type {
  EvaluationRating,
  PerfConfigTemplateRating,
  PerfPerformanceLevel
} from '@/lib/perf-api'

export type ConfigRatingDraft = PerfConfigTemplateRating

/** 按分数升序（左 0 → 右 100），与 EvaluationRuleEditor 色条一致。 */
export const sortRatingsAscending = (ratings: ConfigRatingDraft[]): ConfigRatingDraft[] =>
  [...ratings].sort((a, b) => Number(a.minScore) - Number(b.minScore))

export const toEvaluationLevels = (ratings: ConfigRatingDraft[]): EvaluationRating[] => {
  const sorted = sortRatingsAscending(ratings)

  return sorted.map((item, index) => ({
    symbol: item.symbol,
    name: item.name,
    minScore: Number(item.minScore),
    maxScore: Number(item.maxScore),
    maxInclusive: index === sorted.length - 1,
    remark: item.description ?? undefined
  }))
}

/** 拖边界后写回配置模板 ratings，保留 mappingScore / commentRequired。 */
export const applyBoundary = (
  ratings: ConfigRatingDraft[],
  boundaryIndex: number,
  score: number
): ConfigRatingDraft[] => {
  const sorted = sortRatingsAscending(ratings)
  const levels = toEvaluationLevels(sorted)
  const nextLevels = setBoundary(levels, boundaryIndex, score)

  return nextLevels.map(level => {
    const prev = sorted.find(item => item.symbol === level.symbol)!

    return {
      ...prev,
      minScore: String(level.minScore),
      maxScore: String(level.maxScore)
    }
  })
}

export const patchRatingBySymbol = (
  ratings: ConfigRatingDraft[],
  symbol: PerfPerformanceLevel,
  patch: Partial<ConfigRatingDraft>
): ConfigRatingDraft[] =>
  ratings.map(item => (item.symbol === symbol ? { ...item, ...patch } : item))

export const scoreFromClientX = (clientX: number, rect: DOMRect | undefined) => {
  if (!rect || rect.width <= 0) return 0

  return clampScore(((clientX - rect.left) / rect.width) * 100)
}

export { clampScore, getRatingColor }
