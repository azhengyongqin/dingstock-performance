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
  isPromotionEnabled: false,
  evaluationSubmissions,
  stageResults: [],
  reviewerAssignments: [],
  resultVersions: [],
});

describe('DashboardService Leader 团队看板', () => {
  const prisma = {
    perfCycle: { findUnique: jest.fn(), findFirst: jest.fn() },
    perfParticipant: { findMany: jest.fn() },
    larkUser: { findMany: jest.fn() },
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
});
