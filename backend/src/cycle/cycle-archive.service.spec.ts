import { ConflictException, ForbiddenException } from '@nestjs/common';
import { CycleArchiveService } from './cycle-archive.service';

jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfAppealStatus: {
      PENDING: 'PENDING',
      IN_INTERVIEW: 'IN_INTERVIEW',
      RESOLVED: 'RESOLVED',
    },
    PerfCycleStatus: { ACTIVE: 'ACTIVE', ARCHIVED: 'ARCHIVED' },
    PerfEvaluationTaskType: { SELF: 'SELF', MANAGER: 'MANAGER' },
    PerfParticipantStatus: {
      ACTIVE: 'ACTIVE',
      CALIBRATED: 'CALIBRATED',
      RESULT_PUBLISHED: 'RESULT_PUBLISHED',
      APPEALING: 'APPEALING',
      RE_CONFIRMING: 'RE_CONFIRMING',
      CONFIRMED: 'CONFIRMED',
      NO_RESULT: 'NO_RESULT',
      WITHDRAWN: 'WITHDRAWN',
    },
    PerfReviewStatus: { SUBMITTED: 'SUBMITTED' },
    PerfRole: { HR: 'HR', ADMIN: 'ADMIN' },
  }),
  { virtual: true },
);
jest.mock('../shared/database/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('../rbac/rbac.service', () => ({ RbacService: class {} }));

describe('CycleArchiveService 周期归档', () => {
  const tx = {
    $queryRaw: jest.fn(),
    perfCycle: { findFirst: jest.fn(), updateMany: jest.fn() },
    perfCycleArchive: { create: jest.fn() },
    perfParticipant: { findMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    perfCycle: { findFirst: jest.fn() },
    perfParticipant: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const rbac = {
    isAdmin: jest.fn(),
    hasAnyRole: jest.fn(),
    getOrgScope: jest.fn(),
  };
  let service: CycleArchiveService;

  const confirmed = {
    id: 7,
    employeeOpenId: 'ou_employee',
    departmentIdSnapshot: 'od_a',
    status: 'CONFIRMED',
    evaluationSubmissions: [
      { stage: 'SELF', status: 'SUBMITTED' },
      { stage: 'MANAGER', status: 'SUBMITTED' },
    ],
    calibrations: [{ id: 31 }],
    resultVersions: [
      {
        id: 41,
        finalLevel: 'A',
        confirmedAt: new Date('2026-07-15T08:00:00Z'),
      },
    ],
    appeals: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CycleArchiveService(prisma as never, rbac as never);
    prisma.perfCycle.findFirst.mockResolvedValue({
      id: 1,
      status: 'ACTIVE',
      deletedAt: null,
    });
    prisma.perfParticipant.findMany.mockResolvedValue([
      confirmed,
      {
        ...confirmed,
        id: 8,
        employeeOpenId: 'ou_none',
        status: 'NO_RESULT',
        evaluationSubmissions: [],
        calibrations: [],
        resultVersions: [],
      },
      {
        ...confirmed,
        id: 9,
        employeeOpenId: 'ou_left',
        status: 'WITHDRAWN',
        evaluationSubmissions: [],
        calibrations: [],
        resultVersions: [],
      },
    ]);
    rbac.isAdmin.mockResolvedValue(true);
    prisma.$transaction.mockImplementation(
      (callback: (client: typeof tx) => unknown) => callback(tx),
    );
    tx.perfCycle.findFirst.mockResolvedValue({ id: 1, status: 'ACTIVE' });
    tx.perfCycle.updateMany.mockResolvedValue({ count: 1 });
    tx.perfParticipant.findMany.mockResolvedValue(
      prisma.perfParticipant.findMany(),
    );
    tx.perfCycleArchive.create.mockResolvedValue({
      id: 51,
      archivedAt: new Date('2026-07-15T09:00:00Z'),
    });
  });

  it('Admin 预览会得到关闭统计、等级分布和稳定检查修订', async () => {
    const preview = await service.preview('ou_admin', 1);

    expect(preview).toMatchObject({
      cycleId: 1,
      canArchive: true,
      summary: {
        participantCount: 3,
        confirmedCount: 1,
        noResultCount: 1,
        withdrawnCount: 1,
        levelDistribution: { A: 1 },
      },
      blockers: [],
    });
    expect(preview.revision).toMatch(/^[a-f0-9]{64}$/);
  });

  it('预览按参与者返回必交评估、结果、申诉和再次确认阻塞明细', async () => {
    prisma.perfParticipant.findMany.mockResolvedValue([
      {
        ...confirmed,
        id: 10,
        employeeOpenId: 'ou_missing',
        status: 'ACTIVE',
        evaluationSubmissions: [],
        calibrations: [],
        resultVersions: [],
      },
      {
        ...confirmed,
        id: 11,
        employeeOpenId: 'ou_calibrated',
        status: 'CALIBRATED',
        resultVersions: [],
      },
      {
        ...confirmed,
        id: 12,
        employeeOpenId: 'ou_appeal',
        status: 'APPEALING',
        resultVersions: [{ ...confirmed.resultVersions[0], confirmedAt: null }],
        appeals: [{ id: 99, status: 'IN_INTERVIEW' }],
      },
      {
        ...confirmed,
        id: 13,
        employeeOpenId: 'ou_reconfirm',
        status: 'RE_CONFIRMING',
        resultVersions: [{ ...confirmed.resultVersions[0], confirmedAt: null }],
      },
    ]);

    const preview = await service.preview('ou_admin', 1);

    expect(preview.canArchive).toBe(false);
    expect(preview.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          participantId: 10,
          code: 'REQUIRED_SELF_MISSING',
        }),
        expect.objectContaining({
          participantId: 10,
          code: 'REQUIRED_MANAGER_MISSING',
        }),
        expect.objectContaining({
          participantId: 11,
          code: 'RESULT_NOT_PUBLISHED',
        }),
        expect.objectContaining({ participantId: 12, code: 'OPEN_APPEAL' }),
        expect.objectContaining({
          participantId: 13,
          code: 'RECONFIRMATION_PENDING',
        }),
      ]),
    );
  });

  it('确认归档在 Serializable 事务内重算修订并原子保存不可变快照', async () => {
    const preview = await service.preview('ou_admin', 1);
    tx.perfParticipant.findMany.mockResolvedValue(
      await prisma.perfParticipant.findMany(),
    );

    const archived = await service.archive('ou_admin', 1, {
      confirmed: true,
      expectedRevision: preview.revision,
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(tx.perfCycle.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: 'ACTIVE' },
      data: { status: 'ARCHIVED' },
    });
    expect(tx.perfCycleArchive.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cycleId: 1,
        operatorOpenId: 'ou_admin',
        summary: preview.summary,
        checkResult: expect.objectContaining({
          revision: preview.revision,
          blockers: [],
        }),
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'cycle.archive', targetId: '1' }),
    });
    expect(archived).toMatchObject({ cycleId: 1, status: 'ARCHIVED' });
  });

  it('范围 HR 必须覆盖周期全部参与者，普通员工不能预览', async () => {
    rbac.isAdmin.mockResolvedValue(false);
    rbac.hasAnyRole.mockResolvedValue(true);
    rbac.getOrgScope.mockResolvedValue(['od_a']);
    await expect(service.preview('ou_hr', 1)).resolves.toMatchObject({
      canArchive: true,
    });

    rbac.getOrgScope.mockResolvedValue([]);
    await expect(service.preview('ou_hr', 1)).rejects.toThrow(
      ForbiddenException,
    );

    rbac.hasAnyRole.mockResolvedValue(false);
    await expect(service.preview('ou_employee', 1)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('事务内发现阻塞、预览过期或并发状态转换时均不落归档快照', async () => {
    const preview = await service.preview('ou_admin', 1);
    tx.perfParticipant.findMany.mockResolvedValueOnce([
      {
        ...confirmed,
        status: 'RESULT_PUBLISHED',
        resultVersions: [{ ...confirmed.resultVersions[0], confirmedAt: null }],
      },
    ]);
    await expect(
      service.archive('ou_admin', 1, {
        confirmed: true,
        expectedRevision: preview.revision,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CYCLE_ARCHIVE_BLOCKED' }),
    });

    tx.perfParticipant.findMany.mockResolvedValueOnce([confirmed]);
    await expect(
      service.archive('ou_admin', 1, {
        confirmed: true,
        expectedRevision: '0'.repeat(64),
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ARCHIVE_PREVIEW_STALE' }),
    });

    prisma.perfParticipant.findMany.mockResolvedValueOnce([confirmed]);
    const oneParticipantPreview = await service.preview('ou_admin', 1);
    tx.perfParticipant.findMany.mockResolvedValueOnce([confirmed]);
    tx.perfCycle.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.archive('ou_admin', 1, {
        confirmed: true,
        expectedRevision: oneParticipantPreview.revision,
      }),
    ).rejects.toThrow(ConflictException);
    expect(tx.perfCycle.updateMany).toHaveBeenCalled();
    expect(tx.perfCycleArchive.create).not.toHaveBeenCalled();
  });
});
