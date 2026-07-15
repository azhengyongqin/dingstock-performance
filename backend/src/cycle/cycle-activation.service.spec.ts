import { CycleActivationService } from './cycle-activation.service';

jest.mock('../generated/prisma/enums', () => ({
  PerfCycleStatus: {
    DRAFT: 'DRAFT',
    SCHEDULED: 'SCHEDULED',
    ACTIVE: 'ACTIVE',
    ARCHIVED: 'ARCHIVED',
  },
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
jest.mock('../audit/audit.service', () => ({ AuditService: class {} }));
jest.mock('./cycle-setup.service', () => ({ CycleSetupService: class {} }));
jest.mock('../notification/notification-event.service', () => ({
  NotificationEventService: class {},
}));

describe('CycleActivationService', () => {
  const now = new Date('2026-07-14T01:00:00.000Z');
  const plan = {
    allowStageOverlap: true,
    stages: [
      {
        stage: 'SELF',
        startAt: '2026-07-14T01:00:00.000Z',
        reminderDeadlineAt: '2026-07-15T01:00:00.000Z',
      },
      {
        stage: 'PEER',
        startAt: '2026-07-14T02:00:00.000Z',
        reminderDeadlineAt: '2026-07-15T02:00:00.000Z',
      },
      {
        stage: 'MANAGER',
        startAt: '2026-07-14T03:00:00.000Z',
        reminderDeadlineAt: '2026-07-15T03:00:00.000Z',
      },
    ],
  };
  const cycle = {
    id: 9,
    name: '2026 上半年绩效评定',
    status: 'SCHEDULED',
    plannedStartAt: new Date('2026-07-14T01:00:00.000Z'),
    ownerOpenId: 'ou_hr',
    currentConfigVersion: {
      schedulePreset: {
        allowStageOverlap: true,
        stages: [
          {
            stage: 'SELF',
            startOffsetMinutes: 0,
            reminderDeadlineOffsetMinutes: 1440,
          },
          {
            stage: 'PEER',
            startOffsetMinutes: 60,
            reminderDeadlineOffsetMinutes: 1500,
          },
          {
            stage: 'MANAGER',
            startOffsetMinutes: 120,
            reminderDeadlineOffsetMinutes: 1560,
          },
        ],
      },
      notificationRules: { stages: [] },
      formSnapshots: [{ id: 501, jobLevelPrefix: 'D' }],
    },
    participants: [
      {
        id: 101,
        employeeOpenId: 'ou_employee',
        leaderOpenIdSnapshot: 'ou_leader',
      },
    ],
  };
  const tx = {
    $queryRaw: jest.fn(),
    perfCycle: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    perfEvaluationTask: { createMany: jest.fn(), findMany: jest.fn() },
    perfParticipant: { update: jest.fn() },
    larkUser: { findMany: jest.fn() },
    larkCorehrEmployee: { findMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      Promise.resolve(callback(tx)),
    ),
    perfCycle: { findMany: jest.fn(), findFirst: jest.fn() },
  };
  const setup = { startCheck: jest.fn(), getPlan: jest.fn() };
  const audit = { record: jest.fn() };
  const notificationEvents = {
    enqueueTaskOpenedEvents: jest.fn(),
    enqueueCycleStartFailure: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.perfCycle.findFirst.mockResolvedValue(structuredClone(cycle));
    tx.larkUser.findMany.mockResolvedValue([
      {
        open_id: 'ou_employee',
        leader_user_id: 'ou_leader',
        department_ids: ['od_1'],
      },
    ]);
    tx.larkCorehrEmployee.findMany.mockResolvedValue([
      {
        open_id: 'ou_employee',
        direct_manager_id: 'ou_leader',
        department_id: 'od_1',
        job_level: { code: 'D5' },
      },
    ]);
    setup.startCheck.mockResolvedValue({ ok: true, items: [] });
    setup.getPlan.mockResolvedValue(plan);
    tx.perfEvaluationTask.createMany.mockResolvedValue({ count: 4 });
    tx.perfEvaluationTask.findMany.mockResolvedValue([]);
  });

  it('到时后在同一事务切换 ACTIVE，并为每名参与人生成四类任务事实', async () => {
    const service = new CycleActivationService(
      prisma as never,
      setup as never,
      audit as never,
      notificationEvents as never,
    );

    const result = await service.activateCycle(9, now);

    expect(result).toMatchObject({ status: 'ACTIVATED', changed: true });
    expect(tx.perfEvaluationTask.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          cycleId: 9,
          participantId: 101,
          type: 'SELF',
          assigneeOpenId: 'ou_employee',
          openedAt: now,
        }),
        expect.objectContaining({ type: 'PEER', assigneeOpenId: null }),
        expect.objectContaining({
          type: 'MANAGER',
          assigneeOpenId: 'ou_leader',
        }),
        expect.objectContaining({
          type: 'AI',
          startAt: null,
          reminderDeadlineAt: null,
        }),
      ]),
      skipDuplicates: true,
    });
    expect(tx.perfCycle.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { status: 'ACTIVE' },
    });
  });

  it('启动复核失败时保持 SCHEDULED，并返回可供通知的具体问题', async () => {
    setup.startCheck.mockResolvedValue({
      ok: false,
      items: [
        {
          key: 'participants',
          ok: false,
          issues: [{ code: 'PARTICIPANTS_EMPTY', message: '尚未添加人员' }],
        },
      ],
    });
    const service = new CycleActivationService(
      prisma as never,
      setup as never,
      audit as never,
      notificationEvents as never,
    );

    const result = await service.activateCycle(9, now);

    expect(result).toMatchObject({ status: 'CHECK_FAILED', changed: false });
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'PARTICIPANTS_EMPTY' }),
    ]);
    expect(tx.perfEvaluationTask.createMany).not.toHaveBeenCalled();
    expect(tx.perfCycle.update).not.toHaveBeenCalled();
    expect(notificationEvents.enqueueCycleStartFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        cycleId: 9,
        ownerOpenId: 'ou_hr',
        issues: [expect.objectContaining({ code: 'PARTICIPANTS_EMPTY' })],
      }),
    );
  });

  it('并发启动在行锁串行化后只生成一次任务', async () => {
    let status = 'SCHEDULED';
    let serialized = Promise.resolve<unknown>(undefined);
    prisma.$transaction.mockImplementation(
      (callback: (client: typeof tx) => Promise<unknown>) => {
        // 单测用串行队列模拟 PostgreSQL FOR UPDATE 的临界区语义。
        const result = serialized.then(() => callback(tx));
        serialized = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      },
    );
    tx.perfCycle.findFirst.mockImplementation(() =>
      Promise.resolve({ ...structuredClone(cycle), status }),
    );
    tx.perfCycle.update.mockImplementation(() => {
      status = 'ACTIVE';
      return Promise.resolve({ ...cycle, status });
    });
    const service = new CycleActivationService(
      prisma as never,
      setup as never,
      audit as never,
      notificationEvents as never,
    );

    const results = await Promise.all([
      service.activateCycle(9, now),
      service.activateCycle(9, now),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      'ACTIVATED',
      'ALREADY_ACTIVE',
    ]);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.perfEvaluationTask.createMany).toHaveBeenCalledTimes(1);
    expect(tx.perfCycle.update).toHaveBeenCalledTimes(1);
  });

  it('启动时 CoreHR 缺少直属 Leader 会复核失败且不生成任务', async () => {
    tx.larkUser.findMany.mockResolvedValue([
      {
        open_id: 'ou_employee',
        leader_user_id: null,
        department_ids: ['od_1'],
      },
    ]);
    tx.larkCorehrEmployee.findMany.mockResolvedValue([
      {
        open_id: 'ou_employee',
        direct_manager_id: null,
        department_id: 'od_1',
        job_level: { code: 'D5' },
      },
    ]);
    const service = new CycleActivationService(
      prisma as never,
      setup as never,
      audit as never,
      notificationEvents as never,
    );

    await expect(service.activateCycle(9, now)).resolves.toMatchObject({
      status: 'CHECK_FAILED',
      issues: [expect.objectContaining({ code: 'PARTICIPANT_LEADER_MISSING' })],
    });
    expect(tx.perfEvaluationTask.createMany).not.toHaveBeenCalled();
  });

  it('定时启动发生系统异常时保持待启动，并发送安全化失败事件', async () => {
    prisma.perfCycle.findMany.mockResolvedValue([{ id: 9 }]);
    prisma.perfCycle.findFirst.mockResolvedValue({
      name: '2026 上半年绩效评定',
      ownerOpenId: 'ou_hr',
    });
    const service = new CycleActivationService(
      prisma as never,
      setup as never,
      audit as never,
      notificationEvents as never,
    );
    jest
      .spyOn(service, 'activateCycle')
      .mockRejectedValueOnce(new Error('database password leaked'));

    await service.activateDueCycles(now);

    expect(notificationEvents.enqueueCycleStartFailure).toHaveBeenCalledWith({
      cycleId: 9,
      cycleName: '2026 上半年绩效评定',
      ownerOpenId: 'ou_hr',
      issues: [
        {
          code: 'CYCLE_ACTIVATION_ERROR',
          message: '自动启动发生系统异常，请稍后重试或联系管理员',
        },
      ],
    });
  });

  it('每轮只开放有界任务批次，避免定时任务形成超长事务', async () => {
    tx.perfEvaluationTask.findMany.mockResolvedValue([]);
    const service = new CycleActivationService(
      prisma as never,
      setup as never,
      audit as never,
      notificationEvents as never,
    );

    await service.openDueTasks(now);

    expect(tx.perfEvaluationTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { id: 'asc' },
        take: 200,
      }),
    );
  });
});
