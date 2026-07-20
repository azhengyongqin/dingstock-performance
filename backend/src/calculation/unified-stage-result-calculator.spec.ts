import { calculateUnifiedStageResult } from './unified-stage-result-calculator';

const ratings = [
  { symbol: 'S' as const, minScore: '90', maxScore: '100', mappingScore: '95' },
  { symbol: 'A' as const, minScore: '80', maxScore: '90', mappingScore: '85' },
  { symbol: 'B' as const, minScore: '60', maxScore: '80', mappingScore: '70' },
  { symbol: 'C' as const, minScore: '0', maxScore: '60', mappingScore: '50' },
];

const relation = (
  raw: { rawLevel?: 'S' | 'A' | 'B' | 'C'; rawScore?: string },
  type: 'LEADER' | 'ORG_OWNER' | 'PEER' = 'LEADER',
  weight = '100',
) => ({ type, weight, items: [{ submissionId: `${type}-1`, ...raw }] });

describe('calculateUnifiedStageResult', () => {
  it('评级与分数维度统一形成 calculationScore、派生等级并加权', () => {
    const result = calculateUnifiedStageResult({
      ratings,
      dimensions: [
        {
          id: 'delivery',
          name: '业务交付',
          scoringMethod: 'RATING',
          weight: '40',
          isCore: true,
          relations: [relation({ rawLevel: 'A' })],
        },
        {
          id: 'growth',
          name: '学习成长',
          scoringMethod: 'SCORE',
          weight: '60',
          isCore: false,
          relations: [relation({ rawScore: '95' })],
        },
      ],
      confirmedRedLine: null,
    });

    expect(result).toMatchObject({
      compositeScore: '91.00',
      initialLevel: 'S',
      finalLevel: 'S',
      dimensions: [
        {
          id: 'delivery',
          scoringMethod: 'RATING',
          score: '85',
          level: 'A',
          relations: [{ items: [{ rawLevel: 'A', calculationScore: '85' }] }],
        },
        {
          id: 'growth',
          scoringMethod: 'SCORE',
          score: '95',
          level: 'S',
          relations: [{ items: [{ rawScore: '95', calculationScore: '95' }] }],
        },
      ],
    });
  });

  it.each([
    {
      name: '核心维度 C 强制 C',
      core: { rawLevel: 'C' as const },
      other: { rawScore: '100' },
      expected: 'C',
      reason: 'CORE_C_FORCE',
      coreWeight: '20',
    },
    {
      name: '核心维度 B 最高 B',
      core: { rawLevel: 'B' as const },
      other: { rawScore: '100' },
      expected: 'B',
      reason: 'CORE_B_CAP',
      coreWeight: '20',
    },
    {
      name: '任一维度 C 最高 B',
      core: { rawLevel: 'S' as const },
      other: { rawScore: '50' },
      expected: 'B',
      reason: 'ANY_C_CAP',
      coreWeight: '80',
    },
  ])('$name', ({ core, other, expected, reason, coreWeight }) => {
    const result = calculateUnifiedStageResult({
      ratings,
      dimensions: [
        {
          id: 'core',
          name: '核心维度',
          scoringMethod: 'RATING',
          weight: coreWeight,
          isCore: true,
          relations: [relation(core)],
        },
        {
          id: 'other',
          name: '其他维度',
          scoringMethod: 'SCORE',
          weight: String(100 - Number(coreWeight)),
          isCore: false,
          relations: [relation(other)],
        },
      ],
      confirmedRedLine: null,
    });

    expect(result.finalLevel).toBe(expected);
    expect(result.matchedConstraints).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: reason })]),
    );
  });

  it('红线规则在统一维度约束后独立强制 C', () => {
    const result = calculateUnifiedStageResult({
      ratings,
      dimensions: [
        {
          id: 'core',
          name: '核心维度',
          scoringMethod: 'SCORE',
          weight: '100',
          isCore: true,
          relations: [relation({ rawScore: '95' })],
        },
      ],
      confirmedRedLine: {
        findingId: 'finding-1',
        category: '重大事故',
        reason: '已确认',
      },
    });

    expect(result.finalLevel).toBe('C');
    expect(result.matchedConstraints.at(-1)).toMatchObject({
      type: 'CONFIRMED_RED_LINE',
      beforeLevel: 'S',
      afterLevel: 'C',
    });
  });

  it('360°保持关系内平均、有效关系归一化、关系加权后再做维度加权', () => {
    const result = calculateUnifiedStageResult({
      ratings,
      dimensions: [
        {
          id: 'rating',
          name: '评级维度',
          scoringMethod: 'RATING',
          weight: '50',
          isCore: true,
          relations: [
            {
              type: 'ORG_OWNER',
              weight: '30',
              items: [
                { submissionId: 'org-1', rawLevel: 'S' },
                { submissionId: 'org-2', rawLevel: 'A' },
              ],
            },
            relation({ rawLevel: 'B' }, 'PEER', '25'),
          ],
        },
        {
          id: 'score',
          name: '分数维度',
          scoringMethod: 'SCORE',
          weight: '50',
          isCore: false,
          relations: [
            relation({ rawScore: '100' }, 'ORG_OWNER', '30'),
            relation({ rawScore: '60' }, 'PEER', '25'),
          ],
        },
      ],
      confirmedRedLine: null,
    });

    expect(result.compositeScore).toBe('81.36');
    expect(result.dimensions[0]).toMatchObject({
      score: '80.90909090909090909090909090909090909091',
      relations: [
        {
          type: 'ORG_OWNER',
          score: '90',
          effectiveWeight: '54.54545454545454545454545454545454545455',
        },
        {
          type: 'PEER',
          score: '70',
          effectiveWeight: '45.45454545454545454545454545454545454545',
        },
      ],
    });
  });
});
