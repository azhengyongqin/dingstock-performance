import Decimal from 'decimal.js';
import {
  calculateStageResult,
  StageCalculationError,
  type ConfirmedRedLine,
  type DecimalInput,
  type PerformanceLevel,
  type RatingScaleEntry,
  type StageDimensionResult,
  type StageRelationType,
} from './stage-result-calculator';

export type UnifiedScoringMethod = 'RATING' | 'SCORE';

export type UnifiedStageItemInput = {
  submissionId: string;
  rawLevel?: PerformanceLevel;
  rawScore?: DecimalInput;
};

export type UnifiedStageRelationInput = {
  type: StageRelationType;
  weight: DecimalInput;
  items: UnifiedStageItemInput[];
};

export type UnifiedStageDimensionInput = {
  id: string;
  name: string;
  scoringMethod: UnifiedScoringMethod;
  weight: DecimalInput;
  isCore: boolean;
  relations: UnifiedStageRelationInput[];
};

export type UnifiedMatchedConstraint = {
  id: string;
  type: 'CORE_C_FORCE' | 'CORE_B_CAP' | 'ANY_C_CAP' | 'CONFIRMED_RED_LINE';
  dimensionIds: string[];
  parameters: {
    category?: string;
    reason?: string;
    targetLevel: PerformanceLevel;
  };
  beforeLevel: PerformanceLevel;
  afterLevel: PerformanceLevel;
  changed: boolean;
};

export type UnifiedStageDimensionResult = Omit<
  StageDimensionResult,
  'relations'
> & {
  scoringMethod: UnifiedScoringMethod;
  relations: Array<
    Omit<StageDimensionResult['relations'][number], 'items'> & {
      items: Array<{
        submissionId: string;
        rawLevel?: PerformanceLevel;
        rawScore?: string;
        calculationScore: string;
        ratingMapping?: {
          symbol: PerformanceLevel;
          minScore: string;
          maxScore: string;
          mappingScore: string;
        };
      }>;
    }
  >;
};

export type UnifiedStageResultInput = {
  ratings: RatingScaleEntry[];
  dimensions: UnifiedStageDimensionInput[];
  confirmedRedLine: ConfirmedRedLine | null;
};

export type UnifiedStageResult = {
  unroundedCompositeScore: string;
  compositeScore: string;
  initialLevel: PerformanceLevel;
  finalLevel: PerformanceLevel;
  matchedConstraints: UnifiedMatchedConstraint[];
  dimensions: UnifiedStageDimensionResult[];
};

const ExactDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});

/**
 * 三类人工评估共用的公开计算入口。
 *
 * 每个维度自行声明评级或分数输入；先在关系内平均、再按有效关系权重归一化，
 * 最后按维度占比汇总。约束固定使用派生后的维度等级，不接受管理员自定义档位。
 */
export function calculateUnifiedStageResult(
  input: UnifiedStageResultInput,
): UnifiedStageResult {
  validateDimensionWeights(input.dimensions);

  const dimensions = input.dimensions.map((dimension) => {
    const mode =
      dimension.scoringMethod === 'RATING'
        ? ('WEIGHTED_RATING' as const)
        : ('WEIGHTED_SCORE' as const);
    const result = calculateStageResult({
      mode,
      ratings: input.ratings,
      dimensions: [
        {
          id: dimension.id,
          name: dimension.name,
          weight: '100',
          isCore: true,
          relations: dimension.relations.map((relation) => ({
            type: relation.type,
            weight: relation.weight,
            items: relation.items.map((item, index) => ({
              itemId: `${dimension.id}:${index}`,
              submissionId: item.submissionId,
              rawValue: rawValueOf(dimension.scoringMethod, item),
            })),
          })),
        },
      ],
      constraints: [],
      confirmedRedLine: null,
    });
    const calculated = result.dimensions[0];

    return {
      ...calculated,
      weight: new ExactDecimal(dimension.weight).toString(),
      isCore: dimension.isCore,
      scoringMethod: dimension.scoringMethod,
      relations: calculated.relations.map((relation) => ({
        ...relation,
        items: relation.items.map((item) => ({
          submissionId: item.submissionId,
          calculationScore: item.calculationScore,
          ...(item.ratingMapping ? { ratingMapping: item.ratingMapping } : {}),
          ...(dimension.scoringMethod === 'RATING'
            ? { rawLevel: item.rawValue as PerformanceLevel }
            : { rawScore: item.rawValue }),
        })),
      })),
    } satisfies UnifiedStageDimensionResult;
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
  const constrained = applyUnifiedConstraints(initialLevel, dimensions);
  const finalResult = applyConfirmedRedLine(
    constrained.finalLevel,
    constrained.matchedConstraints,
    input.confirmedRedLine,
  );

  return {
    unroundedCompositeScore: unroundedCompositeScore.toString(),
    compositeScore: compositeScore.toFixed(2),
    initialLevel,
    finalLevel: finalResult.finalLevel,
    matchedConstraints: finalResult.matchedConstraints,
    dimensions,
  };
}

function rawValueOf(
  scoringMethod: UnifiedScoringMethod,
  item: UnifiedStageItemInput,
): DecimalInput {
  if (
    scoringMethod === 'RATING' &&
    item.rawLevel &&
    item.rawScore === undefined
  ) {
    return item.rawLevel;
  }
  if (
    scoringMethod === 'SCORE' &&
    item.rawScore !== undefined &&
    item.rawLevel === undefined
  ) {
    return item.rawScore;
  }
  throw new StageCalculationError(
    scoringMethod === 'RATING' ? 'INVALID_RATING_INPUT' : 'INVALID_SCORE',
    scoringMethod === 'RATING'
      ? '评级维度必须且只能提供原始评级'
      : '分数维度必须且只能提供原始分数',
  );
}

function validateDimensionWeights(dimensions: UnifiedStageDimensionInput[]) {
  if (dimensions.filter((dimension) => dimension.isCore).length !== 1) {
    throw new StageCalculationError(
      'INVALID_STAGE_STRUCTURE',
      '人工评估必须且只能有一个核心计分维度',
    );
  }
  const total = dimensions.reduce((sum, dimension) => {
    const weight = new ExactDecimal(dimension.weight);
    if (
      weight.decimalPlaces() > 2 ||
      !weight.greaterThan(0) ||
      weight.greaterThan(100)
    ) {
      throw new StageCalculationError(
        'INVALID_STAGE_STRUCTURE',
        `维度 ${dimension.name} 占比必须大于 0%、不超过 100%，且最多保留两位小数`,
      );
    }
    return sum.plus(weight);
  }, new ExactDecimal(0));
  if (!total.equals(100)) {
    throw new StageCalculationError(
      'INVALID_STAGE_STRUCTURE',
      '计分维度占比必须精确合计 100%',
    );
  }
}

function applyUnifiedConstraints(
  initialLevel: PerformanceLevel,
  dimensions: UnifiedStageDimensionResult[],
) {
  let finalLevel = initialLevel;
  const matchedConstraints: UnifiedMatchedConstraint[] = [];
  const core = dimensions.find((dimension) => dimension.isCore)!;

  const apply = (
    type: UnifiedMatchedConstraint['type'],
    matched: UnifiedStageDimensionResult[],
    targetLevel: PerformanceLevel,
  ) => {
    if (matched.length === 0) return;
    const beforeLevel = finalLevel;
    finalLevel = lowerLevel(finalLevel, targetLevel);
    matchedConstraints.push({
      id: type.toLowerCase().replaceAll('_', '-'),
      type,
      dimensionIds: matched.map((dimension) => dimension.id),
      parameters: { targetLevel },
      beforeLevel,
      afterLevel: finalLevel,
      changed: beforeLevel !== finalLevel,
    });
  };

  apply('CORE_C_FORCE', core.level === 'C' ? [core] : [], 'C');
  apply('CORE_B_CAP', core.level === 'B' ? [core] : [], 'B');
  apply(
    'ANY_C_CAP',
    dimensions.filter((dimension) => dimension.level === 'C'),
    'B',
  );
  return { finalLevel, matchedConstraints };
}

function applyConfirmedRedLine(
  finalLevel: PerformanceLevel,
  matchedConstraints: UnifiedMatchedConstraint[],
  confirmedRedLine: ConfirmedRedLine | null,
) {
  if (!confirmedRedLine) return { finalLevel, matchedConstraints };
  return {
    finalLevel: 'C' as const,
    matchedConstraints: [
      ...matchedConstraints,
      {
        id: confirmedRedLine.findingId,
        type: 'CONFIRMED_RED_LINE' as const,
        dimensionIds: [],
        parameters: {
          category: confirmedRedLine.category,
          reason: confirmedRedLine.reason,
          targetLevel: 'C' as const,
        },
        beforeLevel: finalLevel,
        afterLevel: 'C' as const,
        changed: finalLevel !== 'C',
      },
    ],
  };
}

function lowerLevel(
  current: PerformanceLevel,
  target: PerformanceLevel,
): PerformanceLevel {
  const rank: Record<PerformanceLevel, number> = { S: 4, A: 3, B: 2, C: 1 };
  return rank[current] <= rank[target] ? current : target;
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
    throw new StageCalculationError(
      'INVALID_RATING_SCALE',
      `分数 ${score.toString()} 未匹配任何评级区间`,
    );
  }
  return rating.symbol;
}
