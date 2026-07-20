import { DashboardService } from './dashboard.service';

jest.mock('../shared/database/prisma.service', () => ({
  PrismaService: class {},
}));

jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfAppealStatus: { RESOLVED: 'RESOLVED' },
    PerfAssignmentStatus: {
      PENDING: 'PENDING',
      SUBMITTED: 'SUBMITTED',
      REPLACED: 'REPLACED',
    },
    PerfEvaluationTaskType: {
      SELF: 'SELF',
      PEER: 'PEER',
      MANAGER: 'MANAGER',
      AI: 'AI',
    },
    PerfParticipantStatus: {},
    PerfReviewStatus: {
      DRAFT: 'DRAFT',
      SUBMITTED: 'SUBMITTED',
      INVALIDATED: 'INVALIDATED',
    },
    PerfRole: { HR: 'HR', ADMIN: 'ADMIN' },
  }),
  { virtual: true },
);

type Submission = { stage: 'SELF' | 'MANAGER'; status: 'DRAFT' | 'SUBMITTED' };

const member = (id: number, evaluationSubmissions: Submission[]) => ({
  id,
  employeeOpenId: `ou_employee_${id}`,
  status: 'ACTIVE',
  evaluationSubmissions,
  stageResults: [],
  reviewerAssignments: [],
  resultVersions: [],
});

describe('DashboardService Leader 团队看板', () => {
  const prisma = {
    perfCycle: { findUnique: jest.fn(), findFirst: jest.fn() },
    perfParticipant: { findMany: jest.fn(), findFirst: jest.fn() },
    perfResultVersion: { findMany: jest.fn() },
    larkUser: { findMany: jest.fn(), findUnique: jest.fn() },
  };
  const rbacService = { hasAnyRole: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.perfParticipant.findMany.mockResolvedValue([
      member(1, []),
      member(2, [{ stage: 'MANAGER', status: 'DRAFT' }]),
      member(3, [{ stage: 'MANAGER', status: 'SUBMITTED' }]),
      member(4, [
        { stage: 'MANAGER', status: 'SUBMITTED' },
        { stage: 'MANAGER', status: 'DRAFT' },
      ]),
    ]);
    prisma.larkUser.findMany.mockResolvedValue([]);
    prisma.perfCycle.findUnique.mockResolvedValue({
      id: 9,
      name: '2026 上半年绩效',
      status: 'ACTIVE',
    });
  });

  it('区分未开始、草稿、已提交和待重新提交，同时保留生效提交状态', async () => {
    const service = new DashboardService(prisma as never, rbacService as never);

    const result = await service.teamDashboard('ou_leader', 9);

    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          participantId: 1,
          managerEvaluationState: 'NOT_STARTED',
          managerSubmissionStatus: null,
        }),
        expect.objectContaining({
          participantId: 2,
          managerEvaluationState: 'DRAFT',
          managerSubmissionStatus: null,
        }),
        expect.objectContaining({
          participantId: 3,
          managerEvaluationState: 'EFFECTIVE',
          managerSubmissionStatus: 'SUBMITTED',
        }),
        expect.objectContaining({
          participantId: 4,
          managerEvaluationState: 'PENDING_RESUBMIT',
          managerSubmissionStatus: 'SUBMITTED',
        }),
      ]),
    );
  });

  it('个人历史仅返回旧晋升内容的安全文本摘要', async () => {
    prisma.larkUser.findUnique.mockResolvedValue({
      open_id: 'ou_employee',
      name: '员工甲',
    });
    prisma.perfResultVersion.findMany.mockResolvedValue([
      {
        finalLevel: 'A',
        resultSnapshot: {
          promotion: {
            visible: true,
            items: [
              { title: '晋升陈述', value: '历史可见内容', internalId: 101 },
              { title: '审批结论', value: '建议晋升' },
            ],
            privateComment: '内部敏感评语',
          },
        },
        confirmedAt: null,
        participant: {
          cycle: {
            id: 1,
            name: '2025 下半年绩效',
            plannedStartAt: new Date('2025-07-01T00:00:00.000Z'),
          },
        },
      },
      {
        finalLevel: 'B',
        resultSnapshot: { promotion: '历史已投影结论' },
        confirmedAt: null,
        participant: {
          cycle: {
            id: 2,
            name: '2025 上半年绩效',
            plannedStartAt: new Date('2025-01-01T00:00:00.000Z'),
          },
        },
      },
      {
        finalLevel: 'B',
        resultSnapshot: {
          promotion: {
            visible: false,
            items: [{ title: '内部结论', value: '不应展示' }],
          },
        },
        confirmedAt: null,
        participant: {
          cycle: {
            id: 3,
            name: '2024 下半年绩效',
            plannedStartAt: new Date('2024-07-01T00:00:00.000Z'),
          },
        },
      },
      {
        finalLevel: 'C',
        resultSnapshot: {
          promotion: { privateComment: '未知内部结构' },
        },
        confirmedAt: null,
        participant: {
          cycle: {
            id: 4,
            name: '2024 上半年绩效',
            plannedStartAt: new Date('2024-01-01T00:00:00.000Z'),
          },
        },
      },
    ]);
    const service = new DashboardService(prisma as never, rbacService as never);

    const result = await service.profile('ou_employee', 'ou_employee');

    expect(result.items.map((item) => item.promotionResult)).toEqual([
      '晋升陈述：历史可见内容；审批结论：建议晋升',
      '历史已投影结论',
      null,
      null,
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /internalId|privateComment|内部敏感|未知内部/,
    );
  });
});
