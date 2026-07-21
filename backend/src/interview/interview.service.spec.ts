import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InterviewService } from './interview.service';

jest.mock('../shared/database/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('../audit/audit.service', () => ({ AuditService: class {} }));
jest.mock('../rbac/rbac.service', () => ({ RbacService: class {} }));
jest.mock('../auth/auth.service', () => ({ AuthService: class {} }));
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfInterviewStatus: {
      SCHEDULED: 'SCHEDULED',
      COMPLETED: 'COMPLETED',
      CANCELLED: 'CANCELLED',
    },
    PerfInterviewType: { APPEAL: 'APPEAL', OPTIONAL: 'OPTIONAL' },
    PerfCycleStatus: { ACTIVE: 'ACTIVE', ARCHIVED: 'ARCHIVED' },
    PerfParticipantStatus: {
      ACTIVE: 'ACTIVE',
      RESULT_PUBLISHED: 'RESULT_PUBLISHED',
      APPEALING: 'APPEALING',
      RE_CONFIRMING: 'RE_CONFIRMING',
      CONFIRMED: 'CONFIRMED',
    },
    PerfRole: { HR: 'HR', ADMIN: 'ADMIN' },
  }),
  { virtual: true },
);

describe('InterviewService 面谈工作台主闭环', () => {
  const startAt = new Date('2026-07-22T10:00:00.000Z');
  const endAt = new Date('2026-07-22T11:00:00.000Z');

  const tx = {
    $queryRaw: jest.fn(),
    perfParticipant: { findUnique: jest.fn() },
    perfInterview: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
    perfInterview: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    perfParticipant: { findUnique: jest.fn() },
    larkUser: { findMany: jest.fn() },
  };
  const audit = { record: jest.fn() };
  const rbac = { hasAnyRole: jest.fn(), getOrgScope: jest.fn() };
  const auth = { requireUserAccessToken: jest.fn() };
  const calendar = {
    createEvent: jest.fn(),
    updateEvent: jest.fn(),
    cancelEvent: jest.fn(),
  };

  let service: InterviewService;

  const publishedParticipant = {
    id: 7,
    employeeOpenId: 'ou_employee',
    leaderOpenIdSnapshot: 'ou_leader',
    departmentIdSnapshot: 'od_product',
    status: 'RESULT_PUBLISHED',
    cycle: { id: 1, name: '2026年中', status: 'ACTIVE' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([{ id: 7 }]);
    prisma.perfParticipant.findUnique.mockResolvedValue(publishedParticipant);
    tx.perfParticipant.findUnique.mockResolvedValue(publishedParticipant);
    auth.requireUserAccessToken.mockResolvedValue('uat_leader');
    calendar.createEvent.mockResolvedValue({
      calendarId: 'primary',
      eventId: 'evt_1',
    });
    tx.perfInterview.create.mockResolvedValue({
      id: 11,
      participantId: 7,
      status: 'SCHEDULED',
      organizerOpenId: 'ou_leader',
      scheduledStartAt: startAt,
      scheduledEndAt: endAt,
      calendarId: 'primary',
      calendarEventId: 'evt_1',
      participantOpenIds: ['ou_employee', 'ou_leader'],
      resultNotes: null,
    });
    rbac.hasAnyRole.mockResolvedValue(false);
    rbac.getOrgScope.mockResolvedValue([]);
    prisma.larkUser.findMany.mockResolvedValue([]);
    service = new InterviewService(
      prisma as never,
      audit as never,
      rbac as never,
      auth as never,
      calendar as never,
    );
  });

  it('预约成功：创建飞书日程后落 SCHEDULED，默认邀请员工与操作者，并写审计', async () => {
    const created = await service.schedule('ou_leader', {
      participantId: 7,
      scheduledStartAt: startAt.toISOString(),
      scheduledEndAt: endAt.toISOString(),
    });

    expect(calendar.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userAccessToken: 'uat_leader',
        attendeeOpenIds: ['ou_employee', 'ou_leader'],
      }),
    );
    expect(tx.perfInterview.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        participantId: 7,
        status: 'SCHEDULED',
        organizerOpenId: 'ou_leader',
        calendarEventId: 'evt_1',
        calendarId: 'primary',
        participantOpenIds: ['ou_employee', 'ou_leader'],
      }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'interview.schedule' }),
    );
    expect(created).toMatchObject({ id: 11, status: 'SCHEDULED' });
  });

  it('结果未发布前不可预约', async () => {
    const active = {
      ...publishedParticipant,
      status: 'ACTIVE',
    };
    prisma.perfParticipant.findUnique.mockResolvedValue(active);
    tx.perfParticipant.findUnique.mockResolvedValue(active);

    await expect(
      service.schedule('ou_leader', {
        participantId: 7,
        scheduledStartAt: startAt.toISOString(),
        scheduledEndAt: endAt.toISOString(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(calendar.createEvent).not.toHaveBeenCalled();
  });

  it('飞书日程创建失败时不落库', async () => {
    calendar.createEvent.mockRejectedValue(new Error('calendar down'));

    await expect(
      service.schedule('ou_leader', {
        participantId: 7,
        scheduledStartAt: startAt.toISOString(),
        scheduledEndAt: endAt.toISOString(),
      }),
    ).rejects.toThrow('calendar down');
    expect(tx.perfInterview.create).not.toHaveBeenCalled();
  });

  it('无权操作他人参与者时拒绝预约', async () => {
    const other = {
      ...publishedParticipant,
      leaderOpenIdSnapshot: 'ou_other_leader',
    };
    prisma.perfParticipant.findUnique.mockResolvedValue(other);
    tx.perfParticipant.findUnique.mockResolvedValue(other);

    await expect(
      service.schedule('ou_leader', {
        participantId: 7,
        scheduledStartAt: startAt.toISOString(),
        scheduledEndAt: endAt.toISOString(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('完成面谈须填写纪要，管理侧可读纪要，员工视图不含纪要', async () => {
    prisma.perfInterview.findUnique.mockResolvedValue({
      id: 11,
      participantId: 7,
      status: 'SCHEDULED',
      organizerOpenId: 'ou_leader',
      calendarId: 'primary',
      calendarEventId: 'evt_1',
      resultNotes: null,
      participantOpenIds: ['ou_employee', 'ou_leader'],
      participant: {
        id: 7,
        employeeOpenId: 'ou_employee',
        leaderOpenIdSnapshot: 'ou_leader',
        departmentIdSnapshot: 'od_product',
        cycle: { status: 'ACTIVE' },
      },
    });
    tx.perfInterview.update.mockResolvedValue({
      id: 11,
      status: 'COMPLETED',
      resultNotes: '沟通了等级依据',
      participantId: 7,
      calendarEventId: 'evt_1',
      scheduledStartAt: startAt,
      scheduledEndAt: endAt,
    });

    await expect(service.complete('ou_leader', 11, '')).rejects.toBeInstanceOf(
      ConflictException,
    );

    const completed = await service.complete(
      'ou_leader',
      11,
      '沟通了等级依据',
    );
    expect(completed).toMatchObject({
      status: 'COMPLETED',
      resultNotes: '沟通了等级依据',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'interview.complete' }),
    );

    prisma.perfInterview.findMany.mockResolvedValue([
      {
        id: 11,
        status: 'COMPLETED',
        resultNotes: '沟通了等级依据',
        participantId: 7,
        scheduledStartAt: startAt,
        scheduledEndAt: endAt,
        calendarId: 'primary',
        calendarEventId: 'evt_1',
        participant: {
          employeeOpenId: 'ou_employee',
          cycle: { id: 1, name: '2026年中' },
        },
      },
    ]);
    const mine = await service.listMine('ou_employee');
    expect(mine.items[0]).not.toHaveProperty('resultNotes');
    expect(mine.items[0]).toMatchObject({
      id: 11,
      status: 'COMPLETED',
      calendarEventId: 'evt_1',
    });
  });

  it('改期与取消同步飞书日程', async () => {
    const nextStart = new Date('2026-07-23T10:00:00.000Z');
    const nextEnd = new Date('2026-07-23T11:00:00.000Z');
    prisma.perfInterview.findUnique.mockResolvedValue({
      id: 11,
      participantId: 7,
      status: 'SCHEDULED',
      organizerOpenId: 'ou_leader',
      calendarId: 'primary',
      calendarEventId: 'evt_1',
      participantOpenIds: ['ou_employee', 'ou_leader'],
      participant: {
        id: 7,
        employeeOpenId: 'ou_employee',
        leaderOpenIdSnapshot: 'ou_leader',
        departmentIdSnapshot: 'od_product',
        cycle: { status: 'ACTIVE' },
      },
    });
    tx.perfInterview.update.mockResolvedValue({
      id: 11,
      status: 'SCHEDULED',
      scheduledStartAt: nextStart,
      scheduledEndAt: nextEnd,
      calendarEventId: 'evt_1',
    });

    await service.reschedule('ou_leader', 11, {
      scheduledStartAt: nextStart.toISOString(),
      scheduledEndAt: nextEnd.toISOString(),
    });
    expect(calendar.updateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'evt_1',
        startAt: nextStart,
        endAt: nextEnd,
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'interview.reschedule' }),
    );

    tx.perfInterview.update.mockResolvedValue({
      id: 11,
      status: 'CANCELLED',
      calendarEventId: 'evt_1',
    });
    await service.cancel('ou_leader', 11);
    expect(calendar.cancelEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'evt_1' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'interview.cancel' }),
    );
  });

  it('已完成面谈可更新纪要；已取消不可完成', async () => {
    prisma.perfInterview.findUnique.mockResolvedValue({
      id: 11,
      participantId: 7,
      status: 'COMPLETED',
      organizerOpenId: 'ou_leader',
      calendarId: 'primary',
      calendarEventId: 'evt_1',
      resultNotes: '旧纪要',
      participantOpenIds: ['ou_employee', 'ou_leader'],
      participant: {
        id: 7,
        employeeOpenId: 'ou_employee',
        leaderOpenIdSnapshot: 'ou_leader',
        departmentIdSnapshot: 'od_product',
        cycle: { status: 'ACTIVE' },
      },
    });
    tx.perfInterview.update.mockResolvedValue({
      id: 11,
      status: 'COMPLETED',
      resultNotes: '新纪要',
    });
    await service.updateNotes('ou_leader', 11, '新纪要');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'interview.update' }),
    );

    prisma.perfInterview.findUnique.mockResolvedValue({
      id: 12,
      participantId: 7,
      status: 'CANCELLED',
      organizerOpenId: 'ou_leader',
      calendarId: 'primary',
      calendarEventId: 'evt_2',
      participantOpenIds: ['ou_employee', 'ou_leader'],
      participant: {
        id: 7,
        employeeOpenId: 'ou_employee',
        leaderOpenIdSnapshot: 'ou_leader',
        departmentIdSnapshot: 'od_product',
        cycle: { status: 'ACTIVE' },
      },
    });
    await expect(
      service.complete('ou_leader', 12, '不应成功'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('参与者不存在时预约失败', async () => {
    prisma.perfParticipant.findUnique.mockResolvedValue(null);
    tx.perfParticipant.findUnique.mockResolvedValue(null);
    await expect(
      service.schedule('ou_leader', {
        participantId: 404,
        scheduledStartAt: startAt.toISOString(),
        scheduledEndAt: endAt.toISOString(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
