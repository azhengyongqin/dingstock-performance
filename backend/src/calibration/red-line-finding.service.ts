import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ManagerStageResultService } from '../evaluation/manager-stage-result.service';
import type { Prisma } from '../generated/prisma/client';
import {
  PerfCycleStatus,
  PerfRedLineAction,
  PerfRole,
} from '../generated/prisma/enums';
import { RbacService } from '../rbac/rbac.service';
import { PrismaService } from '../shared/database/prisma.service';

export type ConfirmRedLineInput = {
  findingType: string;
  facts: string;
  evidence: unknown;
  reason: string;
};

/**
 * 红线事实服务：确认与撤销都只追加事件，权限仅开放给授权 HR/Admin。
 * 每次事件与 MANAGER 阶段重算在同一事务，避免红线状态和权威阶段等级短暂分裂。
 */
@Injectable()
export class RedLineFindingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbacService: RbacService,
    private readonly auditService: AuditService,
    private readonly managerStageResultService: ManagerStageResultService,
  ) {}

  async confirm(
    operatorOpenId: string,
    participantId: number,
    input: ConfirmRedLineInput,
  ) {
    const normalized = this.validateConfirmation(input);
    const finding = await this.prisma.$transaction(async (tx) => {
      const participant = await this.lockAndRequireParticipant(
        tx,
        participantId,
      );
      await this.assertHrOrAdminScope(operatorOpenId, participant);
      const created = await tx.perfRedLineFinding.create({
        data: {
          participantId,
          action: PerfRedLineAction.CONFIRM,
          ...normalized,
          operatorOpenId,
        },
      });
      await this.managerStageResultService.recalculate(participantId, tx);
      await tx.perfResult.updateMany({
        where: { participantId, archivedAt: null },
        data: { finalLevel: 'C' },
      });
      return created;
    });
    await this.auditService.record({
      operatorOpenId,
      action: 'red_line.confirm',
      targetType: 'perf_participant',
      targetId: String(participantId),
      after: { findingId: finding.id, findingType: normalized.findingType },
      reason: normalized.reason,
    });
    return finding;
  }

  async revoke(
    operatorOpenId: string,
    participantId: number,
    findingId: number,
    reason: string,
  ) {
    const normalizedReason = this.requireText(reason, '撤销原因');
    const finding = await this.prisma.$transaction(async (tx) => {
      const participant = await this.lockAndRequireParticipant(
        tx,
        participantId,
      );
      await this.assertHrOrAdminScope(operatorOpenId, participant);
      const confirmed = await tx.perfRedLineFinding.findUnique({
        where: { id: findingId },
        include: { revokedBy: { select: { id: true } } },
      });
      if (
        !confirmed ||
        confirmed.participantId !== participantId ||
        confirmed.action !== PerfRedLineAction.CONFIRM
      ) {
        throw new NotFoundException('有效红线确认不存在');
      }
      if (confirmed.revokedBy.length > 0) {
        throw new ConflictException('该红线确认已被撤销，不能重复撤销');
      }
      const created = await tx.perfRedLineFinding.create({
        data: {
          participantId,
          action: PerfRedLineAction.REVOKE,
          findingType: confirmed.findingType,
          facts: confirmed.facts,
          evidence: confirmed.evidence as Prisma.InputJsonValue,
          reason: normalizedReason,
          revokeOfId: confirmed.id,
          operatorOpenId,
        },
      });
      const managerResult = await this.managerStageResultService.recalculate(
        participantId,
        tx,
      );
      const [remainingRedLine, latestCalibration] = await Promise.all([
        tx.perfRedLineFinding.findFirst({
          where: {
            participantId,
            action: PerfRedLineAction.CONFIRM,
            revokedBy: { none: {} },
          },
          select: { id: true },
        }),
        tx.perfCalibration.findFirst({
          where: { participantId, invalidatedAt: null },
          select: { afterLevel: true },
          orderBy: { id: 'desc' },
        }),
      ]);
      const restoredLevel = remainingRedLine
        ? 'C'
        : (latestCalibration?.afterLevel ?? managerResult.stageLevel);
      if (restoredLevel) {
        await tx.perfResult.updateMany({
          where: { participantId, archivedAt: null },
          data: { finalLevel: restoredLevel },
        });
      }
      return created;
    });
    await this.auditService.record({
      operatorOpenId,
      action: 'red_line.revoke',
      targetType: 'perf_participant',
      targetId: String(participantId),
      before: { findingId },
      after: { revokeEventId: finding.id },
      reason: normalizedReason,
    });
    return finding;
  }

  private validateConfirmation(input: ConfirmRedLineInput) {
    const evidence = input.evidence;
    const isNonEmptyArray = Array.isArray(evidence) && evidence.length > 0;
    const isNonEmptyObject =
      evidence !== null &&
      typeof evidence === 'object' &&
      !Array.isArray(evidence) &&
      Object.keys(evidence).length > 0;
    // 与数据库 JSONB CHECK 对齐，避免原始字符串/数字落库时才暴露为内部错误。
    if (!isNonEmptyArray && !isNonEmptyObject) {
      throw new BadRequestException('确认红线必须提供证据');
    }
    return {
      findingType: this.requireText(input.findingType, '红线类型'),
      facts: this.requireText(input.facts, '事实说明'),
      evidence: evidence as Prisma.InputJsonValue,
      reason: this.requireText(input.reason, '确认原因'),
    };
  }

  private requireText(value: string, field: string) {
    const normalized = value?.trim();
    if (!normalized) throw new BadRequestException(`${field}不能为空`);
    return normalized;
  }

  private async lockAndRequireParticipant(
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
      SELECT "id"
      FROM "performance"."perf_participants"
      WHERE "id" = ${participantId}
      FOR UPDATE
    `;
    if (participants.length !== 1) throw new NotFoundException('参与者不存在');
    const participant = await tx.perfParticipant.findUnique({
      where: { id: participantId },
      include: { cycle: { select: { status: true, deletedAt: true } } },
    });
    if (!participant || participant.cycle.deletedAt) {
      throw new NotFoundException('参与者不存在');
    }
    if (participant.cycle.status !== PerfCycleStatus.ACTIVE) {
      throw new ConflictException('只有进行中的周期可以确认或撤销红线');
    }
    return participant;
  }

  private async assertHrOrAdminScope(
    operatorOpenId: string,
    participant: { departmentIdSnapshot: string | null },
  ) {
    const allowed = await this.rbacService.hasAnyRole(operatorOpenId, [
      PerfRole.HR,
      PerfRole.ADMIN,
    ]);
    if (!allowed)
      throw new ForbiddenException('只有 HR/Admin 可以确认或撤销红线');
    const scope = await this.rbacService.getOrgScope(operatorOpenId);
    if (
      scope !== null &&
      (!participant.departmentIdSnapshot ||
        !scope.includes(participant.departmentIdSnapshot))
    ) {
      throw new ForbiddenException('该参与者不在你的 HR 授权组织范围内');
    }
  }
}
