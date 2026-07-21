import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PerfAppealStatus,
  PerfCycleStatus,
  PerfInterviewStatus,
  PerfInterviewType,
  PerfParticipantStatus,
  PerfRole,
} from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { RbacService } from '../rbac/rbac.service';
import { PrismaService } from '../shared/database/prisma.service';
import {
  INTERVIEW_CALENDAR_PORT,
  type InterviewCalendarPort,
} from './interview-calendar.port';

const SCHEDULABLE_STATUSES: PerfParticipantStatus[] = [
  PerfParticipantStatus.RESULT_PUBLISHED,
  PerfParticipantStatus.APPEALING,
  PerfParticipantStatus.RE_CONFIRMING,
  PerfParticipantStatus.CONFIRMED,
];

type ScheduleInput = {
  participantId: number;
  scheduledStartAt: string;
  scheduledEndAt: string;
  extraAttendeeOpenIds?: string[];
  appealId?: number | null;
};

type RescheduleInput = {
  scheduledStartAt: string;
  scheduledEndAt: string;
};

@Injectable()
export class InterviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly rbacService: RbacService,
    private readonly authService: AuthService,
    @Inject(INTERVIEW_CALENDAR_PORT)
    private readonly calendar: InterviewCalendarPort,
  ) {}

  async schedule(operatorOpenId: string, input: ScheduleInput) {
    const startAt = this.parseRange(input.scheduledStartAt, input.scheduledEndAt);
    const participant = await this.loadWritableParticipant(input.participantId);
    await this.assertCanManage(operatorOpenId, participant);
    this.assertSchedulable(participant.status);
    // 关联校验放在建日程前，避免无效业务请求留下飞书事件
    if (input.appealId != null) {
      await this.assertLinkableAppeal(input.appealId, input.participantId);
    }

    const attendeeOpenIds = this.buildAttendees(
      participant.employeeOpenId,
      operatorOpenId,
      input.extraAttendeeOpenIds,
    );
    const userAccessToken =
      await this.authService.requireUserAccessToken(operatorOpenId);
    const event = await this.calendar.createEvent({
      userAccessToken,
      summary: `绩效面谈 · ${participant.cycle.name}`,
      description: '绩效结果沟通面谈',
      startAt: startAt.start,
      endAt: startAt.end,
      attendeeOpenIds,
    });

    const interview = await this.prisma.$transaction(async (tx) => {
      await this.lockParticipant(tx, input.participantId);
      const locked = await this.loadWritableParticipant(
        input.participantId,
        tx,
      );
      await this.assertCanManage(operatorOpenId, locked);
      this.assertSchedulable(locked.status);
      if (input.appealId != null) {
        await this.assertLinkableAppeal(input.appealId, input.participantId, tx);
      }
      return tx.perfInterview.create({
        data: {
          participantId: input.participantId,
          appealId: input.appealId ?? null,
          // 遗留 type 列仍必填；业务分支只看 appealId（ticket 3 收缩枚举）
          type: input.appealId
            ? PerfInterviewType.APPEAL
            : PerfInterviewType.OPTIONAL,
          status: PerfInterviewStatus.SCHEDULED,
          organizerOpenId: operatorOpenId,
          scheduledStartAt: startAt.start,
          scheduledEndAt: startAt.end,
          calendarId: event.calendarId,
          calendarEventId: event.eventId,
          participantOpenIds: attendeeOpenIds,
        },
      });
    });

    await this.auditService.record({
      operatorOpenId,
      action: 'interview.schedule',
      targetType: 'perf_interview',
      targetId: String(interview.id),
      after: interview,
    });
    return interview;
  }

  /** 编辑弱关联：设置或清空 appealId，不改申诉状态 */
  async linkAppeal(
    operatorOpenId: string,
    id: number,
    appealId: number | null,
  ) {
    const current = await this.loadManageableInterview(operatorOpenId, id);
    if (appealId != null) {
      await this.assertLinkableAppeal(appealId, current.participantId);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockParticipant(tx, current.participantId);
      if (appealId != null) {
        await this.assertLinkableAppeal(appealId, current.participantId, tx);
      }
      return tx.perfInterview.update({
        where: { id },
        data: {
          appealId,
          type:
            appealId != null
              ? PerfInterviewType.APPEAL
              : PerfInterviewType.OPTIONAL,
        },
      });
    });

    await this.auditService.record({
      operatorOpenId,
      action: 'interview.update',
      targetType: 'perf_interview',
      targetId: String(id),
      after: { appealId: updated.appealId },
    });
    return updated;
  }

  async reschedule(
    operatorOpenId: string,
    id: number,
    input: RescheduleInput,
  ) {
    const range = this.parseRange(input.scheduledStartAt, input.scheduledEndAt);
    const current = await this.loadManageableInterview(operatorOpenId, id);
    if (current.status !== PerfInterviewStatus.SCHEDULED) {
      throw new ConflictException('仅已预约的面谈可以改期');
    }
    if (!current.calendarId || !current.calendarEventId) {
      throw new ConflictException('面谈缺少飞书日程关联，无法改期');
    }

    const userAccessToken =
      await this.authService.requireUserAccessToken(operatorOpenId);
    await this.calendar.updateEvent({
      userAccessToken,
      calendarId: current.calendarId,
      eventId: current.calendarEventId,
      startAt: range.start,
      endAt: range.end,
      attendeeOpenIds: current.participantOpenIds,
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockParticipant(tx, current.participantId);
      return tx.perfInterview.update({
        where: { id },
        data: {
          scheduledStartAt: range.start,
          scheduledEndAt: range.end,
        },
      });
    });

    await this.auditService.record({
      operatorOpenId,
      action: 'interview.reschedule',
      targetType: 'perf_interview',
      targetId: String(id),
      after: updated,
    });
    return updated;
  }

  async cancel(operatorOpenId: string, id: number) {
    const current = await this.loadManageableInterview(operatorOpenId, id);
    if (current.status !== PerfInterviewStatus.SCHEDULED) {
      throw new ConflictException('仅已预约的面谈可以取消');
    }
    if (!current.calendarId || !current.calendarEventId) {
      throw new ConflictException('面谈缺少飞书日程关联，无法取消');
    }

    const userAccessToken =
      await this.authService.requireUserAccessToken(operatorOpenId);
    await this.calendar.cancelEvent({
      userAccessToken,
      calendarId: current.calendarId,
      eventId: current.calendarEventId,
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockParticipant(tx, current.participantId);
      return tx.perfInterview.update({
        where: { id },
        data: { status: PerfInterviewStatus.CANCELLED },
      });
    });

    await this.auditService.record({
      operatorOpenId,
      action: 'interview.cancel',
      targetType: 'perf_interview',
      targetId: String(id),
      after: updated,
    });
    return updated;
  }

  async complete(operatorOpenId: string, id: number, resultNotes: string) {
    const notes = resultNotes.trim();
    if (!notes) throw new ConflictException('完成面谈须填写结果纪要');

    const current = await this.loadManageableInterview(operatorOpenId, id);
    if (current.status === PerfInterviewStatus.CANCELLED) {
      throw new ConflictException('已取消的面谈不能完成');
    }
    if (current.status === PerfInterviewStatus.COMPLETED) {
      throw new ConflictException('面谈已完成，请使用更新纪要');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockParticipant(tx, current.participantId);
      return tx.perfInterview.update({
        where: { id },
        data: {
          status: PerfInterviewStatus.COMPLETED,
          resultNotes: notes,
        },
      });
    });

    await this.auditService.record({
      operatorOpenId,
      action: 'interview.complete',
      targetType: 'perf_interview',
      targetId: String(id),
      after: updated,
    });
    return updated;
  }

  async updateNotes(operatorOpenId: string, id: number, resultNotes: string) {
    const notes = resultNotes.trim();
    if (!notes) throw new ConflictException('结果纪要不能为空');

    const current = await this.loadManageableInterview(operatorOpenId, id);
    if (current.status !== PerfInterviewStatus.COMPLETED) {
      throw new ConflictException('仅已完成的面谈可更新纪要');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockParticipant(tx, current.participantId);
      return tx.perfInterview.update({
        where: { id },
        data: { resultNotes: notes },
      });
    });

    await this.auditService.record({
      operatorOpenId,
      action: 'interview.update',
      targetType: 'perf_interview',
      targetId: String(id),
      after: updated,
    });
    return updated;
  }

  /** 管理侧列表：含纪要 */
  async listForManager(
    operatorOpenId: string,
    query?: { status?: PerfInterviewStatus },
  ) {
    const scopeWhere = await this.managerParticipantWhere(operatorOpenId);
    const items = await this.prisma.perfInterview.findMany({
      where: {
        status: query?.status,
        participant: scopeWhere,
      },
      include: {
        participant: {
          select: {
            id: true,
            employeeOpenId: true,
            status: true,
            cycle: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ scheduledStartAt: 'desc' }, { id: 'desc' }],
    });
    const openIds = [
      ...new Set(
        items.flatMap((item) => [
          item.participant.employeeOpenId,
          item.organizerOpenId,
          ...item.participantOpenIds,
        ]),
      ),
    ];
    const users = await this.prisma.larkUser.findMany({
      where: { open_id: { in: openIds } },
      select: { open_id: true, name: true, avatar: true },
    });
    const userMap = new Map(users.map((u) => [u.open_id, u]));
    return {
      items: items.map((item) => ({
        ...item,
        employee: userMap.get(item.participant.employeeOpenId) ?? null,
        organizer: userMap.get(item.organizerOpenId) ?? null,
      })),
      total: items.length,
    };
  }

  async getForManager(operatorOpenId: string, id: number) {
    const interview = await this.loadManageableInterview(operatorOpenId, id);
    return interview;
  }

  /** 员工本人预约只读视图：不含结果纪要 */
  async listMine(employeeOpenId: string) {
    const items = await this.prisma.perfInterview.findMany({
      where: { participant: { employeeOpenId } },
      include: {
        participant: {
          select: {
            id: true,
            employeeOpenId: true,
            cycle: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ scheduledStartAt: 'desc' }, { id: 'desc' }],
    });
    return {
      items: items.map(
        ({
          resultNotes: _notes,
          content: _content,
          conclusion: _conclusion,
          employeeFeedback: _feedback,
          ...rest
        }) => rest,
      ),
      total: items.length,
    };
  }

  private parseRange(startRaw: string, endRaw: string) {
    const start = new Date(startRaw);
    const end = new Date(endRaw);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new ConflictException('面谈时间无效');
    }
    if (end <= start) {
      throw new ConflictException('面谈结束时间必须晚于开始时间');
    }
    return { start, end };
  }

  private buildAttendees(
    employeeOpenId: string,
    operatorOpenId: string,
    extra?: string[],
  ) {
    const set = new Set<string>([employeeOpenId, operatorOpenId]);
    for (const id of extra ?? []) {
      if (id.trim()) set.add(id.trim());
    }
    return [...set];
  }

  private assertSchedulable(status: PerfParticipantStatus) {
    if (!SCHEDULABLE_STATUSES.includes(status)) {
      throw new ConflictException(
        '仅结果已推送及之后的参与者可预约绩效面谈',
      );
    }
  }

  /** 校验可选申诉关联：同参与者、未失效、未结案；不修改申诉行 */
  private async assertLinkableAppeal(
    appealId: number,
    participantId: number,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const appeal = await db.perfAppeal.findUnique({
      where: { id: appealId },
      select: {
        id: true,
        participantId: true,
        status: true,
        invalidatedAt: true,
      },
    });
    if (!appeal) throw new NotFoundException('关联申诉不存在');
    if (appeal.participantId !== participantId) {
      throw new ConflictException('关联申诉必须属于同一参与者');
    }
    if (appeal.invalidatedAt) {
      throw new ConflictException('关联申诉已失效');
    }
    if (appeal.status === PerfAppealStatus.RESOLVED) {
      throw new ConflictException('已结案的申诉不能再关联面谈');
    }
  }

  private assertCycleWritable(cycleStatus: PerfCycleStatus) {
    if (cycleStatus === PerfCycleStatus.ARCHIVED) {
      throw new ConflictException('周期已归档，面谈不可修改');
    }
  }

  private async loadWritableParticipant(
    participantId: number,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const participant = await db.perfParticipant.findUnique({
      where: { id: participantId },
      include: { cycle: { select: { id: true, name: true, status: true } } },
    });
    if (!participant) throw new NotFoundException('参与者不存在');
    this.assertCycleWritable(participant.cycle.status);
    return participant;
  }

  private async loadManageableInterview(operatorOpenId: string, id: number) {
    const interview = await this.prisma.perfInterview.findUnique({
      where: { id },
      include: {
        participant: {
          include: { cycle: { select: { id: true, name: true, status: true } } },
        },
      },
    });
    if (!interview) throw new NotFoundException('面谈不存在');
    this.assertCycleWritable(interview.participant.cycle.status);
    await this.assertCanManage(operatorOpenId, interview.participant);
    return interview;
  }

  private async managerParticipantWhere(operatorOpenId: string) {
    const isManagement = await this.rbacService.hasAnyRole(operatorOpenId, [
      PerfRole.HR,
      PerfRole.ADMIN,
    ]);
    if (!isManagement) {
      return { leaderOpenIdSnapshot: operatorOpenId };
    }
    const scope = await this.rbacService.getOrgScope(operatorOpenId);
    if (scope === null) return {};
    return {
      OR: [
        { leaderOpenIdSnapshot: operatorOpenId },
        { departmentIdSnapshot: { in: scope } },
      ],
    };
  }

  private async assertCanManage(
    operatorOpenId: string,
    participant: {
      leaderOpenIdSnapshot: string | null;
      departmentIdSnapshot: string | null;
    },
  ) {
    if (participant.leaderOpenIdSnapshot === operatorOpenId) return;
    const isManagement = await this.rbacService.hasAnyRole(operatorOpenId, [
      PerfRole.HR,
      PerfRole.ADMIN,
    ]);
    if (!isManagement) throw new ForbiddenException('无权操作该面谈');
    const scope = await this.rbacService.getOrgScope(operatorOpenId);
    if (
      scope !== null &&
      (!participant.departmentIdSnapshot ||
        !scope.includes(participant.departmentIdSnapshot))
    ) {
      throw new ForbiddenException('该参与者不在你的 HR 授权组织范围内');
    }
  }

  private async lockParticipant(
    tx: Prisma.TransactionClient,
    participantId: number,
  ) {
    const cycles = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT cycle."id"
      FROM "performance"."perf_cycles" AS cycle
      JOIN "performance"."perf_participants" AS participant
        ON participant."cycle_id" = cycle."id"
      WHERE participant."id" = ${participantId}
      FOR UPDATE OF cycle
    `;
    if (cycles.length !== 1) throw new NotFoundException('参与者不存在');
    const participants = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id" FROM "performance"."perf_participants"
      WHERE "id" = ${participantId}
      FOR UPDATE
    `;
    if (participants.length !== 1) throw new NotFoundException('参与者不存在');
  }
}
