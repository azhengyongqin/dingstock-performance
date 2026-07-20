import { ManagerStageResultService } from './manager-stage-result.service';

jest.mock(
  '../generated/prisma/client',
  () => ({ PrismaClient: class {}, Prisma: {} }),
  { virtual: true },
);
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfEvaluationTaskType: { MANAGER: 'MANAGER' },
    PerfRedLineAction: { CONFIRM: 'CONFIRM' },
    PerfReviewStatus: { DRAFT: 'DRAFT', SUBMITTED: 'SUBMITTED' },
    PerfStageResultStatus: { READY: 'READY', NO_DATA: 'NO_DATA' },
  }),
  { virtual: true },
);

const ratings = [
  { symbol: 'S', minScore: '90', maxScore: '100', mappingScore: '95' },
  { symbol: 'A', minScore: '80', maxScore: '90', mappingScore: '85' },
  { symbol: 'B', minScore: '60', maxScore: '80', mappingScore: '70' },
  { symbol: 'C', minScore: '0', maxScore: '60', mappingScore: '50' },
];

const dimension = (
  key: string,
  scoringMethod: 'RATING' | 'SCORE',
  weight: string,
  isCore: boolean,
) => ({
  key,
  type: 'SCORING',
  audience: 'LEADER',
  name: key === 'manager:core' ? '核心业绩' : '价值观',
  scoringMethod,
  weight,
  isCore,
  fields: [],
});

const participant = {
  id: 7,
  cycleId: 1,
  formSnapshot: {
    content: {
      subforms: [
        {
          key: 'subform:MANAGER',
          type: 'MANAGER',
          dimensions: [
            dimension('manager:core', 'RATING', '80', true),
            dimension('manager:values', 'SCORE', '20', false),
          ],
        },
      ],
    },
  },
  cycle: {
    deletedAt: null,
    currentConfigVersionId: 3,
    currentConfigVersion: { id: 3, ratings },
  },
};

const answer = (
  dimensionKey: string,
  values: { rawLevel?: 'S' | 'A' | 'B' | 'C'; rawScore?: string },
) => ({
  dimensionKey,
  rawLevel: values.rawLevel ?? null,
  rawScore: values.rawScore ?? null,
  derivedLevel: null,
  fields: [],
});

describe('ManagerStageResultService 新版维度阶段结果', () => {
  const prisma = {
    perfParticipant: { findUnique: jest.fn() },
    perfEvaluationSubmission: { findFirst: jest.fn() },
    perfRedLineFinding: { findFirst: jest.fn() },
    perfStageResult: { upsert: jest.fn() },
  };
  let service: ManagerStageResultService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.perfParticipant.findUnique.mockResolvedValue(participant);
    prisma.perfEvaluationSubmission.findFirst.mockResolvedValue({
      id: 101,
      reviewerOpenId: 'ou_leader',
      status: 'SUBMITTED',
      dimensionAnswers: [
        answer('manager:core', { rawLevel: 'S' }),
        answer('manager:values', { rawScore: '50' }),
      ],
    });
    prisma.perfStageResult.upsert.mockImplementation(
      ({ create }: { create: object }) => create,
    );
    prisma.perfRedLineFinding.findFirst.mockResolvedValue(null);
    service = new ManagerStageResultService(prisma as never);
  });

  it('混合评级与分数维度统一换算加权，并由任一 C 将 A 封顶为 B', async () => {
    const result = await service.recalculate(7);

    expect(result).toMatchObject({
      status: 'READY',
      reviewerCount: 1,
      compositeScore: '86.00',
      initialLevel: 'A',
      stageLevel: 'B',
      dimensions: [
        {
          id: 'manager:core',
          scoringMethod: 'RATING',
          score: '95',
          level: 'S',
        },
        {
          id: 'manager:values',
          scoringMethod: 'SCORE',
          score: '50',
          level: 'C',
        },
      ],
    });
    expect(result.constraintReasons).toEqual([
      expect.objectContaining({
        id: 'any-c-cap',
        type: 'ANY_C_CAP',
        beforeLevel: 'A',
        afterLevel: 'B',
      }),
    ]);
  });

  it.each([
    {
      name: '核心 C 强制 C',
      core: 'C' as const,
      score: '100',
      expectedInitial: 'B',
      expectedFinal: 'C',
      constraint: 'CORE_C_FORCE',
    },
    {
      name: '核心 B 封顶 B',
      core: 'B' as const,
      score: '95',
      expectedInitial: 'S',
      expectedFinal: 'B',
      constraint: 'CORE_B_CAP',
    },
  ])(
    '$name',
    async ({ core, score, expectedInitial, expectedFinal, constraint }) => {
      if (constraint === 'CORE_B_CAP') {
        prisma.perfParticipant.findUnique.mockResolvedValueOnce({
          ...participant,
          formSnapshot: {
            content: {
              subforms: [
                {
                  key: 'subform:MANAGER',
                  type: 'MANAGER',
                  dimensions: [
                    dimension('manager:core', 'RATING', '20', true),
                    dimension('manager:values', 'SCORE', '80', false),
                  ],
                },
              ],
            },
          },
        });
      }
      prisma.perfEvaluationSubmission.findFirst.mockResolvedValueOnce({
        id: 102,
        reviewerOpenId: 'ou_leader',
        status: 'SUBMITTED',
        dimensionAnswers: [
          answer('manager:core', { rawLevel: core }),
          answer('manager:values', { rawScore: score }),
        ],
      });

      const result = await service.recalculate(7);

      expect(result).toMatchObject({
        initialLevel: expectedInitial,
        stageLevel: expectedFinal,
      });
      expect(result.constraintReasons).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: constraint })]),
      );
    },
  );

  it('存在有效红线确认时独立将上级阶段结果强制为 C', async () => {
    prisma.perfEvaluationSubmission.findFirst.mockResolvedValueOnce({
      id: 103,
      reviewerOpenId: 'ou_leader',
      status: 'SUBMITTED',
      dimensionAnswers: [
        answer('manager:core', { rawLevel: 'S' }),
        answer('manager:values', { rawScore: '95' }),
      ],
    });
    prisma.perfRedLineFinding.findFirst.mockResolvedValueOnce({
      id: 501,
      findingType: 'SERIOUS_VIOLATION',
      reason: '依据员工手册红线条款',
    });

    const result = await service.recalculate(7);

    expect(result).toMatchObject({ initialLevel: 'S', stageLevel: 'C' });
    expect(result.constraintReasons).toEqual([
      expect.objectContaining({
        id: 'red-line:501',
        type: 'CONFIRMED_RED_LINE',
        beforeLevel: 'S',
        afterLevel: 'C',
      }),
    ]);
  });

  it('没有生效提交时保存 NO_DATA，不使用草稿参与权威结果', async () => {
    prisma.perfEvaluationSubmission.findFirst.mockResolvedValueOnce(null);

    await expect(service.recalculate(7)).resolves.toMatchObject({
      status: 'NO_DATA',
      reviewerCount: 0,
      compositeScore: null,
      dimensions: [],
    });
  });
});
