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
      schemaVersion: 2,
      subforms: [
        {
          key: 'subform:peer',
          type: 'PEER',
          dimensions: [
            {
              key: 'dimension:collaboration',
              type: 'SCORING',
              audience: 'REVIEWER',
              name: '协作沟通',
              scoringMethod: 'RATING',
              weight: '60',
              isCore: true,
              fields: [
                {
                  key: 'field:comment',
                  type: 'LONG_TEXT',
                  title: '评价说明',
                  requiredRule: 'CONDITIONAL',
                  requiredLevels: ['S', 'C'],
                },
              ],
            },
            {
              key: 'dimension:growth',
              type: 'SCORING',
              audience: 'REVIEWER',
              name: '学习成长',
              scoringMethod: 'SCORE',
              weight: '40',
              isCore: false,
              fields: [],
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
      ratings,
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
  rawScore: string,
) => ({
  id,
  reviewerOpenId,
  reviewerAssignmentId: assignmentId,
  status: 'SUBMITTED',
  reviewerAssignment: { id: assignmentId, relation, status: 'SUBMITTED' },
  dimensionAnswers: [
    {
      dimensionKey: 'dimension:collaboration',
      scoringMethod: 'RATING',
      rawLevel,
      rawScore: null,
      calculationScore:
        rawLevel === 'S'
          ? '95'
          : rawLevel === 'A'
            ? '85'
            : rawLevel === 'B'
              ? '70'
              : '50',
      derivedLevel: rawLevel,
      fields: [
        {
          fieldKey: 'field:comment',
          fieldType: 'LONG_TEXT',
          value: `协作反馈 ${id}`,
        },
      ],
    },
    {
      dimensionKey: 'dimension:growth',
      scoringMethod: 'SCORE',
      rawLevel: null,
      rawScore,
      calculationScore: rawScore,
      derivedLevel:
        Number(rawScore) >= 90 ? 'S' : Number(rawScore) >= 80 ? 'A' : 'B',
      fields: [],
    },
  ],
});

describe('PeerStageResultService 新版 360°公开计算契约', () => {
  const prisma = {
    perfParticipant: { findUnique: jest.fn() },
    perfEvaluationSubmission: { findMany: jest.fn() },
    perfStageResult: { upsert: jest.fn() },
  };
  const rbac = { hasAnyRole: jest.fn(), getOrgScope: jest.fn() };
  let service: PeerStageResultService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.perfParticipant.findUnique.mockResolvedValue(participant);
    prisma.perfEvaluationSubmission.findMany.mockResolvedValue([
      submission(101, 'ou_peer_1', 11, 'PEER', 'A', '90'),
      submission(102, 'ou_peer_2', 12, 'PEER', 'C', '70'),
      submission(103, 'ou_project_owner', 13, 'PROJECT_OWNER', 'S', '100'),
    ]);
    prisma.perfStageResult.upsert.mockImplementation(
      ({ create }: { create: object }) => create,
    );
    rbac.hasAnyRole.mockResolvedValue(false);
    rbac.getOrgScope.mockResolvedValue([]);
    service = new PeerStageResultService(prisma as never, rbac as never);
  });

  it('先关系内平均，再有效关系归一化、关系加权，最后按混合维度占比加权', async () => {
    const result = await service.recalculate(7);

    expect(result).toMatchObject({
      status: 'READY',
      reviewerCount: 3,
      compositeScore: '85.86',
      initialLevel: 'A',
      stageLevel: 'A',
      dimensions: [
        {
          id: 'dimension:collaboration',
          scoringMethod: 'RATING',
          score: '82.5',
          relations: [
            {
              type: 'PROJECT_OWNER',
              score: '95',
              effectiveWeight: '54.54545454545454545454545454545454545455',
            },
            {
              type: 'PEER',
              score: '67.5',
              effectiveWeight: '45.45454545454545454545454545454545454545',
            },
          ],
        },
        {
          id: 'dimension:growth',
          scoringMethod: 'SCORE',
          score: '90.90909090909090909090909090909090909091',
        },
      ],
    });
    expect(prisma.perfEvaluationSubmission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          dimensionAnswers: expect.objectContaining({
            include: { fields: true },
          }),
        }),
      }),
    );
    expect(prisma.perfStageResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ compositeScore: '85.86' }),
      }),
    );
  });

  it('实名详情只投影新版维度回答和字段回答，草稿不进入生效结果', async () => {
    prisma.perfEvaluationSubmission.findMany.mockResolvedValueOnce([
      submission(101, 'ou_peer_1', 11, 'PEER', 'A', '90'),
      submission(102, 'ou_peer_2', 12, 'PEER', 'C', '70'),
      submission(103, 'ou_project_owner', 13, 'PROJECT_OWNER', 'S', '100'),
      {
        ...submission(104, 'ou_peer_1', 11, 'PEER', 'B', '60'),
        status: 'DRAFT',
      },
    ]);

    const result = await service.recalculate(7);

    expect(result.analysis.reviewers[0]).toMatchObject({
      submissionId: 101,
      reviewerOpenId: 'ou_peer_1',
      dimensions: [
        {
          id: 'dimension:collaboration',
          rawLevel: 'A',
          mappedLevel: 'A',
          fields: [
            {
              fieldKey: 'field:comment',
              title: '评价说明',
              type: 'LONG_TEXT',
              value: '协作反馈 101',
            },
          ],
        },
        {
          id: 'dimension:growth',
          rawScore: '90',
          mappedLevel: 'S',
          fields: [],
        },
      ],
    });
    expect(result.analysis.reviewers).toHaveLength(3);
    expect(result.analysis.dimensions).toEqual([
      expect.objectContaining({
        id: 'dimension:collaboration',
        distribution: { S: 1, A: 1, B: 0, C: 1 },
      }),
      expect.objectContaining({
        id: 'dimension:growth',
        distribution: { S: 2, A: 0, B: 1, C: 0 },
      }),
    ]);
  });

  it('没有正式提交时持久化 NO_DATA，不把草稿当零分或默认等级', async () => {
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
        ...submission(201, 'ou_peer_1', 11, 'PEER', 'C', '10'),
        status: 'DRAFT',
        reviewerAssignment: { id: 11, relation: 'PEER', status: 'PENDING' },
      },
    ]);

    const result = await service.recalculate(7);

    expect(result).toMatchObject({
      status: 'NO_DATA',
      reviewerCount: 0,
      compositeScore: null,
      stageLevel: null,
      inputSummary: {
        submittedReviewerCount: 0,
        draftReviewerCount: 1,
        excludedPendingReviewerCount: 1,
      },
    });
  });

  it('考核 Leader 和授权范围内 HR 可读，普通员工及越权 HR 不可读', async () => {
    await expect(service.getForManager('ou_leader', 7)).resolves.toMatchObject({
      status: 'READY',
    });
    expect(rbac.hasAnyRole).not.toHaveBeenCalled();

    await expect(service.getForManager('ou_employee', 7)).rejects.toThrow(
      ForbiddenException,
    );

    rbac.hasAnyRole.mockResolvedValue(true);
    rbac.getOrgScope.mockResolvedValue(['od_product']);
    await expect(service.getForManager('ou_hr', 7)).resolves.toMatchObject({
      status: 'READY',
    });
    expect(rbac.hasAnyRole).toHaveBeenLastCalledWith('ou_hr', ['HR', 'ADMIN']);

    rbac.hasAnyRole.mockResolvedValue(true);
    rbac.getOrgScope.mockResolvedValue(['od_other']);
    await expect(service.getForManager('ou_hr', 7)).rejects.toThrow(
      ForbiddenException,
    );
  });
});
