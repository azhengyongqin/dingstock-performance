import Decimal from 'decimal.js';

export type DecimalInput = string | number;
export type StageResultMode = 'WEIGHTED_RATING' | 'WEIGHTED_SCORE';
export type PerformanceLevel = 'S' | 'A' | 'B' | 'C';
export type StageRelationType =
  'DIRECT' | 'LEADER' | 'ORG_OWNER' | 'PROJECT_OWNER' | 'PEER' | 'CROSS_DEPT';

export type StageCalculationErrorCode =
  | 'INVALID_SCORE_PRECISION'
  | 'INVALID_SCORE'
  | 'INVALID_RATING_SCALE'
  | 'INVALID_RATING_INPUT'
  | 'INVALID_CONSTRAINT_RULE'
  | 'INVALID_STAGE_STRUCTURE';

export class StageCalculationError extends Error {
  constructor(
    readonly code: StageCalculationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StageCalculationError';
  }
}

export type RatingScaleEntry = {
  symbol: PerformanceLevel;
  minScore: DecimalInput;
  maxScore: DecimalInput;
  mappingScore: DecimalInput;
};

export type StageItemInput = {
  itemId: string;
  submissionId: string;
  rawValue: DecimalInput;
};

export type StageRelationInput = {
  type: StageRelationType;
  /** 当前有效关系的基础权重；引擎会按有效关系集合重新归一化。 */
  weight: DecimalInput;
  items: StageItemInput[];
};

export type StageDimensionInput = {
  id: string;
  name: string;
  weight: DecimalInput;
  isCore: boolean;
  relations: StageRelationInput[];
};

export type RatingConstraintRule = {
  id: string;
  type: 'CORE_RATING_FORCE' | 'CORE_RATING_CAP' | 'ANY_RATING_CAP';
  triggerRating: PerformanceLevel;
  targetLevel: PerformanceLevel;
};

export type ScoreConstraintRule = {
  id: string;
  type: 'CORE_SCORE_FORCE' | 'CORE_SCORE_CAP' | 'ANY_SCORE_CAP';
  threshold: DecimalInput;
  targetLevel: PerformanceLevel;
};

export type StageConstraintRule = RatingConstraintRule | ScoreConstraintRule;

export type ConfirmedRedLine = {
  findingId: string;
  category: string;
  reason: string;
};

export type MatchedConstraint = {
  id: string;
  type: StageConstraintRule['type'] | 'CONFIRMED_RED_LINE';
  dimensionIds: string[];
  parameters: {
    triggerRating?: PerformanceLevel;
    threshold?: string;
    category?: string;
    reason?: string;
    targetLevel: PerformanceLevel;
  };
  beforeLevel: PerformanceLevel;
  afterLevel: PerformanceLevel;
  changed: boolean;
};

export type StageResultInput = {
  mode: StageResultMode;
  ratings: RatingScaleEntry[];
  dimensions: StageDimensionInput[];
  constraints: StageConstraintRule[];
  confirmedRedLine: ConfirmedRedLine | null;
};

export type StageItemResult = StageItemInput & {
  rawValue: string;
  calculationScore: string;
  ratingMapping?: {
    symbol: PerformanceLevel;
    minScore: string;
    maxScore: string;
    mappingScore: string;
  };
};

export type StageRelationResult = {
  type: StageRelationType;
  baseWeight: string;
  effectiveWeight: string;
  score: string;
  items: StageItemResult[];
};

export type StageDimensionResult = {
  id: string;
  name: string;
  weight: string;
  isCore: boolean;
  score: string;
  level: PerformanceLevel;
  relations: StageRelationResult[];
};

export type StageResult = {
  mode: StageResultMode;
  unroundedCompositeScore: string;
  compositeScore: string;
  initialLevel: PerformanceLevel;
  finalLevel: PerformanceLevel;
  matchedConstraints: MatchedConstraint[];
  dimensions: StageDimensionResult[];
};

// 统一使用高精度十进制，并且只在阶段综合分出口执行四舍五入。
const ExactDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});

/**
 * 计算加权阶段结果的公开契约。
 *
 * 当前独立于 Nest 与数据库，后续 SELF、PEER、MANAGER 可共享同一套计算语义。
 */
export function calculateStageResult(input: StageResultInput): StageResult {
  validateRatingScale(input.ratings);
  validateStageStructure(input.dimensions);
  validateConstraintRules(input.mode, input.constraints);
  const ratingMap = new Map(
    input.ratings.map((rating) => [rating.symbol, rating]),
  );

  const dimensions = input.dimensions.map((dimension) => {
    const relations = dimension.relations.map((relation) => {
      const items = relation.items.map((item) => {
        const rawValue = String(item.rawValue);
        const calculation: {
          score: Decimal;
          ratingMapping?: NonNullable<StageItemResult['ratingMapping']>;
        } =
          input.mode === 'WEIGHTED_RATING'
            ? ratingScoreOf(rawValue, ratingMap)
            : { score: scoreOf(rawValue) };

        return {
          ...item,
          rawValue,
          calculationScore: calculation.score.toString(),
          ...(calculation.ratingMapping
            ? { ratingMapping: calculation.ratingMapping }
            : {}),
        };
      });
      const score = items
        .reduce(
          (total, item) => total.plus(item.calculationScore),
          new ExactDecimal(0),
        )
        .dividedBy(items.length);

      return {
        type: relation.type,
        baseWeight: new ExactDecimal(relation.weight).toString(),
        score: score.toString(),
        items,
      };
    });
    const activeBaseWeightTotal = relations.reduce(
      (total, relation) => total.plus(relation.baseWeight),
      new ExactDecimal(0),
    );
    const normalizedRelations = relations.map((relation) => ({
      ...relation,
      effectiveWeight: new ExactDecimal(relation.baseWeight)
        .times(100)
        .dividedBy(activeBaseWeightTotal)
        .toString(),
    }));
    // 直接用基础权重占有效权重总和的比例计算，避免先展示舍入再参与运算。
    const weightedScoreTotal = normalizedRelations.reduce(
      (total, relation) =>
        total.plus(new ExactDecimal(relation.score).times(relation.baseWeight)),
      new ExactDecimal(0),
    );
    const score = weightedScoreTotal.dividedBy(activeBaseWeightTotal);

    return {
      id: dimension.id,
      name: dimension.name,
      weight: new ExactDecimal(dimension.weight).toString(),
      isCore: dimension.isCore,
      score: score.toString(),
      level: levelForScore(score, input.ratings),
      relations: normalizedRelations,
    };
  });
  const unroundedCompositeScore = dimensions.reduce(
    (total, dimension) =>
      total.plus(
        new ExactDecimal(dimension.score)
          .times(dimension.weight)
          .dividedBy(100),
      ),
    new ExactDecimal(0),
  );
  const compositeScore = unroundedCompositeScore.toDecimalPlaces(
    2,
    ExactDecimal.ROUND_HALF_UP,
  );
  const initialLevel = levelForScore(compositeScore, input.ratings);
  const constraintResult = applyConstraints(
    input.mode,
    initialLevel,
    dimensions,
    input.constraints,
  );
  const finalResult = applyConfirmedRedLine(
    constraintResult,
    input.confirmedRedLine,
  );

  return {
    mode: input.mode,
    unroundedCompositeScore: unroundedCompositeScore.toString(),
    compositeScore: compositeScore.toFixed(2),
    initialLevel,
    finalLevel: finalResult.finalLevel,
    matchedConstraints: finalResult.matchedConstraints,
    dimensions,
  };
}

/**
 * 按阶段计算器的同一套精度与区间边界，把原始分数映射为绩效等级。
 * 展示层统计也必须复用此入口，避免与权威阶段结果产生边界漂移。
 */
export function mapScoreToPerformanceLevel(
  rawScore: DecimalInput,
  ratings: RatingScaleEntry[],
): PerformanceLevel {
  validateRatingScale(ratings);
  return levelForScore(scoreOf(String(rawScore)), ratings);
}

function ratingScoreOf(
  rawValue: string,
  ratingMap: Map<PerformanceLevel, RatingScaleEntry>,
): {
  score: Decimal;
  ratingMapping: NonNullable<StageItemResult['ratingMapping']>;
} {
  const rating = ratingMap.get(rawValue as PerformanceLevel);
  if (!rating) {
    throw new StageCalculationError(
      'INVALID_RATING_INPUT',
      `原始评级 ${rawValue} 不在当前评级表中`,
    );
  }
  const mappingScore = new ExactDecimal(rating.mappingScore);
  return {
    score: mappingScore,
    ratingMapping: {
      symbol: rating.symbol,
      minScore: new ExactDecimal(rating.minScore).toString(),
      maxScore: new ExactDecimal(rating.maxScore).toString(),
      mappingScore: mappingScore.toString(),
    },
  };
}

function validateStageStructure(dimensions: StageDimensionInput[]): void {
  const supportedRelations = new Set<StageRelationType>([
    'DIRECT',
    'LEADER',
    'ORG_OWNER',
    'PROJECT_OWNER',
    'PEER',
    'CROSS_DEPT',
  ]);
  if (dimensions.filter((dimension) => dimension.isCore).length !== 1) {
    throw new StageCalculationError(
      'INVALID_STAGE_STRUCTURE',
      '加权阶段必须且只能有一个核心维度',
    );
  }

  const dimensionWeightTotal = dimensions.reduce(
    (total, dimension) =>
      total.plus(validatedWeight(dimension.weight, `维度 ${dimension.name}`)),
    new ExactDecimal(0),
  );
  if (!dimensionWeightTotal.equals(100)) {
    throw new StageCalculationError(
      'INVALID_STAGE_STRUCTURE',
      '维度权重必须精确合计 100%',
    );
  }

  for (const dimension of dimensions) {
    if (dimension.relations.length === 0) {
      throw new StageCalculationError(
        'INVALID_STAGE_STRUCTURE',
        `维度 ${dimension.name} 必须至少包含一个有效关系`,
      );
    }
    const relationTypes = new Set<StageRelationType>();
    for (const relation of dimension.relations) {
      if (
        !supportedRelations.has(relation.type) ||
        relationTypes.has(relation.type)
      ) {
        throw new StageCalculationError(
          'INVALID_STAGE_STRUCTURE',
          `维度 ${dimension.name} 的关系类型必须受控且不能重复`,
        );
      }
      relationTypes.add(relation.type);
      validatedWeight(
        relation.weight,
        `维度 ${dimension.name} 的关系 ${relation.type}`,
      );
    }
    if (dimension.relations.some((relation) => relation.items.length === 0)) {
      throw new StageCalculationError(
        'INVALID_STAGE_STRUCTURE',
        `维度 ${dimension.name} 的有效关系必须至少包含一个评估项结果`,
      );
    }
  }
}

function validatedWeight(value: DecimalInput, owner: string): Decimal {
  const weight = new ExactDecimal(value);
  if (
    weight.decimalPlaces() > 2 ||
    !weight.greaterThan(0) ||
    weight.greaterThan(100)
  ) {
    throw new StageCalculationError(
      'INVALID_STAGE_STRUCTURE',
      `${owner}权重必须大于 0%、不超过 100%，且最多保留两位小数`,
    );
  }
  return weight;
}

function validateConstraintRules(
  mode: StageResultMode,
  constraints: StageConstraintRule[],
): void {
  const supportedByMode: Record<StageResultMode, Set<string>> = {
    WEIGHTED_RATING: new Set([
      'CORE_RATING_FORCE',
      'CORE_RATING_CAP',
      'ANY_RATING_CAP',
    ]),
    WEIGHTED_SCORE: new Set([
      'CORE_SCORE_FORCE',
      'CORE_SCORE_CAP',
      'ANY_SCORE_CAP',
    ]),
  };
  const knownLevels = new Set<unknown>(['S', 'A', 'B', 'C']);
  const ids = new Set<string>();

  for (const constraint of constraints) {
    const type = String(constraint.type);
    if (!supportedByMode[mode].has(type)) {
      throw new StageCalculationError(
        'INVALID_CONSTRAINT_RULE',
        `不支持约束类型 ${type}`,
      );
    }
    if (!constraint.id || ids.has(constraint.id)) {
      throw new StageCalculationError(
        'INVALID_CONSTRAINT_RULE',
        '约束 id 必须非空且不能重复',
      );
    }
    ids.add(constraint.id);
    if (!knownLevels.has(constraint.targetLevel)) {
      throw new StageCalculationError(
        'INVALID_CONSTRAINT_RULE',
        `约束 ${constraint.id} 的目标等级必须是 S、A、B、C`,
      );
    }

    if ('triggerRating' in constraint) {
      if (!knownLevels.has(constraint.triggerRating)) {
        throw new StageCalculationError(
          'INVALID_CONSTRAINT_RULE',
          `约束 ${constraint.id} 的触发评级必须是 S、A、B、C`,
        );
      }
      continue;
    }

    let threshold: Decimal;
    try {
      threshold = new ExactDecimal(constraint.threshold);
    } catch {
      throw invalidConstraintThreshold(constraint.id);
    }
    if (
      threshold.lessThan(0) ||
      threshold.greaterThan(100) ||
      threshold.decimalPlaces() > 2
    ) {
      throw invalidConstraintThreshold(constraint.id);
    }
  }
}

function invalidConstraintThreshold(id: string): StageCalculationError {
  return new StageCalculationError(
    'INVALID_CONSTRAINT_RULE',
    `约束 ${id} 的阈值必须在 0～100 之间且最多保留两位小数`,
  );
}

function applyConfirmedRedLine(
  result: {
    finalLevel: PerformanceLevel;
    matchedConstraints: MatchedConstraint[];
  },
  confirmedRedLine: ConfirmedRedLine | null,
): {
  finalLevel: PerformanceLevel;
  matchedConstraints: MatchedConstraint[];
} {
  if (!confirmedRedLine) return result;

  const beforeLevel = result.finalLevel;
  return {
    finalLevel: 'C',
    matchedConstraints: [
      ...result.matchedConstraints,
      {
        id: confirmedRedLine.findingId,
        type: 'CONFIRMED_RED_LINE',
        dimensionIds: [],
        parameters: {
          category: confirmedRedLine.category,
          reason: confirmedRedLine.reason,
          targetLevel: 'C',
        },
        beforeLevel,
        afterLevel: 'C',
        changed: beforeLevel !== 'C',
      },
    ],
  };
}

function applyConstraints(
  mode: StageResultMode,
  initialLevel: PerformanceLevel,
  dimensions: StageDimensionResult[],
  constraints: StageConstraintRule[],
): {
  finalLevel: PerformanceLevel;
  matchedConstraints: MatchedConstraint[];
} {
  let finalLevel = initialLevel;
  const matchedConstraints: MatchedConstraint[] = [];

  for (const constraint of constraints) {
    const isRatingConstraint = 'triggerRating' in constraint;
    if (
      (mode === 'WEIGHTED_RATING' && !isRatingConstraint) ||
      (mode === 'WEIGHTED_SCORE' && isRatingConstraint)
    ) {
      continue;
    }
    const candidates = constraint.type.startsWith('CORE_')
      ? dimensions.filter((dimension) => dimension.isCore)
      : dimensions;
    const matchedDimensions = isRatingConstraint
      ? candidates.filter(
          (dimension) => dimension.level === constraint.triggerRating,
        )
      : candidates.filter((dimension) =>
          new ExactDecimal(dimension.score).lessThan(constraint.threshold),
        );
    if (matchedDimensions.length === 0) continue;

    const beforeLevel = finalLevel;
    // 等级约束只能收紧结果，不能把原本更低的等级向上抬升。
    finalLevel = lowerLevel(finalLevel, constraint.targetLevel);
    matchedConstraints.push({
      id: constraint.id,
      type: constraint.type,
      dimensionIds: matchedDimensions.map((dimension) => dimension.id),
      parameters: isRatingConstraint
        ? {
            triggerRating: constraint.triggerRating,
            targetLevel: constraint.targetLevel,
          }
        : {
            threshold: new ExactDecimal(constraint.threshold).toString(),
            targetLevel: constraint.targetLevel,
          },
      beforeLevel,
      afterLevel: finalLevel,
      changed: beforeLevel !== finalLevel,
    });
  }

  return { finalLevel, matchedConstraints };
}

function lowerLevel(
  current: PerformanceLevel,
  target: PerformanceLevel,
): PerformanceLevel {
  const rank: Record<PerformanceLevel, number> = { S: 4, A: 3, B: 2, C: 1 };
  return rank[current] <= rank[target] ? current : target;
}

function validateRatingScale(ratings: RatingScaleEntry[]): void {
  const symbols = new Set(ratings.map((rating) => rating.symbol));
  if (
    ratings.length !== 4 ||
    !(['S', 'A', 'B', 'C'] as const).every((symbol) => symbols.has(symbol))
  ) {
    throw new StageCalculationError(
      'INVALID_RATING_SCALE',
      '评级表必须且只能包含 S、A、B、C',
    );
  }

  const normalized = ratings.map((rating) => ({
    rating,
    min: new ExactDecimal(rating.minScore),
    max: new ExactDecimal(rating.maxScore),
    mappingScore: new ExactDecimal(rating.mappingScore),
  }));
  for (const { rating, min, max, mappingScore } of normalized) {
    if ([min, max, mappingScore].some((value) => value.decimalPlaces() > 2)) {
      throw new StageCalculationError(
        'INVALID_RATING_SCALE',
        `评级 ${rating.symbol} 的配置数值最多保留两位小数`,
      );
    }
    if (min.lessThan(0) || max.greaterThan(100) || !min.lessThan(max)) {
      throw new StageCalculationError(
        'INVALID_RATING_SCALE',
        '评级区间必须连续覆盖 0～100',
      );
    }
    const belongsToRange =
      mappingScore.greaterThanOrEqualTo(min) &&
      (mappingScore.lessThan(max) ||
        (max.equals(100) && mappingScore.lessThanOrEqualTo(max)));

    if (!belongsToRange) {
      throw new StageCalculationError(
        'INVALID_RATING_SCALE',
        `评级 ${rating.symbol} 的映射分必须落在自身分数区间内`,
      );
    }
  }

  const sorted = normalized.sort((left, right) =>
    left.min.comparedTo(right.min),
  );
  const rangeOrder = sorted.map(({ rating }) => rating.symbol).join(',');
  const isContinuous = sorted.every((current, index) => {
    const next = sorted[index + 1];
    return !next || current.max.equals(next.min);
  });
  if (
    rangeOrder !== 'C,B,A,S' ||
    !sorted[0].min.equals(0) ||
    !sorted[3].max.equals(100) ||
    !isContinuous
  ) {
    throw new StageCalculationError(
      'INVALID_RATING_SCALE',
      '评级区间必须按 C、B、A、S 连续覆盖 0～100',
    );
  }
}

function scoreOf(rawValue: string): Decimal {
  const score = new ExactDecimal(rawValue);
  if (score.lessThan(0) || score.greaterThan(100)) {
    throw new StageCalculationError('INVALID_SCORE', '评分必须在 0～100 之间');
  }
  if (score.decimalPlaces() > 2) {
    throw new StageCalculationError(
      'INVALID_SCORE_PRECISION',
      '评分必须最多保留两位小数',
    );
  }
  return score;
}

function levelForScore(
  score: Decimal,
  ratings: RatingScaleEntry[],
): PerformanceLevel {
  const rating = ratings.find((candidate) => {
    const min = new ExactDecimal(candidate.minScore);
    const max = new ExactDecimal(candidate.maxScore);
    return (
      score.greaterThanOrEqualTo(min) &&
      (score.lessThan(max) || (max.equals(100) && score.lessThanOrEqualTo(max)))
    );
  });

  if (!rating) {
    throw new Error(`分数 ${score.toString()} 未匹配任何评级区间`);
  }
  return rating.symbol;
}
