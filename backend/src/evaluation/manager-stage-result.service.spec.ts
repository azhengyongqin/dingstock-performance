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
            {
              key: 'dimension:performance',
              kind: 'REGULAR',
              audience: 'LEADER',
              name: '核心业绩',
              weight: '70',
              isCore: true,
              items: [
                {
                  key: 'item:performance:score',
                  type: 'SCORE',
                  title: '业绩分数',
                  required: true,
                },
              ],
            },
            {
              key: 'dimension:values',
              kind: 'REGULAR',
              audience: 'LEADER',
              name: '价值观',
              weight: '30',
              isCore: false,
              items: [
                {
                  key: 'item:values:score',
                  type: 'SCORE',
                  title: '价值观分数',
                  required: true,
                },
              ],
            },
          ],
        },
      ],
    },
  },
  cycle: {
    deletedAt: null,
    currentConfigVersionId: 3,
    currentConfigVersion: {
      id: 3,
      managerStageMode: 'WEIGHTED_SCORE',
      ratings,
      constraintProfiles: {
        WEIGHTED_RATING: [],
        WEIGHTED_SCORE: [
          {
            id: 'core-below-60-cap-c',
            type: 'CORE_SCORE_CAP',
            enabled: true,
            threshold: '60',
            targetLevel: 'C',
          },
        ],
      },
    },
  },
};

describe('ManagerStageResultService 权威阶段结果', () => {
  const prisma = {
    perfParticipant: { findUnique: jest.fn() },
    perfEvaluationSubmission: { findFirst: jest.fn() },
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
      items: [
        {
          itemKey: 'item:performance:score',
          dimensionKey: 'dimension:performance',
          rawLevel: null,
          rawScore: '58',
        },
        {
          itemKey: 'item:values:score',
          dimensionKey: 'dimension:values',
          rawLevel: null,
          rawScore: '100',
        },
      ],
    });
    prisma.perfStageResult.upsert.mockImplementation(
      ({ create }: { create: object }) => create,
    );
    service = new ManagerStageResultService(prisma as never);
  });

  it('按 MANAGER 动态维度计算并保存校准前权威等级，不接收人工初评等级', async () => {
    const result = await service.recalculate(7);

    expect(result).toMatchObject({
      status: 'READY',
      mode: 'WEIGHTED_SCORE',
      reviewerCount: 1,
      compositeScore: '70.60',
      initialLevel: 'B',
      stageLevel: 'C',
      dimensions: [
        { id: 'dimension:performance', score: '58', level: 'C' },
        { id: 'dimension:values', score: '100', level: 'S' },
      ],
    });
    expect(result.constraintReasons).toEqual([
      expect.objectContaining({
        id: 'core-below-60-cap-c',
        beforeLevel: 'B',
        afterLevel: 'C',
      }),
    ]);
    expect(prisma.perfStageResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          participantId_stage_cycleConfigVersionId: {
            participantId: 7,
            stage: 'MANAGER',
            cycleConfigVersionId: 3,
          },
        },
        create: expect.objectContaining({
          stage: 'MANAGER',
          initialLevel: 'B',
          stageLevel: 'C',
          dimensions: {
            create: expect.arrayContaining([
              expect.objectContaining({
                dimensionKey: 'dimension:performance',
              }),
            ]),
          },
        }),
      }),
    );
    const persisted = prisma.perfStageResult.upsert.mock.calls[0][0];
    expect(persisted.create.dimensions.create[0]).not.toHaveProperty(
      'relationAggregates',
    );
  });

  it('没有生效提交时保存 NO_DATA，不使用更新草稿参与权威结果', async () => {
    prisma.perfEvaluationSubmission.findFirst.mockResolvedValueOnce(null);

    const result = await service.recalculate(7);

    expect(result).toMatchObject({
      status: 'NO_DATA',
      reviewerCount: 0,
      compositeScore: null,
      initialLevel: null,
      stageLevel: null,
      dimensions: [],
    });
  });

  it('配置为加权评级时使用评级映射分计算，不读取明细中的人工等级结论', async () => {
    prisma.perfParticipant.findUnique.mockResolvedValueOnce({
      ...participant,
      formSnapshot: {
        content: {
          subforms: [
            {
              key: 'subform:MANAGER',
              type: 'MANAGER',
              dimensions: [
                {
                  key: 'dimension:performance',
                  kind: 'REGULAR',
                  audience: 'LEADER',
                  name: '核心业绩',
                  weight: '100',
                  isCore: true,
                  items: [
                    {
                      key: 'item:performance:rating',
                      type: 'RATING',
                      title: '业绩评级',
                      required: true,
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      cycle: {
        ...participant.cycle,
        currentConfigVersion: {
          ...participant.cycle.currentConfigVersion,
          managerStageMode: 'WEIGHTED_RATING',
          constraintProfiles: {
            WEIGHTED_RATING: [],
            WEIGHTED_SCORE: [],
          },
        },
      },
    });
    prisma.perfEvaluationSubmission.findFirst.mockResolvedValueOnce({
      id: 102,
      reviewerOpenId: 'ou_leader',
      status: 'SUBMITTED',
      items: [
        {
          itemKey: 'item:performance:rating',
          dimensionKey: 'dimension:performance',
          rawLevel: 'A',
          rawScore: null,
        },
      ],
    });

    const result = await service.recalculate(7);

    expect(result).toMatchObject({
      mode: 'WEIGHTED_RATING',
      compositeScore: '85.00',
      initialLevel: 'A',
      stageLevel: 'A',
    });
  });
});
