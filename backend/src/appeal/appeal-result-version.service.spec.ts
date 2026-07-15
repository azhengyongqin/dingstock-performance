import { ConflictException, ForbiddenException } from '@nestjs/common';
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
jest.mock('../calibration/result.service', () => ({
  ResultService: class {},
}));
jest.mock('../rbac/rbac.service', () => ({ RbacService: class {} }));
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfAppealStatus: {
      PENDING: 'PENDING',
      IN_INTERVIEW: 'IN_INTERVIEW',
      RESOLVED: 'RESOLVED',
    },
    PerfInterviewType: { APPEAL: 'APPEAL', OPTIONAL: 'OPTIONAL' },
    PerfParticipantStatus: {
      RESULT_PUBLISHED: 'RESULT_PUBLISHED',
      APPEALING: 'APPEALING',
      RE_CONFIRMING: 'RE_CONFIRMING',
    },
    PerfRole: { HR: 'HR', ADMIN: 'ADMIN' },
  }),
  { virtual: true },
);

describe('AppealService 结果版本申诉链', () => {
  const tx = {
    $queryRaw: jest.fn(),
    perfParticipant: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    perfAppeal: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    perfInterview: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
    perfAppeal: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    larkUser: { findMany: jest.fn() },
  };
  const audit = { record: jest.fn() };
  const calibration = { history: jest.fn() };
  const result = { resolveAppeal: jest.fn() };
  const rbac = { hasAnyRole: jest.fn(), getOrgScope: jest.fn() };
  let service: AppealService;

  beforeEach(() => {
    jest.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([{ id: 7 }]);
    tx.perfParticipant.findUnique.mockResolvedValue({
      id: 7,
      cycleId: 1,
      employeeOpenId: 'ou_employee',
      leaderOpenIdSnapshot: 'ou_leader',
      departmentIdSnapshot: 'od_product',
      status: 'RESULT_PUBLISHED',
      resultVersions: [
        { id: 41, version: 1, supersededAt: null, confirmedAt: null },
      ],
      appeals: [],
    });
    tx.perfAppeal.create.mockResolvedValue({
      id: 51,
      participantId: 7,
      resultVersionId: 41,
      status: 'PENDING',
    });
    tx.perfAppeal.updateMany.mockResolvedValue({ count: 1 });
    tx.perfInterview.create.mockResolvedValue({ id: 61, appealId: 51 });
    prisma.perfAppeal.findMany.mockResolvedValue([]);
    prisma.larkUser.findMany.mockResolvedValue([]);
    rbac.hasAnyRole.mockResolvedValue(false);
    rbac.getOrgScope.mockResolvedValue([]);
    service = new AppealService(
      prisma as never,
      audit as never,
      calibration as never,
      result as never,
      rbac as never,
    );
  });

  it('员工只能用当前未确认结果版本发起一次申诉，并在同一事务绑定版本和进入 APPEALING', async () => {
    await expect(
      service.create('ou_employee', 7, 41, '等级与事实不符', [
        { fileToken: 'box_1' },
      ]),
    ).resolves.toMatchObject({ id: 51, resultVersionId: 41 });

    expect(tx.perfAppeal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        participantId: 7,
        resultVersionId: 41,
        reason: '等级与事实不符',
        attachments: [{ fileToken: 'box_1' }],
      }),
    });
    expect(tx.perfParticipant.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { status: 'APPEALING' },
    });
  });

  it('拒绝过期结果版本和二次申诉', async () => {
    await expect(
      service.create('ou_employee', 7, 40, '旧页面申诉'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RESULT_VERSION_STALE' }),
    });

    tx.perfParticipant.findUnique.mockResolvedValue({
      id: 7,
      cycleId: 1,
      employeeOpenId: 'ou_employee',
      status: 'RESULT_PUBLISHED',
      resultVersions: [
        { id: 41, version: 1, supersededAt: null, confirmedAt: null },
      ],
      appeals: [{ id: 50, status: 'RESOLVED' }],
    });
    await expect(
      service.create('ou_employee', 7, 41, '再次申诉'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('同级处理原子关闭申诉，保留原版本且不发送新通知', async () => {
    tx.perfAppeal.findUnique.mockResolvedValue({
      id: 51,
      participantId: 7,
      resultVersionId: 41,
      status: 'PENDING',
      participant: {
        id: 7,
        cycleId: 1,
        employeeOpenId: 'ou_employee',
        leaderOpenIdSnapshot: 'ou_leader',
        departmentIdSnapshot: 'od_product',
      },
    });
    result.resolveAppeal.mockResolvedValue({
      changed: false,
      resultVersionId: 41,
      resolutionCalibrationId: 32,
    });

    await expect(
      service.resolve('ou_leader', 51, {
        conclusion: '维持原结果',
        expectedCalibrationRevision: 32,
      }),
    ).resolves.toEqual({
      ok: true,
      resultAdjusted: false,
      resultVersionId: 41,
    });

    expect(result.resolveAppeal).toHaveBeenCalledWith(
      expect.objectContaining({ appealId: 51, appealedResultVersionId: 41 }),
      tx,
    );
    expect(tx.perfAppeal.updateMany).toHaveBeenCalledWith({
      where: { id: 51, status: { not: 'RESOLVED' } },
      data: expect.objectContaining({
        status: 'RESOLVED',
        resultAdjusted: false,
        resolutionCalibrationId: 32,
      }),
    });
  });

  it('变级处理发布新版本并进入再次确认；并发第二次处理被条件更新拒绝', async () => {
    tx.perfAppeal.findUnique.mockResolvedValue({
      id: 51,
      participantId: 7,
      resultVersionId: 41,
      status: 'IN_INTERVIEW',
      participant: {
        id: 7,
        cycleId: 1,
        employeeOpenId: 'ou_employee',
        leaderOpenIdSnapshot: 'ou_leader',
        departmentIdSnapshot: 'od_product',
      },
    });
    result.resolveAppeal.mockResolvedValue({
      changed: true,
      resultVersionId: 42,
      resolutionCalibrationId: 33,
    });

    await expect(
      service.resolve('ou_leader', 51, {
        conclusion: '改判为 A',
        expectedCalibrationRevision: 33,
      }),
    ).resolves.toMatchObject({
      resultAdjusted: true,
      resultVersionId: 42,
    });

    tx.perfAppeal.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.resolve('ou_leader', 51, {
        conclusion: '重复处理',
        expectedCalibrationRevision: 33,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('旧 Leader 和越过组织范围的 HR 都不能处理申诉', async () => {
    tx.perfAppeal.findUnique.mockResolvedValue({
      id: 51,
      participantId: 7,
      resultVersionId: 41,
      status: 'PENDING',
      participant: {
        id: 7,
        cycleId: 1,
        employeeOpenId: 'ou_employee',
        leaderOpenIdSnapshot: 'ou_current_leader',
        departmentIdSnapshot: 'od_product',
      },
    });

    await expect(
      service.resolve('ou_old_leader', 51, {
        conclusion: '越权处理',
        expectedCalibrationRevision: 31,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    rbac.hasAnyRole.mockResolvedValue(true);
    rbac.getOrgScope.mockResolvedValue(['od_sales']);
    await expect(
      service.resolve('ou_hr', 51, {
        conclusion: '跨范围处理',
        expectedCalibrationRevision: 31,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('授权组织内 HR 可以处理申诉，Admin 可以读取全局申诉列表', async () => {
    tx.perfAppeal.findUnique.mockResolvedValue({
      id: 51,
      participantId: 7,
      resultVersionId: 41,
      status: 'PENDING',
      participant: {
        id: 7,
        employeeOpenId: 'ou_employee',
        leaderOpenIdSnapshot: 'ou_current_leader',
        departmentIdSnapshot: 'od_product',
      },
    });
    rbac.hasAnyRole.mockResolvedValue(true);
    rbac.getOrgScope.mockResolvedValue(['od_product']);
    result.resolveAppeal.mockResolvedValue({
      changed: false,
      resultVersionId: 41,
      resolutionCalibrationId: 31,
    });

    await expect(
      service.resolve('ou_hr', 51, {
        conclusion: '维持原结果',
        expectedCalibrationRevision: 31,
      }),
    ).resolves.toMatchObject({ resultAdjusted: false });

    rbac.getOrgScope.mockResolvedValue(null);
    await service.list('ou_admin', { cycleId: 1 });
    expect(prisma.perfAppeal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: undefined, participant: { cycleId: 1 } },
      }),
    );
  });

  it('员工申诉详情使用字段白名单，不泄露组织快照或内部校准修订', async () => {
    prisma.perfAppeal.findUnique.mockResolvedValue({
      id: 51,
      participantId: 7,
      resultVersionId: 41,
      reason: '等级与事实不符',
      attachments: null,
      status: 'PENDING',
      handlerOpenId: 'ou_hr',
      conclusion: null,
      resultAdjusted: false,
      resolvedAt: null,
      createdAt: new Date('2026-07-16T10:00:00.000Z'),
      updatedAt: new Date('2026-07-16T10:00:00.000Z'),
      participant: {
        id: 7,
        employeeOpenId: 'ou_employee',
        status: 'APPEALING',
        leaderOpenIdSnapshot: 'ou_secret_leader',
        departmentIdSnapshot: 'od_secret',
        cycle: { id: 1, name: '2026 上半年绩效' },
        resultVersions: [{ id: 41, version: 1, finalLevel: 'B' }],
      },
      resultVersion: { id: 41, version: 1, finalLevel: 'B' },
      resolutionCalibration: null,
      interviews: [],
    });

    const response = await service.detail('ou_employee', 51);

    expect(response).toMatchObject({
      id: 51,
      participant: { id: 7, status: 'APPEALING' },
      resultVersion: { id: 41, finalLevel: 'B' },
    });
    expect(JSON.stringify(response)).not.toMatch(
      /leaderOpenIdSnapshot|departmentIdSnapshot|ou_secret|od_secret|inputRevision|operatorOpenId/,
    );
    expect(calibration.history).not.toHaveBeenCalled();
  });

  it('面谈在聚合锁后重读到 RESOLVED 时拒绝插入', async () => {
    tx.perfAppeal.findUnique.mockResolvedValue({
      id: 51,
      participantId: 7,
      status: 'RESOLVED',
      participant: {
        leaderOpenIdSnapshot: 'ou_leader',
        departmentIdSnapshot: 'od_product',
      },
    });

    await expect(
      service.addInterview('ou_leader', 51, { content: '迟到的面谈' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.perfInterview.create).not.toHaveBeenCalled();
  });
});
