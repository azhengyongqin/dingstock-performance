import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ActiveCycleRollbackService } from './active-cycle-rollback.service';

jest.mock('../shared/database/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('../rbac/rbac.service', () => ({ RbacService: class {} }));
jest.mock('../notification/notification-event.service', () => ({
  NotificationEventService: class {},
}));

const now = new Date('2026-07-16T08:00:00.000Z');

function cycleFixture() {
  return {
    id: 17,
    name: '2026 上半年绩效评定',
    status: 'ACTIVE',
    plannedStartAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-16T07:00:00.000Z'),
    evaluationTasks: [
      { id: 81, openedAt: new Date(), completedAt: null },
      { id: 82, openedAt: new Date(), completedAt: new Date() },
    ],
    participants: [
      {
        id: 101,
        employeeOpenId: 'ou_published',
        status: 'CONFIRMED',
        evaluationLockedAt: new Date('2026-07-10T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T00:00:00.000Z'),
        evaluationSubmissions: [
          { id: 1, stage: 'SELF', status: 'SUBMITTED' },
          { id: 2, stage: 'MANAGER', status: 'SUBMITTED' },
        ],
        calibrations: [{ id: 11, invalidatedAt: null }],
        resultVersions: [
          {
            id: 21,
            version: 1,
            confirmedAt: new Date(),
            supersededAt: null,
            invalidatedAt: null,
          },
        ],
        appeals: [{ id: 31, status: 'RESOLVED', invalidatedAt: null }],
      },
      {
        id: 102,
        employeeOpenId: 'ou_reviewed',
        status: 'REVIEWED',
        evaluationLockedAt: null,
        updatedAt: new Date('2026-07-15T01:00:00.000Z'),
        evaluationSubmissions: [
          { id: 3, stage: 'SELF', status: 'SUBMITTED' },
          { id: 4, stage: 'MANAGER', status: 'SUBMITTED' },
        ],
        calibrations: [],
        resultVersions: [],
        appeals: [],
      },
    ],
  };
}

describe('ActiveCycleRollbackService', () => {
  const tx = {
    $queryRaw: jest.fn(),
    perfCycle: { findFirst: jest.fn(), update: jest.fn() },
    perfCycleRollback: { create: jest.fn() },
    perfCalibration: { updateMany: jest.fn() },
    perfResult: { updateMany: jest.fn() },
    perfResultVersion: { updateMany: jest.fn() },
    perfAppeal: { updateMany: jest.fn() },
    perfParticipant: { update: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    perfCycle: { findFirst: jest.fn() },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const rbac = { isAdmin: jest.fn() };
  const notifications = { enqueueResultInvalidatedEvent: jest.fn() };
  let service: ActiveCycleRollbackService;

  beforeEach(() => {
    jest.clearAllMocks();
    const cycle = cycleFixture();
    prisma.perfCycle.findFirst.mockResolvedValue(cycle);
    tx.perfCycle.findFirst.mockResolvedValue(cycle);
    tx.$queryRaw.mockResolvedValue([{ id: 17 }]);
    tx.perfCycleRollback.create.mockResolvedValue({ id: 71 });
    rbac.isAdmin.mockResolvedValue(true);
    service = new ActiveCycleRollbackService(
      prisma as never,
      rbac as never,
      notifications as never,
    );
  });

  it('只允许超级管理员预览，并统计所有当前结果链影响', async () => {
    const preview = await service.preview('ou_admin', 17, 'DRAFT');
    expect(preview.summary).toMatchObject({
      participantCount: 2,
      taskCount: 2,
      openedTaskCount: 2,
      completedTaskCount: 1,
      lockedParticipantCount: 1,
      calibrationCount: 1,
      resultVersionCount: 1,
      confirmedResultCount: 1,
      appealCount: 1,
      notificationRecipientCount: 1,
    });

    rbac.isAdmin.mockResolvedValue(false);
    await expect(service.preview('ou_hr', 17, 'DRAFT')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('确认后原子失效历史链、解锁参与人、写审计并只通知已发布员工', async () => {
    const preview = await service.preview('ou_admin', 17, 'DRAFT');
    const result = await service.rollback(
      'ou_admin',
      17,
      {
        targetStatus: 'DRAFT' as never,
        reason: '发现周期配置严重错误',
        confirmed: true,
        impactRevision: preview.impactRevision,
      },
      now,
    );

    expect(result).toMatchObject({ rollbackId: 71, targetStatus: 'DRAFT' });
    expect(tx.perfCalibration.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ invalidatedByRollbackId: 71 }),
      }),
    );
    expect(tx.perfResultVersion.updateMany).toHaveBeenCalled();
    expect(tx.perfAppeal.updateMany).toHaveBeenCalled();
    expect(tx.perfParticipant.update).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { evaluationLockedAt: null, status: 'REVIEWED' },
    });
    expect(tx.perfCycle.update).toHaveBeenCalledWith({
      where: { id: 17 },
      data: { status: 'DRAFT' },
    });
    expect(notifications.enqueueResultInvalidatedEvent).toHaveBeenCalledTimes(
      1,
    );
    expect(notifications.enqueueResultInvalidatedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        receiverOpenId: 'ou_published',
        rollbackId: 71,
      }),
      tx,
    );
    expect(tx.auditLog.create).toHaveBeenCalled();
  });

  it('退回待启动必须提供未来计划时间，并拒绝未确认或过期预览', async () => {
    const preview = await service.preview('ou_admin', 17, 'SCHEDULED');
    await expect(
      service.rollback(
        'ou_admin',
        17,
        {
          targetStatus: 'SCHEDULED' as never,
          reason: '等待重新启动',
          confirmed: true,
          impactRevision: preview.impactRevision,
        },
        now,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.rollback(
        'ou_admin',
        17,
        {
          targetStatus: 'DRAFT' as never,
          reason: '配置错误',
          confirmed: false,
          impactRevision: preview.impactRevision,
        },
        now,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.rollback(
        'ou_admin',
        17,
        {
          targetStatus: 'DRAFT' as never,
          reason: '配置错误',
          confirmed: true,
          impactRevision: '0'.repeat(64),
        },
        now,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('退回待启动写入新的未来计划时间，周期在计划重启前保持只读', async () => {
    const preview = await service.preview('ou_admin', 17, 'SCHEDULED');
    await service.rollback(
      'ou_admin',
      17,
      {
        targetStatus: 'SCHEDULED' as never,
        reason: '调整后按新计划启动',
        confirmed: true,
        impactRevision: preview.impactRevision,
        plannedStartAt: '2026-07-20T09:00:00+08:00',
      },
      now,
    );

    expect(tx.perfCycle.update).toHaveBeenCalledWith({
      where: { id: 17 },
      data: {
        status: 'SCHEDULED',
        plannedStartAt: new Date('2026-07-20T01:00:00.000Z'),
      },
    });
  });

  it.each([
    'CALIBRATED',
    'RESULT_PUSHED',
    'RESULT_PUBLISHED',
    'APPEALING',
    'RE_CONFIRMING',
    'CONFIRMED',
  ])('任意结果链进度 %s 均解除锁并恢复为可编辑 REVIEWED', async (status) => {
    const participant = cycleFixture().participants[0];
    const cycle = {
      ...cycleFixture(),
      participants: [{ ...participant, status }],
    };
    prisma.perfCycle.findFirst.mockResolvedValue(cycle);
    tx.perfCycle.findFirst.mockResolvedValue(cycle);
    const preview = await service.preview('ou_admin', 17, 'DRAFT');

    await service.rollback(
      'ou_admin',
      17,
      {
        targetStatus: 'DRAFT' as never,
        reason: '结果链需要整体重做',
        confirmed: true,
        impactRevision: preview.impactRevision,
      },
      now,
    );

    expect(tx.perfParticipant.update).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { evaluationLockedAt: null, status: 'REVIEWED' },
    });
  });

  it('周期已被并发退回时第二个事务失败且不会重复通知', async () => {
    const preview = await service.preview('ou_admin', 17, 'DRAFT');
    tx.perfCycle.findFirst.mockResolvedValue({
      ...cycleFixture(),
      status: 'DRAFT',
    });
    await expect(
      service.rollback(
        'ou_admin',
        17,
        {
          targetStatus: 'DRAFT' as never,
          reason: '配置错误',
          confirmed: true,
          impactRevision: preview.impactRevision,
        },
        now,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(notifications.enqueueResultInvalidatedEvent).not.toHaveBeenCalled();
  });

  it('预览后任务开放或完成状态变化会使影响修订过期', async () => {
    const preview = await service.preview('ou_admin', 17, 'DRAFT');
    const changed = cycleFixture();
    changed.evaluationTasks[0].completedAt = new Date(
      '2026-07-16T07:30:00.000Z',
    );
    tx.perfCycle.findFirst.mockResolvedValue(changed);

    await expect(
      service.rollback(
        'ou_admin',
        17,
        {
          targetStatus: 'DRAFT' as never,
          reason: '配置错误',
          confirmed: true,
          impactRevision: preview.impactRevision,
        },
        now,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'CYCLE_ROLLBACK_IMPACT_STALE',
      }),
    });
  });
});
