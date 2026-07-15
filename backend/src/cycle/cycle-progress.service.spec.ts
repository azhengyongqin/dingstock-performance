import { CycleProgressService } from './cycle-progress.service';

jest.mock('../shared/database/prisma.service', () => ({
  PrismaService: class {},
}));

describe('CycleProgressService', () => {
  const prisma = {
    perfCycle: { findFirst: jest.fn() },
    perfParticipant: { findMany: jest.fn() },
    perfEvaluationTask: { findMany: jest.fn() },
    perfNotificationEvent: { findFirst: jest.fn() },
    larkUser: { findMany: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.perfCycle.findFirst.mockResolvedValue({
      id: 9,
      name: '2026 上半年',
      status: 'ACTIVE',
      plannedStartAt: new Date('2026-07-14T01:00:00.000Z'),
    });
    prisma.perfParticipant.findMany.mockResolvedValue([
      { id: 101, employeeOpenId: 'ou_1', status: 'ACTIVE' },
    ]);
    prisma.perfEvaluationTask.findMany.mockResolvedValue([
      {
        id: 1,
        participantId: 101,
        type: 'SELF',
        startAt: new Date('2026-07-14T01:00:00.000Z'),
        reminderDeadlineAt: new Date('2026-07-15T01:00:00.000Z'),
        openedAt: new Date('2026-07-14T01:00:00.000Z'),
        completedAt: null,
      },
      {
        id: 2,
        participantId: 101,
        type: 'MANAGER',
        startAt: new Date('2026-07-14T03:00:00.000Z'),
        reminderDeadlineAt: new Date('2026-07-15T03:00:00.000Z'),
        openedAt: null,
        completedAt: null,
      },
    ]);
    prisma.perfNotificationEvent.findFirst.mockResolvedValue(null);
    prisma.larkUser.findMany.mockResolvedValue([
      { open_id: 'ou_1', name: '张三' },
    ]);
  });

  it('待启动周期展示最新启动失败事件中的结构化问题', async () => {
    prisma.perfCycle.findFirst.mockResolvedValue({
      id: 9,
      name: '2026 上半年',
      status: 'SCHEDULED',
      plannedStartAt: new Date('2026-07-14T01:00:00.000Z'),
    });
    prisma.perfNotificationEvent.findFirst.mockResolvedValue({
      createdAt: new Date('2026-07-14T01:01:00.000Z'),
      payload: {
        issues: [
          { code: 'PARTICIPANT_LEADER_MISSING', message: '缺少 Leader' },
        ],
      },
    });
    const service = new CycleProgressService(prisma as never);

    const result = await service.getProgress(9);

    expect(result.startFailure).toMatchObject({
      occurredAt: new Date('2026-07-14T01:01:00.000Z'),
      issues: [expect.objectContaining({ code: 'PARTICIPANT_LEADER_MISSING' })],
    });
    expect(result.activationIssues).toEqual(result.startFailure?.issues);
  });

  it('只根据任务事实派生阶段进度、缺失项和下一步动作', async () => {
    const service = new CycleProgressService(prisma as never);

    const result = await service.getProgress(9);

    expect(result.totals).toMatchObject({
      participants: 1,
      tasks: 2,
      notStarted: 1,
      open: 1,
      submitted: 0,
    });
    expect(result.tasks).toEqual([
      expect.objectContaining({ id: 1, status: 'OPEN' }),
      expect.objectContaining({ id: 2, status: 'WAITING' }),
    ]);
    expect(result.missingItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          participantId: 101,
          stage: 'SELF',
          employeeName: '张三',
        }),
      ]),
    );
    expect(result.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'FOLLOW_UP_TASKS' }),
      ]),
    );
  });
});
