import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PerfAppealStatus,
  PerfInterviewType,
  PerfParticipantStatus,
  PerfRole,
} from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../shared/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CalibrationService } from '../calibration/calibration.service';
import { ResultService } from '../calibration/result.service';
import { RbacService } from '../rbac/rbac.service';

/** 申诉与面谈（产品 §5.6/§5.7）：申诉 → 面谈 → 处理结论（可触发再校准）→ 员工再确认 */
@Injectable()
export class AppealService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly calibrationService: CalibrationService,
    private readonly resultService: ResultService,
    private readonly rbacService: RbacService,
  ) {}

  /** 员工只能针对当前未确认结果版本发起一次申诉。 */
  async create(
    employeeOpenId: string,
    participantId: number,
    resultVersionId: number,
    reason: string,
    attachments?: Record<string, unknown>[],
  ) {
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw new ConflictException('申诉理由不能为空');
    const appeal = await this.prisma.$transaction(async (tx) => {
      await this.lockAppealAggregate(tx, participantId);
      const participant = await tx.perfParticipant.findUnique({
        where: { id: participantId },
        include: {
          resultVersions: {
            where: { supersededAt: null, invalidatedAt: null },
            orderBy: { version: 'desc' },
            take: 1,
            select: {
              id: true,
              version: true,
              supersededAt: true,
              confirmedAt: true,
            },
          },
          appeals: {
            where: { invalidatedAt: null },
            select: { id: true, status: true },
            take: 1,
          },
        },
      });
      if (!participant || participant.employeeOpenId !== employeeOpenId) {
        throw new NotFoundException('结果尚未发布，无法申诉');
      }
      if (participant.appeals.length > 0) {
        throw new ConflictException('每人每周期只能发起一次申诉');
      }
      if (participant.status !== PerfParticipantStatus.RESULT_PUBLISHED) {
        throw new ConflictException('当前状态不允许申诉');
      }
      const currentVersion = participant.resultVersions[0];
      if (!currentVersion || currentVersion.id !== resultVersionId) {
        throw new ConflictException({
          code: 'RESULT_VERSION_STALE',
          message: '结果版本已更新，请刷新后针对当前版本申诉',
        });
      }
      if (currentVersion.confirmedAt) {
        throw new ConflictException('该结果版本已确认，不能再申诉');
      }
      const created = await tx.perfAppeal.create({
        data: {
          participantId,
          resultVersionId,
          reason: normalizedReason,
          attachments: attachments as unknown as
            Prisma.InputJsonValue | undefined,
        },
      });
      await tx.perfParticipant.update({
        where: { id: participantId },
        data: { status: PerfParticipantStatus.APPEALING },
      });
      return created;
    });
    await this.auditService.record({
      operatorOpenId: employeeOpenId,
      action: 'appeal.create',
      targetType: 'perf_appeal',
      targetId: String(appeal.id),
      after: appeal,
    });
    return appeal;
  }

  async list(
    operatorOpenId: string,
    filters: { cycleId?: number; status?: PerfAppealStatus },
  ) {
    const scope = await this.managementScope(operatorOpenId);
    const appeals = await this.prisma.perfAppeal.findMany({
      where: {
        status: filters.status || undefined,
        invalidatedAt: null,
        participant: {
          ...(filters.cycleId ? { cycleId: filters.cycleId } : {}),
          ...scope,
        },
      },
      include: {
        participant: {
          select: {
            id: true,
            cycleId: true,
            employeeOpenId: true,
            status: true,
            cycle: { select: { id: true, name: true } },
            resultVersions: {
              where: { supersededAt: null, invalidatedAt: null },
              select: { id: true, version: true, finalLevel: true },
              take: 1,
            },
          },
        },
        resultVersion: {
          select: {
            id: true,
            version: true,
            finalLevel: true,
            publishedAt: true,
          },
        },
        resolutionCalibration: {
          select: {
            id: true,
            beforeLevel: true,
            afterLevel: true,
            createdAt: true,
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
          select: {
            id: true,
            employeeOpenId: true,
            status: true,
            leaderOpenIdSnapshot: true,
            departmentIdSnapshot: true,
            cycle: { select: { id: true, name: true } },
            resultVersions: {
              orderBy: { version: 'asc' },
              select: {
                id: true,
                version: true,
                finalLevel: true,
                publishedAt: true,
                supersededAt: true,
                confirmedAt: true,
              },
            },
          },
        },
        resultVersion: {
          select: {
            id: true,
            version: true,
            finalLevel: true,
            employeeExplanation: true,
            publishedAt: true,
            supersededAt: true,
            confirmedAt: true,
          },
        },
        resolutionCalibration: {
          select: {
            id: true,
            beforeLevel: true,
            afterLevel: true,
            createdAt: true,
          },
        },
        interviews: { orderBy: { id: 'asc' } },
      },
    });
    if (!appeal) throw new NotFoundException('申诉不存在');
    const isOwner = appeal.participant.employeeOpenId === operatorOpenId;
    if (!isOwner)
      await this.assertCanManage(operatorOpenId, appeal.participant);

    // 员工详情必须显式白名单，不能把组织/Leader 快照与内部校准字段整行透出。
    if (isOwner) {
      return {
        id: appeal.id,
        participantId: appeal.participantId,
        resultVersionId: appeal.resultVersionId,
        reason: appeal.reason,
        attachments: appeal.attachments,
        status: appeal.status,
        conclusion: appeal.conclusion,
        resultAdjusted: appeal.resultAdjusted,
        resolvedAt: appeal.resolvedAt,
        createdAt: appeal.createdAt,
        updatedAt: appeal.updatedAt,
        resultVersion: appeal.resultVersion,
        resolutionCalibration: appeal.resolutionCalibration,
        interviews: appeal.interviews,
        participant: {
          id: appeal.participant.id,
          status: appeal.participant.status,
          cycle: appeal.participant.cycle,
          resultVersions: appeal.participant.resultVersions,
        },
      };
    }
    const calibrations = await this.calibrationService.history(
      appeal.participantId,
    );
    return { ...appeal, calibrations: calibrations.items };
  }

  /** 指派处理人 */
  async assign(operatorOpenId: string, id: number, handlerOpenId: string) {
    const appeal = await this.prisma.perfAppeal.findUnique({
      where: { id },
      include: { participant: true },
    });
    if (!appeal) throw new NotFoundException('申诉不存在');
    if (appeal.invalidatedAt) {
      throw new ConflictException('申诉已因周期整体退回而失效');
    }
    await this.assertCanManage(operatorOpenId, appeal.participant);
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
    const interview = await this.prisma.$transaction(async (tx) => {
      const identity = await tx.perfAppeal.findUnique({
        where: { id: appealId },
        select: { participantId: true },
      });
      if (!identity) throw new NotFoundException('申诉不存在');
      await this.lockAppealAggregate(tx, identity.participantId);
      const appeal = await tx.perfAppeal.findUnique({
        where: { id: appealId },
        include: { participant: true },
      });
      if (!appeal) throw new NotFoundException('申诉不存在');
      if (appeal.invalidatedAt) {
        throw new ConflictException('申诉已因周期整体退回而失效');
      }
      await this.assertCanManage(operatorOpenId, appeal.participant);
      if (appeal.status === PerfAppealStatus.RESOLVED) {
        throw new ConflictException('申诉已处理完成');
      }
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
    await this.assertCanManage(operatorOpenId, participant);

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

  /** 关闭申诉；结果版本判断、状态变化和条件更新在同一聚合事务内完成。 */
  async resolve(
    operatorOpenId: string,
    id: number,
    input: {
      conclusion: string;
      expectedCalibrationRevision: number;
      reason?: string;
    },
  ) {
    const conclusion = input.conclusion.trim();
    if (!conclusion) throw new ConflictException('处理结论不能为空');
    const outcome = await this.prisma.$transaction(async (tx) => {
      const identity = await tx.perfAppeal.findUnique({
        where: { id },
        select: { participantId: true },
      });
      if (!identity) throw new NotFoundException('申诉不存在');
      // 申诉写入口统一按 participant → versions/calibrations/appeals 顺序加锁，避免死锁。
      await this.lockAppealAggregate(tx, identity.participantId);
      const appeal = await tx.perfAppeal.findUnique({
        where: { id },
        include: { participant: true },
      });
      if (!appeal) throw new NotFoundException('申诉不存在');
      if (appeal.invalidatedAt) {
        throw new ConflictException('申诉已因周期整体退回而失效');
      }
      if (appeal.status === PerfAppealStatus.RESOLVED) {
        throw new ConflictException('申诉已处理');
      }
      await this.assertCanManage(operatorOpenId, appeal.participant);
      const versionOutcome = await this.resultService.resolveAppeal(
        {
          appealId: id,
          participantId: appeal.participantId,
          appealedResultVersionId: appeal.resultVersionId,
          expectedCalibrationRevision: input.expectedCalibrationRevision,
          operatorOpenId,
        },
        tx,
      );
      const updated = await tx.perfAppeal.updateMany({
        where: { id, status: { not: PerfAppealStatus.RESOLVED } },
        data: {
          status: PerfAppealStatus.RESOLVED,
          conclusion,
          resultAdjusted: versionOutcome.changed,
          resolutionCalibrationId: versionOutcome.resolutionCalibrationId,
          resolvedAt: new Date(),
          handlerOpenId: appeal.handlerOpenId ?? operatorOpenId,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException('申诉已被其他处理人关闭，请刷新');
      }
      return versionOutcome;
    });
    await this.auditService.record({
      operatorOpenId,
      action: 'appeal.resolve',
      targetType: 'perf_appeal',
      targetId: String(id),
      after: {
        conclusion,
        resultAdjusted: outcome.changed,
        resultVersionId: outcome.resultVersionId,
        resolutionCalibrationId: outcome.resolutionCalibrationId,
      },
      reason: input.reason,
    });
    return {
      ok: true,
      resultAdjusted: outcome.changed,
      resultVersionId: outcome.resultVersionId,
    };
  }

  private async managementScope(operatorOpenId: string) {
    const isManagement = await this.rbacService.hasAnyRole(operatorOpenId, [
      PerfRole.HR,
      PerfRole.ADMIN,
    ]);
    if (!isManagement) return { leaderOpenIdSnapshot: operatorOpenId };
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
    if (!isManagement) throw new ForbiddenException('无权处理该申诉');
    const scope = await this.rbacService.getOrgScope(operatorOpenId);
    if (
      scope !== null &&
      (!participant.departmentIdSnapshot ||
        !scope.includes(participant.departmentIdSnapshot))
    ) {
      throw new ForbiddenException('该参与者不在你的 HR 授权组织范围内');
    }
  }

  private async lockAppealAggregate(
    tx: Prisma.TransactionClient,
    participantId: number,
  ) {
    // 与校准/结果服务共享 cycle → participant 前缀；取得 participant 后，
    // 本申诉聚合再按 versions → calibrations → appeals 的固定顺序补齐历史锁。
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
    await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id" FROM "performance"."perf_result_versions"
      WHERE "participant_id" = ${participantId}
      ORDER BY "version" DESC
      FOR UPDATE
    `;
    await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id" FROM "performance"."perf_calibrations"
      WHERE "participant_id" = ${participantId}
      ORDER BY "id" DESC
      FOR UPDATE
    `;
    await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id" FROM "performance"."perf_appeals"
      WHERE "participant_id" = ${participantId}
      FOR UPDATE
    `;
  }
}
