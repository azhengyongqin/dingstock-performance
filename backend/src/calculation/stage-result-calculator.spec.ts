import {
  calculateStageResult,
  RatingScaleEntry,
  StageCalculationError,
  StageResultInput,
} from './stage-result-calculator';

function ratingScale(): RatingScaleEntry[] {
  return [
    { symbol: 'S', minScore: 90, maxScore: 100, mappingScore: 95 },
    { symbol: 'A', minScore: 80, maxScore: 90, mappingScore: 85 },
    { symbol: 'B', minScore: 60, maxScore: 80, mappingScore: 70 },
    { symbol: 'C', minScore: 0, maxScore: 60, mappingScore: 50 },
  ];
}

function singleDimensionScoreInput(score = '95'): StageResultInput {
  return {
    mode: 'WEIGHTED_SCORE',
    ratings: ratingScale(),
    dimensions: [
      {
        id: 'delivery',
        name: '核心业绩',
        weight: 100,
        isCore: true,
        relations: [
          {
            type: 'DIRECT',
            weight: 100,
            items: [
              {
                itemId: 'delivery-score',
                submissionId: 'manager-review-1',
                rawValue: score,
              },
            ],
          },
        ],
      },
    ],
    constraints: [],
    confirmedRedLine: null,
  };
}

describe('calculateStageResult', () => {
  it('按配置映射评级并保留从评估项到阶段等级的计算明细', () => {
    const result = calculateStageResult({
      mode: 'WEIGHTED_RATING',
      ratings: ratingScale(),
      dimensions: [
        {
          id: 'delivery',
          name: '核心业绩',
          weight: 70,
          isCore: true,
          relations: [
            {
              type: 'DIRECT',
              weight: 100,
              items: [
                {
                  itemId: 'delivery-rating',
                  submissionId: 'manager-review-1',
                  rawValue: 'S',
                },
              ],
            },
          ],
        },
        {
          id: 'values',
          name: '价值观',
          weight: 20,
          isCore: false,
          relations: [
            {
              type: 'DIRECT',
              weight: 100,
              items: [
                {
                  itemId: 'values-rating',
                  submissionId: 'manager-review-1',
                  rawValue: 'A',
                },
              ],
            },
          ],
        },
        {
          id: 'potential',
          name: '职业素养与潜力',
          weight: 10,
          isCore: false,
          relations: [
            {
              type: 'DIRECT',
              weight: 100,
              items: [
                {
                  itemId: 'potential-rating',
                  submissionId: 'manager-review-1',
                  rawValue: 'B',
                },
              ],
            },
          ],
        },
      ],
      constraints: [],
      confirmedRedLine: null,
    });

    expect(result).toMatchObject({
      mode: 'WEIGHTED_RATING',
      unroundedCompositeScore: '90.5',
      compositeScore: '90.50',
      initialLevel: 'S',
      finalLevel: 'S',
      matchedConstraints: [],
    });
    expect(result.dimensions[0]).toMatchObject({
      id: 'delivery',
      score: '95',
      level: 'S',
      relations: [
        {
          type: 'DIRECT',
          score: '95',
          items: [
            {
              itemId: 'delivery-rating',
              rawValue: 'S',
              calculationScore: '95',
              ratingMapping: {
                symbol: 'S',
                minScore: '90',
                maxScore: '100',
                mappingScore: '95',
              },
            },
          ],
        },
      ],
    });
  });

  it('按有效关系的基础权重归一化并保留基础与有效权重', () => {
    const input = singleDimensionScoreInput();
    input.dimensions[0].relations = [
      {
        type: 'ORG_OWNER',
        weight: 30,
        items: [
          {
            itemId: 'delivery-score',
            submissionId: 'org-owner-review',
            rawValue: '100',
          },
        ],
      },
      {
        type: 'PEER',
        weight: 25,
        items: [
          {
            itemId: 'delivery-score',
            submissionId: 'peer-review',
            rawValue: '50',
          },
        ],
      },
    ];

    const result = calculateStageResult(input);

    expect(result).toMatchObject({
      unroundedCompositeScore: '77.27272727272727272727272727272727272727',
      compositeScore: '77.27',
      initialLevel: 'B',
    });
    expect(result.dimensions[0].relations).toMatchObject([
      {
        type: 'ORG_OWNER',
        baseWeight: '30',
        effectiveWeight: '54.54545454545454545454545454545454545455',
        score: '100',
      },
      {
        type: 'PEER',
        baseWeight: '25',
        effectiveWeight: '45.45454545454545454545454545454545454545',
        score: '50',
      },
    ]);
  });

  it('拒绝超过两位小数的评分输入', () => {
    expect(() =>
      calculateStageResult({
        mode: 'WEIGHTED_SCORE',
        ratings: ratingScale(),
        dimensions: [
          {
            id: 'delivery',
            name: '核心业绩',
            weight: 100,
            isCore: true,
            relations: [
              {
                type: 'DIRECT',
                weight: 100,
                items: [
                  {
                    itemId: 'delivery-score',
                    submissionId: 'manager-review-1',
                    rawValue: '80.001',
                  },
                ],
              },
            ],
          },
        ],
        constraints: [],
        confirmedRedLine: null,
      }),
    ).toThrow(
      new StageCalculationError(
        'INVALID_SCORE_PRECISION',
        '评分必须最多保留两位小数',
      ),
    );
  });

  it('中间过程不舍入，并在综合分四舍五入两位后映射等级', () => {
    const result = calculateStageResult({
      mode: 'WEIGHTED_SCORE',
      ratings: ratingScale(),
      dimensions: [
        {
          id: 'delivery',
          name: '核心业绩',
          weight: 100,
          isCore: true,
          relations: [
            {
              type: 'DIRECT',
              weight: 100,
              items: [
                {
                  itemId: 'delivery-score',
                  submissionId: 'manager-review-1',
                  rawValue: '79.99',
                },
                {
                  itemId: 'delivery-score',
                  submissionId: 'manager-review-2',
                  rawValue: '80.00',
                },
              ],
            },
          ],
        },
      ],
      constraints: [],
      confirmedRedLine: null,
    });

    expect(result).toMatchObject({
      unroundedCompositeScore: '79.995',
      compositeScore: '80.00',
      initialLevel: 'A',
      finalLevel: 'A',
    });
    expect(result.dimensions[0].relations[0].items).toMatchObject([
      { rawValue: '79.99', calculationScore: '79.99' },
      { rawValue: '80.00', calculationScore: '80' },
    ]);
  });

  it.each([
    {
      lowerScore: '59.99',
      upperScore: '60.00',
      unrounded: '59.995',
      rounded: '60.00',
      level: 'B',
    },
    {
      lowerScore: '89.99',
      upperScore: '90.00',
      unrounded: '89.995',
      rounded: '90.00',
      level: 'S',
    },
  ] as const)(
    '综合分 $unrounded 在舍入后按 $rounded 映射为 $level',
    ({ lowerScore, upperScore, unrounded, rounded, level }) => {
      const input = singleDimensionScoreInput(lowerScore);
      input.dimensions[0].relations[0].items.push({
        itemId: 'delivery-score',
        submissionId: 'manager-review-2',
        rawValue: upperScore,
      });

      expect(calculateStageResult(input)).toMatchObject({
        unroundedCompositeScore: unrounded,
        compositeScore: rounded,
        initialLevel: level,
      });
    },
  );

  it('拒绝落在自身评级区间之外的映射分', () => {
    expect(() =>
      calculateStageResult({
        mode: 'WEIGHTED_RATING',
        ratings: [
          { symbol: 'S', minScore: 90, maxScore: 100, mappingScore: 95 },
          { symbol: 'A', minScore: 80, maxScore: 90, mappingScore: 90 },
          { symbol: 'B', minScore: 60, maxScore: 80, mappingScore: 70 },
          { symbol: 'C', minScore: 0, maxScore: 60, mappingScore: 50 },
        ],
        dimensions: [
          {
            id: 'delivery',
            name: '核心业绩',
            weight: 100,
            isCore: true,
            relations: [
              {
                type: 'DIRECT',
                weight: 100,
                items: [
                  {
                    itemId: 'delivery-rating',
                    submissionId: 'manager-review-1',
                    rawValue: 'A',
                  },
                ],
              },
            ],
          },
        ],
        constraints: [],
        confirmedRedLine: null,
      }),
    ).toThrow(
      new StageCalculationError(
        'INVALID_RATING_SCALE',
        '评级 A 的映射分必须落在自身分数区间内',
      ),
    );
  });

  it('应用受控评级约束并解释每条命中规则', () => {
    const result = calculateStageResult({
      mode: 'WEIGHTED_RATING',
      ratings: ratingScale(),
      dimensions: [
        {
          id: 'delivery',
          name: '核心业绩',
          weight: 10,
          isCore: true,
          relations: [
            {
              type: 'DIRECT',
              weight: 100,
              items: [
                {
                  itemId: 'delivery-rating',
                  submissionId: 'manager-review-1',
                  rawValue: 'C',
                },
              ],
            },
          ],
        },
        {
          id: 'values',
          name: '价值观',
          weight: 90,
          isCore: false,
          relations: [
            {
              type: 'DIRECT',
              weight: 100,
              items: [
                {
                  itemId: 'values-rating',
                  submissionId: 'manager-review-1',
                  rawValue: 'S',
                },
              ],
            },
          ],
        },
      ],
      constraints: [
        {
          id: 'core-c-force-c',
          type: 'CORE_RATING_FORCE',
          triggerRating: 'C',
          targetLevel: 'C',
        },
        {
          id: 'any-c-cap-b',
          type: 'ANY_RATING_CAP',
          triggerRating: 'C',
          targetLevel: 'B',
        },
      ],
      confirmedRedLine: null,
    });

    expect(result).toMatchObject({
      compositeScore: '90.50',
      initialLevel: 'S',
      finalLevel: 'C',
      matchedConstraints: [
        {
          id: 'core-c-force-c',
          type: 'CORE_RATING_FORCE',
          dimensionIds: ['delivery'],
          parameters: { triggerRating: 'C', targetLevel: 'C' },
          beforeLevel: 'S',
          afterLevel: 'C',
          changed: true,
        },
        {
          id: 'any-c-cap-b',
          type: 'ANY_RATING_CAP',
          dimensionIds: ['delivery'],
          parameters: { triggerRating: 'C', targetLevel: 'B' },
          beforeLevel: 'C',
          afterLevel: 'C',
          changed: false,
        },
      ],
    });
  });

  it('应用受控评分约束并保留阈值与命中维度', () => {
    const result = calculateStageResult({
      mode: 'WEIGHTED_SCORE',
      ratings: ratingScale(),
      dimensions: [
        {
          id: 'delivery',
          name: '核心业绩',
          weight: 10,
          isCore: true,
          relations: [
            {
              type: 'DIRECT',
              weight: 100,
              items: [
                {
                  itemId: 'delivery-score',
                  submissionId: 'manager-review-1',
                  rawValue: '59.99',
                },
              ],
            },
          ],
        },
        {
          id: 'values',
          name: '价值观',
          weight: 90,
          isCore: false,
          relations: [
            {
              type: 'DIRECT',
              weight: 100,
              items: [
                {
                  itemId: 'values-score',
                  submissionId: 'manager-review-1',
                  rawValue: '100',
                },
              ],
            },
          ],
        },
      ],
      constraints: [
        {
          id: 'core-below-60-force-c',
          type: 'CORE_SCORE_FORCE',
          threshold: 60,
          targetLevel: 'C',
        },
        {
          id: 'core-below-80-cap-b',
          type: 'CORE_SCORE_CAP',
          threshold: 80,
          targetLevel: 'B',
        },
        {
          id: 'any-below-60-cap-b',
          type: 'ANY_SCORE_CAP',
          threshold: 60,
          targetLevel: 'B',
        },
      ],
      confirmedRedLine: null,
    });

    expect(result).toMatchObject({
      unroundedCompositeScore: '95.999',
      compositeScore: '96.00',
      initialLevel: 'S',
      finalLevel: 'C',
      matchedConstraints: [
        {
          id: 'core-below-60-force-c',
          type: 'CORE_SCORE_FORCE',
          dimensionIds: ['delivery'],
          parameters: { threshold: '60', targetLevel: 'C' },
          beforeLevel: 'S',
          afterLevel: 'C',
          changed: true,
        },
        {
          id: 'core-below-80-cap-b',
          type: 'CORE_SCORE_CAP',
          dimensionIds: ['delivery'],
          parameters: { threshold: '80', targetLevel: 'B' },
          beforeLevel: 'C',
          afterLevel: 'C',
          changed: false,
        },
        {
          id: 'any-below-60-cap-b',
          type: 'ANY_SCORE_CAP',
          dimensionIds: ['delivery'],
          parameters: { threshold: '60', targetLevel: 'B' },
          beforeLevel: 'C',
          afterLevel: 'C',
          changed: false,
        },
      ],
    });
  });

  it('已确认红线强制阶段等级为 C 且保留原始计算结果', () => {
    const result = calculateStageResult({
      mode: 'WEIGHTED_SCORE',
      ratings: ratingScale(),
      dimensions: [
        {
          id: 'delivery',
          name: '核心业绩',
          weight: 100,
          isCore: true,
          relations: [
            {
              type: 'DIRECT',
              weight: 100,
              items: [
                {
                  itemId: 'delivery-score',
                  submissionId: 'manager-review-1',
                  rawValue: '95',
                },
              ],
            },
          ],
        },
      ],
      constraints: [],
      confirmedRedLine: {
        findingId: 'red-line-42',
        category: '重大违规',
        reason: 'HR 已完成事实与证据确认',
      },
    });

    expect(result).toMatchObject({
      compositeScore: '95.00',
      initialLevel: 'S',
      finalLevel: 'C',
      matchedConstraints: [
        {
          id: 'red-line-42',
          type: 'CONFIRMED_RED_LINE',
          dimensionIds: [],
          parameters: {
            category: '重大违规',
            reason: 'HR 已完成事实与证据确认',
            targetLevel: 'C',
          },
          beforeLevel: 'S',
          afterLevel: 'C',
          changed: true,
        },
      ],
    });
  });

  it('拒绝自定义脚本或未知约束类型', () => {
    expect(() =>
      calculateStageResult({
        mode: 'WEIGHTED_SCORE',
        ratings: ratingScale(),
        dimensions: [
          {
            id: 'delivery',
            name: '核心业绩',
            weight: 100,
            isCore: true,
            relations: [
              {
                type: 'DIRECT',
                weight: 100,
                items: [
                  {
                    itemId: 'delivery-score',
                    submissionId: 'manager-review-1',
                    rawValue: '95',
                  },
                ],
              },
            ],
          },
        ],
        constraints: [
          {
            id: 'custom-formula',
            type: 'CUSTOM_SCRIPT',
            script: 'return score + 10',
          } as never,
        ],
        confirmedRedLine: null,
      }),
    ).toThrow(
      new StageCalculationError(
        'INVALID_CONSTRAINT_RULE',
        '不支持约束类型 CUSTOM_SCRIPT',
      ),
    );
  });

  it('要求加权阶段显式且唯一标记核心维度', () => {
    expect(() =>
      calculateStageResult({
        mode: 'WEIGHTED_SCORE',
        ratings: ratingScale(),
        dimensions: [
          {
            id: 'delivery',
            name: '核心业绩',
            weight: 100,
            isCore: false,
            relations: [
              {
                type: 'DIRECT',
                weight: 100,
                items: [
                  {
                    itemId: 'delivery-score',
                    submissionId: 'manager-review-1',
                    rawValue: '95',
                  },
                ],
              },
            ],
          },
        ],
        constraints: [],
        confirmedRedLine: null,
      }),
    ).toThrow(
      new StageCalculationError(
        'INVALID_STAGE_STRUCTURE',
        '加权阶段必须且只能有一个核心维度',
      ),
    );
  });

  it('要求维度权重合计 100%，且基础关系权重满足配置边界', () => {
    const invalidDimensionWeight = singleDimensionScoreInput();
    invalidDimensionWeight.dimensions[0].weight = '99.99';
    expect(() => calculateStageResult(invalidDimensionWeight)).toThrow(
      new StageCalculationError(
        'INVALID_STAGE_STRUCTURE',
        '维度权重必须精确合计 100%',
      ),
    );

    const invalidRelationWeight = singleDimensionScoreInput();
    invalidRelationWeight.dimensions[0].relations[0].weight = '100.001';
    expect(() => calculateStageResult(invalidRelationWeight)).toThrow(
      new StageCalculationError(
        'INVALID_STAGE_STRUCTURE',
        '维度 核心业绩 的关系 DIRECT权重必须大于 0%、不超过 100%，且最多保留两位小数',
      ),
    );
  });

  it.each(['-0.01', '100.01'])('拒绝超出 0～100 的评分输入：%s', (score) => {
    expect(() =>
      calculateStageResult(singleDimensionScoreInput(score)),
    ).toThrow(
      new StageCalculationError('INVALID_SCORE', '评分必须在 0～100 之间'),
    );
  });

  it('拒绝评级表中不存在的原始评级', () => {
    const input = singleDimensionScoreInput('D');
    input.mode = 'WEIGHTED_RATING';

    expect(() => calculateStageResult(input)).toThrow(
      new StageCalculationError(
        'INVALID_RATING_INPUT',
        '原始评级 D 不在当前评级表中',
      ),
    );
  });

  it('要求评级表完整包含固定的 S/A/B/C', () => {
    const input = singleDimensionScoreInput();
    input.ratings = input.ratings.filter((rating) => rating.symbol !== 'B');

    expect(() => calculateStageResult(input)).toThrow(
      new StageCalculationError(
        'INVALID_RATING_SCALE',
        '评级表必须且只能包含 S、A、B、C',
      ),
    );
  });

  it('拒绝越界或超过两位小数的约束阈值', () => {
    const input = singleDimensionScoreInput();
    input.constraints = [
      {
        id: 'invalid-threshold',
        type: 'CORE_SCORE_CAP',
        threshold: '80.001',
        targetLevel: 'B',
      },
    ];

    expect(() => calculateStageResult(input)).toThrow(
      new StageCalculationError(
        'INVALID_CONSTRAINT_RULE',
        '约束 invalid-threshold 的阈值必须在 0～100 之间且最多保留两位小数',
      ),
    );
  });
});
