import type Redis from 'ioredis';
import type { PrismaService } from '../shared/database/prisma.service';
import type { EnqueueNotificationEventInput } from './notification-event.contract';
import { NotificationEventService } from './notification-event.service';

// 生成的 Prisma client 是 ESM 产物，单测统一 mock，避免依赖真实数据库。
jest.mock(
  '../generated/prisma/client',
  () => ({
    PrismaClient: class {
      $connect = jest.fn();
      $disconnect = jest.fn();
    },
  }),
  { virtual: true },
);
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfAssignmentStatus: {
      REPLACED: 'REPLACED',
    },
    PerfCycleStatus: {
      ACTIVE: 'ACTIVE',
    },
    PerfEvaluationTaskType: {
      SELF: 'SELF',
      PEER: 'PEER',
      MANAGER: 'MANAGER',
      AI: 'AI',
    },
    PerfNotificationChannel: {
      BOT_DM: 'BOT_DM',
    },
    PerfNotificationEventStatus: {
      PENDING: 'PENDING',
      RETRYING: 'RETRYING',
      COMPLETED: 'COMPLETED',
      FAILED: 'FAILED',
    },
    PerfRole: {
      HR: 'HR',
      ADMIN: 'ADMIN',
    },
  }),
  { virtual: true },
);
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation((options: unknown) => options),
}));

describe('NotificationEventService', () => {
  const events = new Map<string, Record<string, unknown>>();
  const notifications = new Map<number, Record<string, unknown>>();
  let nextEventId = 1;

  const transactionClient = {
    perfNotificationEvent: {
      findUnique: jest.fn(({ where }: { where: { id: number } }) =>
        Promise.resolve(
          [...events.values()].find((event) => event.id === where.id),
        ),
      ),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: number };
          data: Record<string, unknown>;
        }) => {
          const event = [...events.values()].find(
            (candidate) => candidate.id === where.id,
          );
          if (event) Object.assign(event, data);
          return Promise.resolve(event);
        },
      ),
    },
    perfNotification: {
      upsert: jest.fn(
        ({
          where,
          create,
        }: {
          where: { sourceEventId: number };
          create: Record<string, unknown>;
        }) => {
          const existing = notifications.get(where.sourceEventId);
          if (existing) return Promise.resolve(existing);
          const created = { id: notifications.size + 1, ...create };
          notifications.set(where.sourceEventId, created);
          return Promise.resolve(created);
        },
      ),
    },
  };

  const prismaMock = {
    perfEvaluationTask: {
      findMany: jest.fn(),
    },
    roleGrant: {
      findMany: jest.fn(),
    },
    perfNotificationEvent: {
      upsert: jest.fn(
        ({
          where,
          create,
        }: {
          where: { dedupeKey: string };
          create: Record<string, unknown>;
        }) => {
          const existing = events.get(where.dedupeKey);
          if (existing) return Promise.resolve(existing);
          const created = {
            id: nextEventId++,
            status: 'PENDING',
            attemptCount: 0,
            ...create,
          };
          events.set(where.dedupeKey, created);
          return Promise.resolve(created);
        },
      ),
      findMany: jest.fn(() => Promise.resolve([...events.values()])),
      findUnique: transactionClient.perfNotificationEvent.findUnique,
      update: transactionClient.perfNotificationEvent.update,
    },
    $transaction: jest.fn(
      (callback: (tx: typeof transactionClient) => unknown) =>
        Promise.resolve(callback(transactionClient)),
    ),
  };
  const redisMock = {
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
    eval: jest.fn().mockResolvedValue(1),
  };
  const buildService = () =>
    new NotificationEventService(
      prismaMock as unknown as PrismaService,
      redisMock as unknown as Redis,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    events.clear();
    notifications.clear();
    nextEventId = 1;
    redisMock.set.mockResolvedValue('OK');
    redisMock.get.mockResolvedValue(null);
    prismaMock.perfEvaluationTask.findMany.mockResolvedValue([]);
    prismaMock.roleGrant.findMany.mockResolvedValue([]);
  });

  it('相同业务键重复入队只保留一个事件', async () => {
    const service = buildService();
    const input: EnqueueNotificationEventInput = {
      dedupeKey: 'task-opened:81:2026-08-01T01:00:00.000Z:ou_user',
      type: 'TASK_OPENED',
      cycleId: 9,
      taskId: 81,
      receiverOpenId: 'ou_user',
      channel: 'BOT_DM',
      template: 'evaluation_task_opened',
    };

    const first = await service.enqueue(input);
    const duplicate = await service.enqueue(input);

    expect(first.id).toBe(duplicate.id);
    expect(events.size).toBe(1);
  });

  it('同一事件重复消费只产生一条待发送通知', async () => {
    const service = buildService();
    const event = await service.enqueue({
      dedupeKey: 'task-reminder:81:2026-08-10T01:00:00.000Z:ou_user',
      type: 'TASK_REMINDER_DUE',
      cycleId: 9,
      taskId: 81,
      receiverOpenId: 'ou_user',
      channel: 'BOT_DM',
      template: 'evaluation_task_reminder',
      payload: { cycleName: '2026 上半年绩效评定' },
    });

    await service.processEvent(event.id);
    // 模拟队列至少一次投递：把状态恢复为待处理后再次消费。
    Object.assign(events.values().next().value, { status: 'PENDING' });
    await service.processEvent(event.id);

    expect(notifications.size).toBe(1);
    expect(events.values().next().value).toEqual(
      expect.objectContaining({ status: 'COMPLETED' }),
    );
  });

  it('消费首次失败会记录退避重试', async () => {
    const service = buildService();
    const event = await service.enqueue({
      dedupeKey: 'cycle-start-failed:9:digest:ou_hr',
      type: 'CYCLE_START_FAILED',
      cycleId: 9,
      receiverOpenId: 'ou_hr',
      channel: 'BOT_DM',
      template: 'cycle_start_failed',
    });
    transactionClient.perfNotification.upsert.mockRejectedValueOnce(
      new Error('temporary database error'),
    );

    await service.processEvent(event.id);

    expect(events.values().next().value).toEqual(
      expect.objectContaining({
        status: 'RETRYING',
        attemptCount: 1,
        errorMessage: 'temporary database error',
        availableAt: expect.any(Date),
      }),
    );
  });

  it('事件连续消费失败达到上限后转为失败终态', async () => {
    const service = buildService();
    const event = await service.enqueue({
      dedupeKey: 'cycle-start-failed:10:digest:ou_hr',
      type: 'CYCLE_START_FAILED',
      cycleId: 10,
      receiverOpenId: 'ou_hr',
      channel: 'BOT_DM',
      template: 'cycle_start_failed',
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      transactionClient.perfNotification.upsert.mockRejectedValueOnce(
        new Error(`temporary error ${attempt + 1}`),
      );
      await service.processEvent(event.id);
    }

    expect(events.values().next().value).toEqual(
      expect.objectContaining({
        status: 'FAILED',
        attemptCount: 3,
        errorMessage: 'temporary error 3',
      }),
    );
    expect(notifications.size).toBe(0);
  });

  it('任务开放事件按执行人和配置抄送人入队，同一接收人不会重复', async () => {
    const service = buildService();

    const result = await service.enqueueTaskOpenedEvents({
      id: 81,
      cycleId: 9,
      type: 'SELF',
      assigneeOpenId: 'ou_user',
      openedAt: new Date('2026-08-01T01:00:00.000Z'),
      reminderDeadlineAt: new Date('2026-08-10T01:00:00.000Z'),
      cycleName: '2026 上半年绩效评定',
      cycleOwnerOpenId: 'ou_hr',
      leaderOpenId: 'ou_user',
      peerReviewerOpenIds: [],
      rule: {
        enabled: true,
        recipient: 'ASSIGNEE',
        ccLeader: true,
        ccHr: true,
      },
    });

    expect(result).toHaveLength(2);
    expect([...events.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ receiverOpenId: 'ou_user' }),
        expect.objectContaining({ receiverOpenId: 'ou_hr' }),
      ]),
    );
  });

  it('PEER 任务把所有有效评审员视为执行人并逐人生成开放事件', async () => {
    const service = buildService();

    const result = await service.enqueueTaskOpenedEvents({
      id: 82,
      cycleId: 9,
      type: 'PEER',
      assigneeOpenId: null,
      openedAt: new Date('2026-08-01T01:00:00.000Z'),
      reminderDeadlineAt: new Date('2026-08-10T01:00:00.000Z'),
      cycleName: '2026 上半年绩效评定',
      cycleOwnerOpenId: 'ou_hr',
      leaderOpenId: 'ou_leader',
      peerReviewerOpenIds: ['ou_reviewer_1', 'ou_reviewer_2'],
      rule: {
        enabled: true,
        recipient: 'ASSIGNEE',
        ccLeader: false,
        ccHr: false,
      },
    });

    expect(result).toHaveLength(2);
    expect([...events.values()].map((event) => event.receiverOpenId)).toEqual([
      'ou_reviewer_1',
      'ou_reviewer_2',
    ]);
  });

  it('软截止扫描只生成提醒事件，不修改任务状态', async () => {
    const service = buildService();
    prismaMock.perfEvaluationTask.findMany.mockResolvedValue([
      {
        id: 81,
        cycleId: 9,
        type: 'SELF',
        assigneeOpenId: 'ou_user',
        openedAt: new Date('2026-08-01T01:00:00.000Z'),
        reminderDeadlineAt: new Date('2026-08-10T01:00:00.000Z'),
        cycle: {
          name: '2026 上半年绩效评定',
          ownerOpenId: 'ou_hr',
          currentConfigVersion: {
            notificationRules: {
              stages: [
                {
                  stage: 'SELF',
                  reminder: {
                    enabled: true,
                    recipient: 'ASSIGNEE',
                    ccLeader: false,
                    ccHr: false,
                    frequency: { type: 'ONCE_AT_DEADLINE' },
                  },
                },
              ],
            },
          },
        },
        participant: {
          leaderOpenIdSnapshot: 'ou_leader',
          reviewerAssignments: [],
        },
      },
    ]);

    const result = await service.enqueueDueTaskReminders(
      new Date('2026-08-11T01:00:00.000Z'),
    );

    expect(result).toEqual({ eventCount: 1 });
    expect(prismaMock.perfEvaluationTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ openedAt: { not: null } }),
      }),
    );
    expect(prismaMock.perfEvaluationTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    );
    expect([...events.values()][0]).toEqual(
      expect.objectContaining({
        type: 'TASK_REMINDER_DUE',
        taskId: 81,
        deadlineAt: new Date('2026-08-10T01:00:00.000Z'),
      }),
    );
  });

  it('启动失败把具体问题通知周期负责人和 Admin，并按问题摘要去重', async () => {
    const service = buildService();
    prismaMock.roleGrant.findMany.mockResolvedValue([
      { userOpenId: 'ou_other_hr' },
      { userOpenId: 'ou_admin' },
    ]);
    const input = {
      cycleId: 9,
      cycleName: '2026 上半年绩效评定',
      ownerOpenId: 'ou_hr',
      issues: [
        {
          code: 'PARTICIPANTS_EMPTY',
          path: 'participants',
          message: '尚未添加人员',
        },
      ],
    };

    await service.enqueueCycleStartFailure(input);
    await service.enqueueCycleStartFailure(input);

    expect(events.size).toBe(3);
    expect([...events.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ receiverOpenId: 'ou_hr' }),
        expect.objectContaining({ receiverOpenId: 'ou_other_hr' }),
        expect.objectContaining({ receiverOpenId: 'ou_admin' }),
      ]),
    );
    expect([...events.values()][0]?.payload).toEqual(
      expect.objectContaining({
        issues: [expect.objectContaining({ message: '尚未添加人员' })],
      }),
    );
  });
});
