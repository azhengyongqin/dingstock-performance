import { ForbiddenException } from '@nestjs/common';
import { CalibrationService } from './calibration.service';

jest.mock('../shared/database/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('../audit/audit.service', () => ({ AuditService: class {} }));
jest.mock('../participant/participant.service', () => ({
  ParticipantService: class {},
}));
jest.mock('../rbac/rbac.service', () => ({ RbacService: class {} }));
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfNotificationChannel: { BOT_DM: 'BOT_DM' },
    PerfParticipantStatus: {
      REVIEWED: 'REVIEWED',
      AI_DONE: 'AI_DONE',
      CALIBRATED: 'CALIBRATED',
    },
    PerfReviewStatus: { SUBMITTED: 'SUBMITTED' },
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
    perfParticipant: { findUnique: jest.fn(), findMany: jest.fn() },
    perfCalibration: { findMany: jest.fn(), create: jest.fn() },
    larkUser: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const tx = {
    perfParticipant: { findUnique: jest.fn() },
    perfCalibration: { findMany: jest.fn(), create: jest.fn() },
    larkUser: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const audit = { record: jest.fn() };
  const participantService = { transition: jest.fn() };
  const rbac = { hasAnyRole: jest.fn(), getOrgScope: jest.fn() };
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
    service = new CalibrationService(
      prisma as never,
      audit as never,
      participantService as never,
      rbac as never,
    );
  });

  it('校准后职责转移的新 Leader 可读取敏感校准历史并追加重新校准', async () => {
    const history = await service.getHistory('ou_new_leader', 7);
    const recalibration = await service.adjust(
      'ou_new_leader',
      7,
      'A',
      '复核后调整',
    );

    expect(history.total).toBe(1);
    expect(recalibration).toMatchObject({ id: 11, afterLevel: 'A' });
    expect(tx.perfCalibration.create).toHaveBeenCalledWith({
      data: {
        participantId: 7,
        beforeLevel: 'B',
        afterLevel: 'A',
        reason: '复核后调整',
        operatorOpenId: 'ou_new_leader',
      },
    });
  });

  it('职责转移后的旧 Leader 立即失去校准历史与重新校准权限', async () => {
    await expect(service.getHistory('ou_old_leader', 7)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      service.adjust('ou_old_leader', 7, 'A', '越权调整'),
    ).rejects.toThrow(ForbiddenException);
    expect(tx.perfCalibration.create).not.toHaveBeenCalled();
  });

  it('获取行锁后读取最新职责快照，转移后的旧请求仍被拒绝', async () => {
    tx.perfParticipant.findUnique
      .mockResolvedValueOnce({
        ...participant,
        leaderOpenIdSnapshot: 'ou_other_leader',
      })
      .mockResolvedValueOnce({
        ...participant,
        leaderOpenIdSnapshot: 'ou_other_leader',
      });

    await expect(service.getHistory('ou_new_leader', 7)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      service.adjust('ou_new_leader', 7, 'A', '并发转移后的旧请求'),
    ).rejects.toThrow(ForbiddenException);
    expect(tx.perfCalibration.create).not.toHaveBeenCalled();
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

  it('AI 失败或尚未生成不阻塞已完成人工评估的参与者进入校准', async () => {
    prisma.perfParticipant.findMany.mockResolvedValue([
      { id: 7, cycleId: 1, status: 'REVIEWED' },
    ]);

    const result = await service.confirm('ou_hr', 1, [7]);

    expect(result).toEqual({ confirmed: 1, skipped: [] });
    expect(participantService.transition).toHaveBeenCalledWith(
      'ou_hr',
      7,
      'CALIBRATED',
    );
    expect(prisma.perfParticipant.findMany).toHaveBeenCalledWith({
      where: { id: { in: [7] }, cycleId: 1 },
    });
  });
});
