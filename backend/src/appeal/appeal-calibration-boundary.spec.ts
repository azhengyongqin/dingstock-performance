import { AppealService } from './appeal.service';

jest.mock('../shared/database/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('../audit/audit.service', () => ({ AuditService: class {} }));
jest.mock('../participant/participant.service', () => ({
  ParticipantService: class {},
}));
jest.mock('../calibration/calibration.service', () => ({
  CalibrationService: class {},
}));
jest.mock('../rbac/rbac.service', () => ({ RbacService: class {} }));
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfAppealStatus: { PENDING: 'PENDING', RESOLVED: 'RESOLVED' },
    PerfInterviewType: { APPEAL: 'APPEAL', OPTIONAL: 'OPTIONAL' },
    PerfNotificationChannel: { BOT_DM: 'BOT_DM' },
    PerfParticipantStatus: {
      APPEALING: 'APPEALING',
      RE_CONFIRMING: 'RE_CONFIRMING',
      RESULT_PUSHED: 'RESULT_PUSHED',
    },
    PerfRole: { HR: 'HR', ADMIN: 'ADMIN' },
  }),
  { virtual: true },
);

describe('AppealService Ticket 13 校准边界', () => {
  it('旧申诉接口不能在缺少校准双修订时直接调整等级', async () => {
    const prisma = {
      perfAppeal: {
        findUnique: jest.fn().mockResolvedValue({
          id: 31,
          participantId: 7,
          status: 'PENDING',
          participant: {
            employeeOpenId: 'ou_employee',
            result: { id: 21, finalLevel: 'B' },
          },
        }),
      },
      perfResult: { update: jest.fn() },
      $transaction: jest.fn(),
    };
    const calibration = { adjust: jest.fn(), history: jest.fn() };
    const service = new AppealService(
      prisma as never,
      { record: jest.fn() } as never,
      { transition: jest.fn() } as never,
      calibration as never,
      { hasAnyRole: jest.fn() } as never,
    );

    await expect(
      service.resolve('ou_hr', 31, {
        conclusion: '调整为 A',
        adjustedLevel: 'A',
        reason: '申诉成立',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'APPEAL_ADJUSTMENT_REQUIRES_CALIBRATION_DECISION',
      }),
    });
    expect(calibration.adjust).not.toHaveBeenCalled();
    expect(prisma.perfResult.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
