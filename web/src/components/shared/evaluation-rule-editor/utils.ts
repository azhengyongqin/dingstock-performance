import type { EvaluationRating } from '@/lib/perf-api'

export const DEFAULT_EVALUATION_RATINGS: EvaluationRating[] = [
  {
    symbol: 'C',
    name: '不符预期',
    minScore: 0,
    maxScore: 60,
    remark:
      '绩效目标完成情况、工作态度、价值观等不符合预期，需进行绩效改进；绩效改进不合格者，则进行绩效淘汰'
  },
  {
    symbol: 'B',
    name: '良好',
    minScore: 60,
    maxScore: 80,
    remark: '绩效目标完成情况符合预期，但仍需持续改进和提升'
  },
  {
    symbol: 'A',
    name: '优秀',
    minScore: 80,
    maxScore: 90,
    remark: '绩效目标完成情况优秀，和公司价值观统一，整体超出预期'
  },
  {
    symbol: 'S',
    name: '卓越',
    minScore: 90,
    maxScore: 100,
    maxInclusive: true,
    remark: '工作结果、成长速度等方面有重大突破和创新，价值观表现等可作团队标杆'
  }
]

export const createEmptyRating = (): EvaluationRating => ({
  symbol: '',
  name: '',
  minScore: 0,
  maxScore: 100,
  remark: ''
})

/** 将分数夹到 0–100 的整数。 */
export const clampScore = (value: number): number => {
  if (!Number.isFinite(value)) return 0

  return Math.min(100, Math.max(0, Math.round(value)))
}

/**
 * 连续区间模型：只编辑相邻两档之间的「边界」。
 * 设置第 i 档与第 i+1 档之间的边界分数，同时更新 levels[i].maxScore 与 levels[i+1].minScore，
 * 并夹在相邻两值之间（不允许区间塌陷）。这样连续性从结构上成立，无需事后校验区间是否衔接。
 */
export const setBoundary = (levels: EvaluationRating[], i: number, value: number): EvaluationRating[] => {
  if (i < 0 || i >= levels.length - 1) return levels

  const lower = levels[i].minScore + 1
  const upper = levels[i + 1].maxScore - 1
  const clamped = Math.min(upper, Math.max(lower, clampScore(value)))

  return levels.map((item, idx) => {
    if (idx === i) return { ...item, maxScore: clamped }
    if (idx === i + 1) return { ...item, minScore: clamped }

    return item
  })
}

/** 在最高档内部一分为二，新增一个空白等级（对应「添加分数子区间」）。 */
export const addInterval = (levels: EvaluationRating[]): EvaluationRating[] => {
  if (levels.length === 0) return [createEmptyRating()]

  const last = levels[levels.length - 1]
  const mid = Math.round((last.minScore + last.maxScore) / 2)

  if (mid <= last.minScore || mid >= last.maxScore) return levels // 区间太窄，无法再切

  return [
    ...levels.slice(0, -1),
    { ...last, maxScore: mid },
    { symbol: '', name: '', minScore: mid, maxScore: last.maxScore, remark: '' }
  ]
}

/** 删除某档，其分数区间并入相邻档（首档并入下一档，其余并入上一档），保持连续。 */
export const removeInterval = (levels: EvaluationRating[], i: number): EvaluationRating[] => {
  if (levels.length <= 1) return levels

  const removed = levels[i]
  const next = levels.map(item => ({ ...item }))

  if (i === 0) {
    next[1].minScore = removed.minScore
  } else {
    next[i - 1].maxScore = removed.maxScore
  }

  return next.filter((_, idx) => idx !== i)
}

export const findRatingByScore = (levels: EvaluationRating[], score: number): EvaluationRating | null => {
  const normalized = [...levels]
    .map(level => ({ ...level, minScore: Number(level.minScore), maxScore: Number(level.maxScore) }))
    .sort((left, right) => left.minScore - right.minScore)

  return (
    normalized.find(item => {
      const aboveMin = score >= item.minScore
      const isHighest = item === normalized.at(-1)
      const belowMax = isHighest ? score <= item.maxScore : score < item.maxScore

      return aboveMin && belowMax
    }) ?? null
  )
}

export const getRatingColor = (rating: Pick<EvaluationRating, 'minScore' | 'maxScore'>) => {
  const mid = (Number(rating.minScore) + Number(rating.maxScore)) / 2

  if (mid >= 90) return { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-200' }
  if (mid >= 80) return { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200' }
  if (mid >= 60) return { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' }

  return { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200' }
}
