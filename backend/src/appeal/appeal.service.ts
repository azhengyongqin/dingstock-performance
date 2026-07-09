import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PerfAppealStatus,
  PerfInterviewType,
  PerfNotificationChannel,
  PerfParticipantStatus,
  PerfRole,
} from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../shared/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CalibrationService } from '../calibration/calibration.service';
import { ParticipantService } from '../participant/participant.service';
import { RbacService } from '../rbac/rbac.service';

/** 申诉与面谈（产品 §5.6/§5.7）：申诉 → 面谈 → 处理结论（可触发再校准）→ 员工再确认 */
@Injectable()
export class AppealService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly participantService: ParticipantService,
    private readonly calibrationService: CalibrationService,
    private readonly rbacService: RbacService,
  ) {}

  /** 员工发起申诉（与确认互斥） */
  async create(
    employeeOpenId: string,
    cycleId: number,
    reason: string,
    attachments?: Record<string, unknown>[],
  ) {
    const participant = await this.prisma.perfParticipant.findFirst({
      where: { employeeOpenId, cycleId },
      include: { result: true },
    });
    if (!participant?.result)
      throw new NotFoundException('结果尚未推送，无法申诉');
    if (
      participant.status !== PerfParticipantStatus.RESULT_PUSHED &&
      participant.status !== PerfParticipantStatus.RE_CONFIRMING
    ) {
      throw new ConflictException(
        '当前状态不允许申诉（已确认或流程未到结果阶段）',
      );
    }

    const appeal = await this.prisma.perfAppeal.create({
      data: {
        participantId: participant.id,
        reason,
        attachments: attachments as unknown as
          Prisma.InputJsonValue | undefined,
      },
    });
    await this.participantService.transition(
      employeeOpenId,
      participant.id,
      PerfParticipantStatus.APPEALING,
      reason,
    );
    await this.auditService.record({
      operatorOpenId: employeeOpenId,
      action: 'appeal.create',
      targetType: 'perf_appeal',
      targetId: String(appeal.id),
      after: appeal,
    });
    return appeal;
  }

  async list(filters: { cycleId?: number; status?: PerfAppealStatus }) {
    const appeals = await this.prisma.perfAppeal.findMany({
      where: {
        status: filters.status || undefined,
        participant: filters.cycleId ? { cycleId: filters.cycleId } : undefined,
      },
      include: {
        participant: {
          select: {
            id: true,
            cycleId: true,
            employeeOpenId: true,
            status: true,
            cycle: { select: { id: true, name: true } },
            result: { select: { finalLevel: true } },
          },
        },
      },
      orderBy: { id: 'desc' },
    });

    const openIds = [
      ...new Set(
        appeals.flatMap((appeal) =>
          [appeal.participant.employeeOpenId, appeal.handlerOpenId].filter(
            Boolean,
          ),
        ),
      ),
    ] as string[];
    const users = await this.prisma.larkUser.findMany({
      where: { open_id: { in: openIds } },
      select: { open_id: true, name: true, avatar: true },
    });
    const userMap = new Map(users.map((u) => [u.open_id, u]));

    return {
      items: appeals.map((appeal) => ({
        ...appeal,
        employee: userMap.get(appeal.participant.employeeOpenId) ?? null,
        handler: appeal.handlerOpenId
          ? (userMap.get(appeal.handlerOpenId) ?? null)
          : null,
      })),
      total: appeals.length,
    };
  }

  /** 申诉详情：员工本人或 HR/ADMIN 可见 */
  async detail(operatorOpenId: string, id: number) {
    const appeal = await this.prisma.perfAppeal.findUnique({
      where: { id },
      include: {
        participant: {
          include: {
            cycle: { select: { id: true, name: true } },
            result: true,
          },
        },
        interviews: { orderBy: { id: 'asc' } },
      },
    });
    if (!appeal) throw new NotFoundException('申诉不存在');

    const isOwner = appeal.participant.employeeOpenId === operatorOpenId;
    const isHr = await this.rbacService.hasAnyRole(operatorOpenId, [
      PerfRole.HR,
      PerfRole.ADMIN,
    ]);
    if (!isOwner && !isHr) throw new ForbiddenException('无权查看该申诉');

    const calibrations = await this.calibrationService.history(
      appeal.participantId,
    );
    return { ...appeal, calibrations: calibrations.items };
  }

  /** 指派处理人 */
  async assign(operatorOpenId: string, id: number, handlerOpenId: string) {
    const appeal = await this.prisma.perfAppeal.findUnique({ where: { id } });
    if (!appeal) throw new NotFoundException('申诉不存在');
    const updated = await this.prisma.perfAppeal.update({
      where: { id },
      data: { handlerOpenId },
    });
    await this.auditService.record({
      operatorOpenId,
      action: 'appeal.assign',
      targetType: 'perf_appeal',
      targetId: String(id),
      after: { handlerOpenId },
    });
    return updated;
  }

  /** 添加申诉面谈记录；申诉进入面谈处理中 */
  async addInterview(
    operatorOpenId: string,
    appealId: number,
    input: {
      participantOpenIds?: string[];
      content?: string;
      employeeFeedback?: string;
      conclusion?: string;
    },
  ) {
    const appeal = await this.prisma.perfAppeal.findUnique({
      where: { id: appealId },
      include: { participant: true },
    });
    if (!appeal) throw new NotFoundException('申诉不存在');
    if (appeal.status === PerfAppealStatus.RESOLVED) {
      throw new ConflictException('申诉已处理完成');
    }

    const interview = await this.prisma.$transaction(async (tx) => {
      const created = await tx.perfInterview.create({
        data: {
          participantId: appeal.participantId,
          appealId,
          type: PerfInterviewType.APPEAL,
          participantOpenIds: input.participantOpenIds ?? [operatorOpenId],
          content: input.content,
          employeeFeedback: input.employeeFeedback,
          conclusion: input.conclusion,
        },
      });
      if (appeal.status === PerfAppealStatus.PENDING) {
        await tx.perfAppeal.update({
          where: { id: appealId },
          data: { status: PerfAppealStatus.IN_INTERVIEW },
        });
      }
      return created;
    });
    await this.auditService.record({
      operatorOpenId,
      action: 'interview.create',
      targetType: 'perf_appeal',
      targetId: String(appealId),
      after: interview,
    });
    return interview;
  }

  /** 选择性面谈（不关联申诉，Leader/HR 发起） */
  async addOptionalInterview(
    operatorOpenId: string,
    participantId: number,
    input: {
      participantOpenIds?: string[];
      content?: string;
      conclusion?: string;
    },
  ) {
    const participant = await this.prisma.perfParticipant.findUnique({
      where: { id: participantId },
    });
    if (!participant) throw new NotFoundException('参与者不存在');
    const isLeader = participant.leaderOpenIdSnapshot === operatorOpenId;
    const isHr = await this.rbacService.hasAnyRole(operatorOpenId, [
      PerfRole.HR,
      PerfRole.ADMIN,
    ]);
    if (!isLeader && !isHr)
      throw new ForbiddenException('仅直属 Leader 或 HR 可发起面谈');

    const interview = await this.prisma.perfInterview.create({
      data: {
        participantId,
        type: PerfInterviewType.OPTIONAL,
        participantOpenIds: input.participantOpenIds ?? [operatorOpenId],
        content: input.content,
        conclusion: input.conclusion,
      },
    });
    await this.auditService.record({
      operatorOpenId,
      action: 'interview.create',
      targetType: 'perf_participant',
      targetId: String(participantId),
      after: interview,
    });
    return interview;
  }

  /**
   * 处理申诉结论：可选触发结果调整（走校准 append-only 记录 + 更新结果等级），
   * 参与者 APPEALING → RE_CONFIRMING，通知员工再次确认。
   */
  async resolve(
    operatorOpenId: string,
    id: number,
    input: { conclusion: string; adjustedLevel?: string; reason?: string },
  ) {
    const appeal = await this.prisma.perfAppeal.findUnique({
      where: { id },
      include: { participant: { include: { result: true } } },
    });
    if (!appeal) throw new NotFoundException('申诉不存在');
    if (appeal.status === PerfAppealStatus.RESOLVED)
      throw new ConflictException('申诉已处理');

    const resultAdjusted = Boolean(input.adjustedLevel);
    if (resultAdjusted) {
      if (!input.reason) throw new BadRequestException('调整结果必须填写原因');
      // append-only 校准记录 + 同步最终结果等级
      await this.calibrationService.adjust(
        operatorOpenId,
        appeal.participantId,
        input.adjustedLevel!,
        `申诉处理：${input.reason}`,
      );
      if (appeal.participant.result) {
        await this.prisma.perfResult.update({
          where: { id: appeal.participant.result.id },
          data: { finalLevel: input.adjustedLevel! },
        });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.perfAppeal.update({
        where: { id },
        data: {
          status: PerfAppealStatus.RESOLVED,
          conclusion: input.conclusion,
          resultAdjusted,
          resolvedAt: new Date(),
          handlerOpenId: appeal.handlerOpenId ?? operatorOpenId,
        },
      });
      await tx.perfNotification.create({
        data: {
          receiverOpenId: appeal.participant.employeeOpenId,
          channel: PerfNotificationChannel.BOT_DM,
          template: 'appeal_resolved',
          payload: {
            appealId: id,
            cycleId: appeal.participant.cycleId,
            resultAdjusted,
          },
        },
      });
    });
    await this.participantService.transition(
      operatorOpenId,
      appeal.participantId,
      PerfParticipantStatus.RE_CONFIRMING,
      input.conclusion,
    );
    await this.auditService.record({
      operatorOpenId,
      action: 'appeal.resolve',
      targetType: 'perf_appeal',
      targetId: String(id),
      after: { conclusion: input.conclusion, resultAdjusted },
      reason: input.reason,
    });
    return { ok: true };
  }
}
