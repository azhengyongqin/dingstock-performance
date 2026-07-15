import { ConflictException, NotFoundException } from '@nestjs/common';
import { EvaluationTaskAccessService } from './evaluation-task-access.service';

jest.mock('../generated/prisma/enums', () => ({
  PerfCycleStatus: { ACTIVE: 'ACTIVE' },
  PerfEvaluationTaskType: {
    SELF: 'SELF',
    PEER: 'PEER',
    MANAGER: 'MANAGER',
    AI: 'AI',
  },
  PerfAssignmentStatus: { REPLACED: 'REPLACED' },
}));
jest.mock('../shared/database/prisma.service', () => ({
  PrismaService: class {},
}));

describe('EvaluationTaskAccessService', () => {
  const prisma = {
    $transaction: jest.fn(),
  };
  const notificationEvents = { enqueueTaskOpenedEvents: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

  it('开始时间前拒绝保存或提交', async () => {
    prisma.$transaction.mockImplementation((callback: never) =>
      Promise.resolve(
        (callback as (tx: unknown) => unknown)({
          perfEvaluationTask: {
            findUnique: jest.fn().mockResolvedValue({
              id: 1,
              startAt: new Date('2026-07-14T02:00:00.000Z'),
              openedAt: null,
              cycle: { status: 'ACTIVE', deletedAt: null },
              participant: { status: 'PENDING_SELF_REVIEW' },
            }),
            updateMany: jest.fn(),
          },
        }),
      ),
    );
    const service = new EvaluationTaskAccessService(
      prisma as never,
      notificationEvents as never,
    );

    await expect(
      service.ensureWritable(101, 'SELF', new Date('2026-07-14T01:59:59.999Z')),
    ).rejects.toThrow(ConflictException);
  });

  it('到达开始时间后不可逆地标记开放，软截止后仍允许写入', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation((callback: never) =>
      Promise.resolve(
        (callback as (tx: unknown) => unknown)({
          perfEvaluationTask: {
            findUnique: jest.fn().mockResolvedValue({
              id: 1,
              cycleId: 9,
              participantId: 101,
              type: 'SELF',
              assigneeOpenId: 'ou_employee',
              startAt: new Date('2026-07-14T01:00:00.000Z'),
              reminderDeadlineAt: new Date('2026-07-14T01:30:00.000Z'),
              openedAt: null,
              completedAt: null,
              cycle: {
                status: 'ACTIVE',
                deletedAt: null,
                name: '2026 上半年',
                ownerOpenId: 'ou_hr',
                currentConfigVersion: {
                  notificationRules: {
                    stages: [
                      {
                        stage: 'SELF',
                        taskOpened: {
                          enabled: true,
                          recipient: 'ASSIGNEE',
                          ccLeader: false,
                          ccHr: true,
                        },
                      },
                    ],
                  },
                },
              },
              participant: {
                status: 'PENDING_SELF_REVIEW',
                leaderOpenIdSnapshot: 'ou_leader',
                reviewerAssignments: [],
              },
            }),
            updateMany,
          },
        }),
      ),
    );
    const service = new EvaluationTaskAccessService(
      prisma as never,
      notificationEvents as never,
    );
    const afterDeadline = new Date('2026-07-14T03:00:00.000Z');

    await expect(
      service.ensureWritable(101, 'SELF', afterDeadline),
    ).resolves.toMatchObject({ id: 1 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 1, openedAt: null },
      data: { openedAt: afterDeadline },
    });
    expect(notificationEvents.enqueueTaskOpenedEvents).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, openedAt: afterDeadline }),
      expect.any(Object),
    );
  });

  it('任务事实不存在时拒绝旧路径绕过开放门槛', async () => {
    prisma.$transaction.mockImplementation((callback: never) =>
      Promise.resolve(
        (callback as (tx: unknown) => unknown)({
          perfEvaluationTask: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        }),
      ),
    );
    const service = new EvaluationTaskAccessService(
      prisma as never,
      notificationEvents as never,
    );

    await expect(
      service.ensureWritable(101, 'MANAGER', new Date()),
    ).rejects.toThrow(NotFoundException);
  });

  it.each(['CALIBRATED', 'CONFIRMED', 'NO_RESULT', 'WITHDRAWN'])(
    '参与者处于 %s 时拒绝写入且不产生开放副作用',
    async (status) => {
      const updateMany = jest.fn();
      prisma.$transaction.mockImplementation((callback: never) =>
        Promise.resolve(
          (callback as (tx: unknown) => unknown)({
            perfEvaluationTask: {
              findUnique: jest.fn().mockResolvedValue({
                id: 1,
                startAt: new Date('2026-07-14T01:00:00.000Z'),
                openedAt: null,
                cycle: { status: 'ACTIVE', deletedAt: null },
                participant: { status },
              }),
              updateMany,
            },
          }),
        ),
      );
      const service = new EvaluationTaskAccessService(
        prisma as never,
        notificationEvents as never,
      );

      await expect(
        service.ensureWritable(
          101,
          'SELF',
          new Date('2026-07-14T02:00:00.000Z'),
        ),
      ).rejects.toThrow(ConflictException);
      expect(updateMany).not.toHaveBeenCalled();
      expect(notificationEvents.enqueueTaskOpenedEvents).not.toHaveBeenCalled();
    },
  );

  it('读取路径在开始时间到达后惰性开放任务', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation((callback: never) =>
      Promise.resolve(
        (callback as (tx: unknown) => unknown)({
          perfEvaluationTask: {
            findUnique: jest.fn().mockResolvedValue({
              id: 1,
              cycleId: 9,
              participantId: 101,
              type: 'MANAGER',
              assigneeOpenId: 'ou_leader',
              startAt: new Date('2026-07-14T01:00:00.000Z'),
              reminderDeadlineAt: null,
              openedAt: null,
              cycle: {
                status: 'ACTIVE',
                deletedAt: null,
                name: '2026 上半年',
                ownerOpenId: 'ou_hr',
                currentConfigVersion: { notificationRules: { stages: [] } },
              },
              participant: {
                status: 'SELF_SUBMITTED',
                leaderOpenIdSnapshot: 'ou_leader',
                reviewerAssignments: [],
              },
            }),
            updateMany,
          },
        }),
      ),
    );
    const service = new EvaluationTaskAccessService(
      prisma as never,
      notificationEvents as never,
    );
    const now = new Date('2026-07-14T02:00:00.000Z');

    await expect(service.openIfDue(101, 'MANAGER', now)).resolves.toMatchObject(
      { id: 1, openedAt: now },
    );
    expect(updateMany).toHaveBeenCalled();
  });
});
