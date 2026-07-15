import { ForbiddenException } from '@nestjs/common';
import { CalibrationService } from './calibration.service';

jest.mock('../shared/database/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('../audit/audit.service', () => ({ AuditService: class {} }));
jest.mock('../rbac/rbac.service', () => ({ RbacService: class {} }));
jest.mock('../participant/participant-no-result.service', () => ({
  ParticipantNoResultService: class {},
}));
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfNotificationChannel: { BOT_DM: 'BOT_DM' },
    PerfParticipantStatus: {
      REVIEWED: 'REVIEWED',
      AI_DONE: 'AI_DONE',
      CALIBRATED: 'CALIBRATED',
      RESULT_PUSHED: 'RESULT_PUSHED',
    },
    PerfReviewStatus: { SUBMITTED: 'SUBMITTED' },
    PerfRedLineAction: { CONFIRM: 'CONFIRM', REVOKE: 'REVOKE' },
    PerfRole: { HR: 'HR', ADMIN: 'ADMIN' },
  }),
  { virtual: true },
);

describe('CalibrationService 当前考核 Leader 对象级权限', () => {
  const participant = {
    id: 7,
    leaderOpenIdSnapshot: 'ou_new_leader',
    departmentIdSnapshot: 'od_product',
    cycle: {
      deletedAt: null,
      evaluationRule: null,
    },
    managerReview: { initialLevel: 'B', status: 'SUBMITTED' },
    calibrations: [{ id: 10, afterLevel: 'B' }],
    result: { archivedAt: null },
  };
  const prisma = {
    perfCycle: { findFirst: jest.fn() },
    perfParticipant: { findUnique: jest.fn(), findMany: jest.fn() },
    perfCalibration: { findMany: jest.fn(), create: jest.fn() },
    perfResult: { upsert: jest.fn() },
    perfNotification: { create: jest.fn() },
    larkUser: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const tx = {
    perfParticipant: { findUnique: jest.fn(), update: jest.fn() },
    perfCalibration: { findMany: jest.fn(), create: jest.fn() },
    perfResult: { upsert: jest.fn() },
    perfNotification: { create: jest.fn() },
    larkUser: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const audit = { record: jest.fn() };
  const rbac = { hasAnyRole: jest.fn(), getOrgScope: jest.fn() };
  const requiredEvaluation = {
    assertCalibrationReady: jest.fn(),
    getRequiredEvaluationGates: jest.fn(),
  };
  let service: CalibrationService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.perfParticipant.findUnique.mockResolvedValue(participant);
    prisma.perfCalibration.findMany.mockResolvedValue([
      { id: 10, participantId: 7, operatorOpenId: 'ou_hr' },
    ]);
    prisma.perfCalibration.create.mockResolvedValue({
      id: 11,
      participantId: 7,
      beforeLevel: 'B',
      afterLevel: 'A',
      reason: '复核后调整',
      operatorOpenId: 'ou_new_leader',
    });
    prisma.larkUser.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(
      (fn: (client: typeof tx) => unknown) => fn(tx),
    );
    tx.$queryRaw.mockResolvedValue([{ id: 7 }]);
    tx.perfParticipant.findUnique.mockResolvedValue(participant);
    tx.perfCalibration.findMany.mockResolvedValue([
      { id: 10, participantId: 7, operatorOpenId: 'ou_hr' },
    ]);
    tx.perfCalibration.create.mockResolvedValue({
      id: 11,
      participantId: 7,
      beforeLevel: 'B',
      afterLevel: 'A',
      reason: '复核后调整',
      operatorOpenId: 'ou_new_leader',
    });
    tx.larkUser.findMany.mockResolvedValue([]);
    rbac.hasAnyRole.mockResolvedValue(false);
    rbac.getOrgScope.mockResolvedValue([]);
    requiredEvaluation.assertCalibrationReady.mockResolvedValue({
      ready: true,
      self: 'EFFECTIVE',
      manager: 'EFFECTIVE',
      blockers: [],
    });
    requiredEvaluation.getRequiredEvaluationGates.mockResolvedValue(
      new Map([
        [
          7,
          {
            ready: true,
            self: 'EFFECTIVE',
            manager: 'EFFECTIVE',
            blockers: [],
          },
        ],
      ]),
    );
    service = new CalibrationService(
      prisma as never,
      audit as never,
      rbac as never,
      requiredEvaluation as never,
    );
  });

  it('校准后职责转移的新 Leader可读取敏感校准历史', async () => {
    const history = await service.getHistory('ou_new_leader', 7);

    expect(history.total).toBe(1);
  });

  it('职责转移后的旧 Leader 立即失去校准历史权限', async () => {
    await expect(service.getHistory('ou_old_leader', 7)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('读取最新职责快照后，转移后的旧请求仍被拒绝', async () => {
    tx.perfParticipant.findUnique.mockResolvedValueOnce({
      ...participant,
      leaderOpenIdSnapshot: 'ou_other_leader',
    });

    await expect(service.getHistory('ou_new_leader', 7)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('HR 仍需满足组织授权范围，Admin/全局 HR 不受影响', async () => {
    rbac.hasAnyRole.mockResolvedValue(true);
    rbac.getOrgScope.mockResolvedValue(['od_sales']);

    await expect(service.getHistory('ou_hr', 7)).rejects.toThrow(
      ForbiddenException,
    );

    rbac.getOrgScope.mockResolvedValue(null);
    await expect(service.getHistory('ou_admin', 7)).resolves.toMatchObject({
      total: 1,
    });
  });

  it('授权校准工作台在同一参与者行返回完整 AI 参考', async () => {
    prisma.perfCycle.findFirst.mockResolvedValue({
      id: 1,
      evaluationRule: { levels: [] },
    });
    prisma.perfParticipant.findMany.mockResolvedValue([
      {
        id: 7,
        employeeOpenId: 'ou_employee',
        status: 'REVIEWED',
        isPromotionEnabled: false,
        managerReview: {
          initialLevel: 'B',
          promotionConclusion: null,
          status: 'SUBMITTED',
        },
        calibrations: [],
        redLineFindings: [
          {
            id: 501,
            findingType: 'SERIOUS_VIOLATION',
            facts: '重大违规事实',
            evidence: [{ fileToken: 'evidence' }],
            reason: '制度红线',
            operatorOpenId: 'ou_hr',
            createdAt: new Date('2026-07-15T09:00:00.000Z'),
          },
        ],
        aiReport: {
          status: 'SUCCESS',
          referenceLevel: 'A',
          summary: 'AI 参考摘要',
          highlights: [],
          improvements: [],
          promotionSummary: null,
          riskFlags: [],
          generatedAt: new Date('2026-07-15T08:00:00.000Z'),
        },
        result: null,
      },
    ]);

    const result = await service.listForCycle('ou_new_leader', 1);

    expect(result.items[0]).toMatchObject({
      aiReportStatus: 'SUCCESS',
      aiReport: {
        referenceLevel: 'A',
        summary: 'AI 参考摘要',
      },
      currentLevel: 'C',
      activeRedLineFindings: [
        expect.objectContaining({
          findingType: 'SERIOUS_VIOLATION',
          facts: '重大违规事实',
          reason: '制度红线',
        }),
      ],
      requiredEvaluations: expect.objectContaining({ ready: true }),
    });
    expect(requiredEvaluation.getRequiredEvaluationGates).toHaveBeenCalledWith([
      7,
    ]);
  });

  it('校准工作台按当前 Leader 与 HR 组织范围过滤敏感 AI 内容', async () => {
    prisma.perfCycle.findFirst.mockResolvedValue({
      id: 1,
      evaluationRule: { levels: [] },
    });
    prisma.perfParticipant.findMany.mockResolvedValue([]);
    rbac.getOrgScope.mockResolvedValue(['od_product']);

    await service.listForCycle('ou_hr', 1);

    expect(prisma.perfParticipant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          cycleId: 1,
          OR: [
            { leaderOpenIdSnapshot: 'ou_hr' },
            { departmentIdSnapshot: { in: ['od_product'] } },
          ],
        },
      }),
    );

    rbac.getOrgScope.mockResolvedValue(null);
    await service.listForCycle('ou_admin', 1);
    expect(prisma.perfParticipant.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { cycleId: 1 } }),
    );
  });
});
