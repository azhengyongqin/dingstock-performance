import {
  calculateStageResult,
  mapScoreToPerformanceLevel,
  type RatingScaleEntry,
} from './stage-result-calculator';

const ratings: RatingScaleEntry[] = [
  { symbol: 'S', minScore: 90, maxScore: 100, mappingScore: 95 },
  { symbol: 'A', minScore: 80, maxScore: 90, mappingScore: 85 },
  { symbol: 'B', minScore: 60, maxScore: 80, mappingScore: 70 },
  { symbol: 'C', minScore: 0, maxScore: 60, mappingScore: 50 },
];

describe('维度计分基础计算器', () => {
  it('评级输入先转换为计算分', () => {
    const result = calculateStageResult({
      scoringMethod: 'RATING',
      ratings,
      confirmedRedLine: null,
      dimensions: [
        {
          id: 'delivery',
          name: '工作交付',
          weight: 100,
          isCore: true,
          relations: [
            {
              type: 'DIRECT',
              weight: 100,
              items: [
                {
                  itemId: 'input-1',
                  submissionId: 'submission-1',
                  rawValue: 'A',
                },
              ],
            },
          ],
        },
      ],
    });

    expect(result.compositeScore).toBe('85.00');
    expect(result.finalLevel).toBe('A');
    expect(result.dimensions[0].relations[0].items[0].ratingMapping).toEqual(
      expect.objectContaining({ symbol: 'A', mappingScore: '85' }),
    );
  });

  it('分数输入直接作为计算分，并独立应用已确认红线', () => {
    const result = calculateStageResult({
      scoringMethod: 'SCORE',
      ratings,
      confirmedRedLine: {
        findingId: 'red-line-1',
        category: '合规',
        reason: '已确认红线',
      },
      dimensions: [
        {
          id: 'delivery',
          name: '工作交付',
          weight: 100,
          isCore: true,
          relations: [
            {
              type: 'DIRECT',
              weight: 100,
              items: [
                {
                  itemId: 'input-1',
                  submissionId: 'submission-1',
                  rawValue: 92,
                },
              ],
            },
          ],
        },
      ],
    });

    expect(result.compositeScore).toBe('92.00');
    expect(result.initialLevel).toBe('S');
    expect(result.finalLevel).toBe('C');
    expect(result.matchedConstraints).toEqual([
      expect.objectContaining({ type: 'CONFIRMED_RED_LINE' }),
    ]);
  });

  it('公开等级映射复用同一套区间边界', () => {
    expect(mapScoreToPerformanceLevel('90', ratings)).toBe('S');
    expect(mapScoreToPerformanceLevel('80', ratings)).toBe('A');
  });
});
