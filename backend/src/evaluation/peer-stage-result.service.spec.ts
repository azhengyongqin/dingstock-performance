import { ForbiddenException } from '@nestjs/common';
import { PeerStageResultService } from './peer-stage-result.service';

jest.mock(
  '../generated/prisma/client',
  () => ({ PrismaClient: class {}, Prisma: {} }),
  { virtual: true },
);
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfAssignmentStatus: {
      PENDING: 'PENDING',
      SUBMITTED: 'SUBMITTED',
      REPLACED: 'REPLACED',
    },
    PerfEvaluationTaskType: { PEER: 'PEER' },
    PerfReviewStatus: { DRAFT: 'DRAFT', SUBMITTED: 'SUBMITTED' },
    PerfRole: { HR: 'HR', ADMIN: 'ADMIN' },
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
  employeeOpenId: 'ou_employee',
  leaderOpenIdSnapshot: 'ou_leader',
  departmentIdSnapshot: 'od_product',
  formSnapshotId: 88,
  formSnapshot: {
    content: {
      subforms: [
        {
          key: 'subform:PEER',
          type: 'PEER',
          dimensions: [
            {
              key: 'dimension:collaboration',
              kind: 'REGULAR',
              audience: 'REVIEWER',
              name: '协作沟通',
              weight: '100',
              isCore: true,
              items: [
                {
                  key: 'item:collaboration:rating',
                  type: 'RATING',
                  title: '协作表现',
                  required: true,
                },
                {
                  key: 'item:collaboration:comment',
                  type: 'LONG_TEXT',
                  title: '协作评语',
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
    id: 1,
    deletedAt: null,
    currentConfigVersionId: 3,
    currentConfigVersion: {
      id: 3,
      peerStageMode: 'WEIGHTED_RATING',
      ratings,
      constraintProfiles: { WEIGHTED_RATING: [], WEIGHTED_SCORE: [] },
      orgOwnerWeight: '30',
      projectOwnerWeight: '30',
      peerWeight: '25',
      crossDeptWeight: '15',
    },
  },
  reviewerAssignments: [
    {
      id: 11,
      reviewerOpenId: 'ou_peer_1',
      relation: 'PEER',
      status: 'SUBMITTED',
    },
    {
      id: 12,
      reviewerOpenId: 'ou_peer_2',
      relation: 'PEER',
      status: 'SUBMITTED',
    },
    {
      id: 13,
      reviewerOpenId: 'ou_project_owner',
      relation: 'PROJECT_OWNER',
      status: 'SUBMITTED',
    },
  ],
};

const submission = (
  id: number,
  reviewerOpenId: string,
  assignmentId: number,
  relation: 'PEER' | 'PROJECT_OWNER',
  rawLevel: 'S' | 'A' | 'B' | 'C',
) => ({
  id,
  reviewerOpenId,
  reviewerAssignmentId: assignmentId,
  status: 'SUBMITTED',
  reviewerAssignment: { id: assignmentId, relation, status: 'SUBMITTED' },
  items: [
    {
      itemKey: 'item:collaboration:rating',
      dimensionKey: 'dimension:collaboration',
      itemType: 'RATING',
      rawLevel,
      rawScore: null,
      calculationScore:
        rawLevel === 'S' ? '95' : rawLevel === 'A' ? '85' : '50',
    },
    {
      itemKey: 'item:collaboration:comment',
      dimensionKey: 'dimension:collaboration',
      itemType: 'LONG_TEXT',
      rawLevel: null,
      rawScore: null,
      calculationScore: null,
      value: `协作反馈 ${id}`,
    },
  ],
});

describe('PeerStageResultService 公开计算契约', () => {
  const prisma = {
    perfParticipant: { findUnique: jest.fn() },
    perfEvaluationSubmission: { findMany: jest.fn() },
    perfStageResult: { upsert: jest.fn(), findUnique: jest.fn() },
  };
  const rbac = { hasAnyRole: jest.fn(), getOrgScope: jest.fn() };
  let service: PeerStageResultService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.perfParticipant.findUnique.mockResolvedValue(participant);
    prisma.perfEvaluationSubmission.findMany.mockResolvedValue([
      submission(101, 'ou_peer_1', 11, 'PEER', 'A'),
      submission(102, 'ou_peer_2', 12, 'PEER', 'C'),
      submission(103, 'ou_project_owner', 13, 'PROJECT_OWNER', 'S'),
    ]);
    prisma.perfStageResult.upsert.mockImplementation(
      ({ create }: { create: object }) => create,
    );
    rbac.hasAnyRole.mockResolvedValue(false);
    rbac.getOrgScope.mockResolvedValue([]);
    service = new PeerStageResultService(prisma as never, rbac as never);
  });

  it('同关系先做算术平均，再把项目负责人 30% 与同部门同事 25% 精确归一化', async () => {
    const result = await service.recalculate(7);

    expect(result).toMatchObject({
      status: 'READY',
      reviewerCount: 3,
      compositeScore: '82.50',
      initialLevel: 'A',
      stageLevel: 'A',
      validRelations: [
        {
          relation: 'PROJECT_OWNER',
          baseWeight: '30',
          adjustedWeight: '54.54545454545454545454545454545454545455',
          reviewerCount: 1,
          dimensionScores: [
            { dimensionKey: 'dimension:collaboration', score: '95' },
          ],
        },
        {
          relation: 'PEER',
          baseWeight: '25',
          adjustedWeight: '45.45454545454545454545454545454545454545',
          reviewerCount: 2,
          dimensionScores: [
            { dimensionKey: 'dimension:collaboration', score: '67.5' },
          ],
        },
      ],
    });
    expect(prisma.perfStageResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          participantId_stage_cycleConfigVersionId: {
            participantId: 7,
            stage: 'PEER',
            cycleConfigVersionId: 3,
          },
        },
        create: expect.objectContaining({
          dimensions: {
            create: [
              expect.objectContaining({
                dimensionKey: 'dimension:collaboration',
                score: '82.5',
                level: 'A',
                relationAggregates: {
                  create: [
                    expect.objectContaining({
                      relation: 'PROJECT_OWNER',
                      reviewerCount: 1,
                      score: '95',
                    }),
                    expect.objectContaining({
                      relation: 'PEER',
                      reviewerCount: 2,
                      score: '67.5',
                    }),
                  ],
                },
              }),
            ],
          },
        }),
      }),
    );
  });

  it('只用当前生效答卷生成关系构成、维度分布和实名下钻明细', async () => {
    prisma.perfEvaluationSubmission.findMany.mockResolvedValueOnce([
      submission(101, 'ou_peer_1', 11, 'PEER', 'A'),
      submission(102, 'ou_peer_2', 12, 'PEER', 'C'),
      submission(103, 'ou_project_owner', 13, 'PROJECT_OWNER', 'S'),
      {
        ...submission(104, 'ou_peer_1', 11, 'PEER', 'B'),
        status: 'DRAFT',
      },
    ]);

    const result = await service.recalculate(7);

    expect(result.analysis).toEqual({
      assignedReviewerCount: 3,
      submittedReviewerCount: 3,
      relationCounts: [
        { relation: 'PROJECT_OWNER', reviewerCount: 1 },
        { relation: 'PEER', reviewerCount: 2 },
      ],
      dimensions: [
        {
          id: 'dimension:collaboration',
          name: '协作沟通',
          score: '82.5',
          level: 'A',
          distribution: { S: 1, A: 1, B: 0, C: 1 },
        },
      ],
      reviewers: [
        {
          submissionId: 101,
          reviewerOpenId: 'ou_peer_1',
          relation: 'PEER',
          dimensions: [
            {
              id: 'dimension:collaboration',
              name: '协作沟通',
              rawLevel: 'A',
              rawScore: null,
              mappedLevel: 'A',
              items: [
                {
                  itemKey: 'item:collaboration:rating',
                  title: '协作表现',
                  type: 'RATING',
                  rawLevel: 'A',
                  rawScore: null,
                  value: null,
                },
                {
                  itemKey: 'item:collaboration:comment',
                  title: '协作评语',
                  type: 'LONG_TEXT',
                  rawLevel: null,
                  rawScore: null,
                  value: '协作反馈 101',
                },
              ],
            },
          ],
        },
        expect.objectContaining({
          submissionId: 102,
          reviewerOpenId: 'ou_peer_2',
        }),
        expect.objectContaining({
          submissionId: 103,
          reviewerOpenId: 'ou_project_owner',
        }),
      ],
    });
  });

  it('全部只有草稿时持久化明确 NO_DATA，不合成零分或默认等级', async () => {
    prisma.perfParticipant.findUnique.mockResolvedValueOnce({
      ...participant,
      reviewerAssignments: [
        {
          id: 11,
          reviewerOpenId: 'ou_peer_1',
          relation: 'PEER',
          status: 'PENDING',
        },
      ],
    });
    prisma.perfEvaluationSubmission.findMany.mockResolvedValueOnce([
      {
        ...submission(201, 'ou_peer_1', 11, 'PEER', 'C'),
        status: 'DRAFT',
        reviewerAssignment: { id: 11, relation: 'PEER', status: 'PENDING' },
      },
    ]);

    const result = await service.recalculate(7);

    expect(result).toMatchObject({
      status: 'NO_DATA',
      reviewerCount: 0,
      compositeScore: null,
      initialLevel: null,
      stageLevel: null,
      validRelations: [],
      inputSummary: {
        assignedReviewerCount: 1,
        submittedReviewerCount: 0,
        draftReviewerCount: 1,
        excludedPendingReviewerCount: 1,
        effectiveSubmissions: [],
        excludedAssignments: [
          {
            assignmentId: 11,
            reviewerOpenId: 'ou_peer_1',
            relation: 'PEER',
            status: 'PENDING',
            hasDraft: true,
            reason: 'NO_EFFECTIVE_SUBMISSION',
          },
        ],
      },
    });
  });

  it('单一有效关系放大为 100%，未提交更新草稿和其他待提交人均不计分', async () => {
    prisma.perfParticipant.findUnique.mockResolvedValueOnce({
      ...participant,
      reviewerAssignments: [
        {
          id: 11,
          reviewerOpenId: 'ou_peer_1',
          relation: 'PEER',
          status: 'SUBMITTED',
        },
        {
          id: 12,
          reviewerOpenId: 'ou_peer_2',
          relation: 'PEER',
          status: 'PENDING',
        },
      ],
    });
    prisma.perfEvaluationSubmission.findMany.mockResolvedValueOnce([
      submission(301, 'ou_peer_1', 11, 'PEER', 'A'),
      {
        ...submission(302, 'ou_peer_1', 11, 'PEER', 'C'),
        status: 'DRAFT',
      },
    ]);

    const result = await service.recalculate(7);

    expect(result).toMatchObject({
      reviewerCount: 1,
      compositeScore: '85.00',
      validRelations: [
        {
          relation: 'PEER',
          adjustedWeight: '100',
          reviewerCount: 1,
          dimensionScores: [{ score: '85' }],
        },
      ],
      inputSummary: {
        assignedReviewerCount: 2,
        submittedReviewerCount: 1,
        draftReviewerCount: 1,
        excludedPendingReviewerCount: 1,
      },
    });
  });

  it('评分模式保留小数关系权重，中间过程不提前舍入', async () => {
    prisma.perfParticipant.findUnique.mockResolvedValueOnce({
      ...participant,
      cycle: {
        ...participant.cycle,
        currentConfigVersion: {
          ...participant.cycle.currentConfigVersion,
          peerStageMode: 'WEIGHTED_SCORE',
          orgOwnerWeight: '33.33',
          projectOwnerWeight: '0.01',
          peerWeight: '0.01',
          crossDeptWeight: '66.65',
        },
      },
      formSnapshot: {
        content: {
          subforms: [
            {
              key: 'subform:PEER',
              type: 'PEER',
              dimensions: [
                {
                  key: 'dimension:collaboration',
                  kind: 'REGULAR',
                  audience: 'REVIEWER',
                  name: '协作沟通',
                  weight: '100',
                  isCore: true,
                  items: [
                    {
                      key: 'item:collaboration:score',
                      type: 'SCORE',
                      title: '协作得分',
                      required: true,
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      reviewerAssignments: [
        {
          id: 21,
          reviewerOpenId: 'ou_org',
          relation: 'ORG_OWNER',
          status: 'SUBMITTED',
        },
        {
          id: 22,
          reviewerOpenId: 'ou_cross',
          relation: 'CROSS_DEPT',
          status: 'SUBMITTED',
        },
      ],
    });
    prisma.perfEvaluationSubmission.findMany.mockResolvedValueOnce([
      {
        id: 401,
        reviewerOpenId: 'ou_org',
        status: 'SUBMITTED',
        reviewerAssignment: {
          id: 21,
          relation: 'ORG_OWNER',
          status: 'SUBMITTED',
        },
        items: [
          {
            itemKey: 'item:collaboration:score',
            dimensionKey: 'dimension:collaboration',
            itemType: 'SCORE',
            rawLevel: null,
            rawScore: '80',
            calculationScore: '80',
          },
        ],
      },
      {
        id: 402,
        reviewerOpenId: 'ou_cross',
        status: 'SUBMITTED',
        reviewerAssignment: {
          id: 22,
          relation: 'CROSS_DEPT',
          status: 'SUBMITTED',
        },
        items: [
          {
            itemKey: 'item:collaboration:score',
            dimensionKey: 'dimension:collaboration',
            itemType: 'SCORE',
            rawLevel: null,
            rawScore: '90',
            calculationScore: '90',
          },
        ],
      },
    ]);

    const result = await service.recalculate(7);

    expect(result).toMatchObject({
      mode: 'WEIGHTED_SCORE',
      compositeScore: '86.67',
      analysis: {
        dimensions: [
          {
            id: 'dimension:collaboration',
            distribution: { S: 1, A: 1, B: 0, C: 0 },
          },
        ],
        reviewers: [
          { reviewerOpenId: 'ou_org', dimensions: [{ mappedLevel: 'A' }] },
          { reviewerOpenId: 'ou_cross', dimensions: [{ mappedLevel: 'S' }] },
        ],
      },
      validRelations: [
        {
          relation: 'ORG_OWNER',
          adjustedWeight: '33.33666733346669333866773354670934186837',
        },
        {
          relation: 'CROSS_DEPT',
          adjustedWeight: '66.66333266653330666133226645329065813163',
        },
      ],
    });
  });

  it('把周期约束配置交给共享引擎并持久化约束原因', async () => {
    prisma.perfParticipant.findUnique.mockResolvedValueOnce({
      ...participant,
      reviewerAssignments: [participant.reviewerAssignments[0]],
      cycle: {
        ...participant.cycle,
        currentConfigVersion: {
          ...participant.cycle.currentConfigVersion,
          constraintProfiles: {
            WEIGHTED_RATING: [
              {
                id: 'core-a-cap-b',
                type: 'CORE_RATING_CAP',
                triggerRating: 'A',
                targetLevel: 'B',
                enabled: true,
              },
            ],
            WEIGHTED_SCORE: [],
          },
        },
      },
    });
    prisma.perfEvaluationSubmission.findMany.mockResolvedValueOnce([
      submission(501, 'ou_peer_1', 11, 'PEER', 'A'),
    ]);

    const result = await service.recalculate(7);

    expect(result.stageLevel).toBe('B');
    expect(result.constraintReasons).toEqual([
      expect.objectContaining({
        id: 'core-a-cap-b',
        beforeLevel: 'A',
        afterLevel: 'B',
      }),
    ]);
  });

  it('考核 Leader 可读取实名管理视角结果，普通员工不可越权读取', async () => {
    const result = await service.getForManager('ou_leader', 7);

    expect(result.status).toBe('READY');
    expect(rbac.hasAnyRole).not.toHaveBeenCalled();

    await expect(service.getForManager('ou_employee', 7)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('受限 HR 只能读取授权组织范围内的阶段结果', async () => {
    rbac.hasAnyRole.mockResolvedValue(true);
    rbac.getOrgScope.mockResolvedValue(['od_other']);

    await expect(service.getForManager('ou_hr', 7)).rejects.toThrow(
      ForbiddenException,
    );
  });
});
