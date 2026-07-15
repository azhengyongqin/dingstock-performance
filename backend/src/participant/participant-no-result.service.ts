import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PerfAssignmentStatus,
  PerfCycleStatus,
  PerfEvaluationTaskType,
  PerfParticipantStatus,
  PerfReviewStatus,
  PerfRole,
  PerfSelfReviewStatus,
  PerfStageResultMode,
  PerfStageResultStatus,
} from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import { PrismaService } from '../shared/database/prisma.service';

type RequiredEvaluationDb = Pick<
  Prisma.TransactionClient,
  'perfEvaluationSubmission'
>;

export type RequiredEvaluationGate = {
  ready: boolean;
  self: 'EFFECTIVE' | 'MISSING';
  manager: 'EFFECTIVE' | 'MISSING';
  blockers: Array<{
    stage: 'SELF' | 'MANAGER';
    message: string;
    action: 'MARK_NO_RESULT_OR_REMIND' | 'REMIND_OR_TRANSFER_LEADER';
  }>;
};

/**
 * 必交评估门槛与“当前周期无绩效结果”终态。
 * 这里始终从统一 SUBMITTED 答卷派生完成度，更新草稿不会遮蔽上一份有效提交。
 */
@Injectable()
export class ParticipantNoResultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly rbacService: RbacService,
  ) {}

  async getRequiredEvaluationGate(
    participantId: number,
    db: RequiredEvaluationDb = this.prisma,
  ): Promise<RequiredEvaluationGate> {
    const gates = await this.getRequiredEvaluationGates([participantId], db);
    return gates.get(participantId)!;
  }

  /** 校准列表批量派生必交门槛，避免按参与者逐行查询。 */
  async getRequiredEvaluationGates(
    participantIds: number[],
    db: RequiredEvaluationDb = this.prisma,
  ): Promise<Map<number, RequiredEvaluationGate>> {
    const uniqueIds = [...new Set(participantIds)];
    if (uniqueIds.length === 0) return new Map();
    const submissions = await db.perfEvaluationSubmission.findMany({
      where: {
        participantId: { in: uniqueIds },
        stage: {
          in: [PerfEvaluationTaskType.SELF, PerfEvaluationTaskType.MANAGER],
        },
        status: PerfReviewStatus.SUBMITTED,
      },
      select: { participantId: true, stage: true },
    });
    const stagesByParticipant = new Map<number, Set<PerfEvaluationTaskType>>();
    for (const submission of submissions) {
      const stages = stagesByParticipant.get(submission.participantId);
      if (stages) stages.add(submission.stage);
      else {
        stagesByParticipant.set(
          submission.participantId,
          new Set([submission.stage]),
        );
      }
    }
    return new Map(
      uniqueIds.map((id) => [
        id,
        this.buildRequiredEvaluationGate(
          stagesByParticipant.get(id) ?? new Set(),
        ),
      ]),
    );
  }

  private buildRequiredEvaluationGate(
    effectiveStages: Set<PerfEvaluationTaskType>,
  ): RequiredEvaluationGate {
    const self = effectiveStages.has(PerfEvaluationTaskType.SELF)
      ? 'EFFECTIVE'
      : 'MISSING';
    const manager = effectiveStages.has(PerfEvaluationTaskType.MANAGER)
      ? 'EFFECTIVE'
      : 'MISSING';
    const blockers: RequiredEvaluationGate['blockers'] = [];
    if (self === 'MISSING') {
      blockers.push({
        stage: 'SELF',
        message: '员工自评尚未形成有效提交',
        action: 'MARK_NO_RESULT_OR_REMIND',
      });
    }
    if (manager === 'MISSING') {
      blockers.push({
        stage: 'MANAGER',
        message: '上级评估尚未形成有效提交，请催办或更换考核 Leader',
        action: 'REMIND_OR_TRANSFER_LEADER',
      });
    }
    return { ready: blockers.length === 0, self, manager, blockers };
  }

  async assertCalibrationReady(
    participantId: number,
    db: RequiredEvaluationDb = this.prisma,
  ) {
    const gate = await this.getRequiredEvaluationGate(participantId, db);
    if (!gate.ready) {
      throw new ConflictException({
        code: 'REQUIRED_EVALUATION_MISSING',
        message: '首次校准前必须完成员工自评和上级评估',
        blockers: gate.blockers,
      });
    }
    return gate;
  }

  async markNoResult(
    operatorOpenId: string,
    cycleId: number,
    participantId: number,
    reason: string,
  ) {
    const normalizedReason = this.requireReason(reason);
    const { updated, beforeStatus } = await this.prisma.$transaction(
      async (tx) => {
        await this.lockParticipantAggregate(tx, cycleId, participantId);
        const participant = await tx.perfParticipant.findUnique({
          where: { id: participantId },
          include: {
            cycle: { include: { currentConfigVersion: true } },
            // 旧写接口在完成收缩前仍公开，收口必须同时识别其有效提交。
            selfReview: { select: { status: true } },
          },
        });
        if (!participant || participant.cycle.deletedAt) {
          throw new NotFoundException('参与者不存在');
        }
        if (participant.cycleId !== cycleId) {
          throw new NotFoundException('参与者不存在');
        }
        await this.assertHrOrAdminScope(operatorOpenId, participant);
        if (participant.cycle.status !== PerfCycleStatus.ACTIVE) {
          throw new ConflictException(
            '只有进行中且未归档的周期可以设置无绩效结果',
          );
        }
        if (participant.status === PerfParticipantStatus.NO_RESULT) {
          throw new ConflictException('该参与者已是当前周期无绩效结果');
        }
        if (participant.status === PerfParticipantStatus.WITHDRAWN) {
          throw new ConflictException(
            '中途退出与无绩效结果是不同终态，不能相互改写',
          );
        }
        const config = participant.cycle.currentConfigVersion;
        if (!participant.cycle.currentConfigVersionId || !config) {
          throw new ConflictException('周期缺少当前配置快照，无法收口参与者');
        }

        const [submissions, resultCount, calibrationCount] = await Promise.all([
          tx.perfEvaluationSubmission.findMany({
            where: {
              participantId,
              stage: {
                in: [
                  PerfEvaluationTaskType.SELF,
                  PerfEvaluationTaskType.MANAGER,
                ],
              },
            },
            select: { id: true, stage: true, status: true },
          }),
          tx.perfResult.count({
            where: { participantId, invalidatedAt: null },
          }),
          tx.perfCalibration.count({
            where: { participantId, invalidatedAt: null },
          }),
        ]);
        const effectiveSelf =
          participant.selfReview?.status === PerfSelfReviewStatus.SUBMITTED ||
          submissions.some(
            (item) =>
              item.stage === PerfEvaluationTaskType.SELF &&
              item.status === PerfReviewStatus.SUBMITTED,
          );
        if (effectiveSelf) {
          throw new ConflictException(
            '员工已有有效自评，不能因上级评估缺失设置当前周期无绩效结果；请催办或更换考核 Leader',
          );
        }
        if (resultCount > 0 || calibrationCount > 0) {
          throw new ConflictException(
            '参与者已产生校准或绩效结果，不能设置当前周期无绩效结果',
          );
        }

        const draft = submissions.find(
          (item) =>
            item.stage === PerfEvaluationTaskType.SELF &&
            item.status !== PerfReviewStatus.SUBMITTED,
        );
        const now = new Date();
        await tx.perfStageResult.upsert({
          where: {
            participantId_stage_cycleConfigVersionId: {
              participantId,
              stage: PerfEvaluationTaskType.SELF,
              cycleConfigVersionId: participant.cycle.currentConfigVersionId,
            },
          },
          create: {
            cycleId: participant.cycleId,
            participantId,
            cycleConfigVersionId: participant.cycle.currentConfigVersionId,
            stage: PerfEvaluationTaskType.SELF,
            status: PerfStageResultStatus.NO_DATA,
            mode: PerfStageResultMode.DIRECT_RATING,
            reviewerCount: 0,
            compositeScore: null,
            initialLevel: null,
            stageLevel: null,
            constraintReasons: [],
            calculationDetail: {
              reason: 'SELF_NEVER_SUBMITTED',
              draftSubmissionId: draft?.id ?? null,
            },
            calculatedAt: now,
          },
          update: {
            status: PerfStageResultStatus.NO_DATA,
            mode: PerfStageResultMode.DIRECT_RATING,
            reviewerCount: 0,
            compositeScore: null,
            initialLevel: null,
            stageLevel: null,
            constraintReasons: [],
            calculationDetail: {
              reason: 'SELF_NEVER_SUBMITTED',
              draftSubmissionId: draft?.id ?? null,
            },
            calculatedAt: now,
          },
        });
        // 收口只关闭未完成任务，不删除任何草稿或当前有效答卷。
        await tx.perfEvaluationTask.updateMany({
          where: { participantId, completedAt: null },
          data: { completedAt: now },
        });
        const updated = await tx.perfParticipant.update({
          where: { id: participantId },
          data: { status: PerfParticipantStatus.NO_RESULT },
        });
        return { updated, beforeStatus: participant.status };
      },
    );

    await this.auditService.record({
      operatorOpenId,
      action: 'participant.no_result.mark',
      targetType: 'perf_participant',
      targetId: String(participantId),
      before: { status: beforeStatus },
      after: { status: PerfParticipantStatus.NO_RESULT },
      reason: normalizedReason,
    });
    return updated;
  }

  async revokeNoResult(
    operatorOpenId: string,
    cycleId: number,
    participantId: number,
    reason: string,
  ) {
    const normalizedReason = this.requireReason(reason);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockParticipantAggregate(tx, cycleId, participantId);
      const participant = await tx.perfParticipant.findUnique({
        where: { id: participantId },
        include: {
          cycle: { include: { currentConfigVersion: true } },
        },
      });
      if (!participant || participant.cycle.deletedAt) {
        throw new NotFoundException('参与者不存在');
      }
      if (participant.cycleId !== cycleId) {
        throw new NotFoundException('参与者不存在');
      }
      await this.assertHrOrAdminScope(operatorOpenId, participant);
      if (participant.cycle.status === PerfCycleStatus.ARCHIVED) {
        throw new ConflictException('周期已归档，当前周期无绩效结果不可撤销');
      }
      if (participant.status !== PerfParticipantStatus.NO_RESULT) {
        throw new ConflictException('该参与者当前不是无绩效结果状态');
      }
      if (!participant.cycle.currentConfigVersionId) {
        throw new ConflictException('周期缺少当前配置快照，无法恢复参评');
      }

      const [effective, pendingPeerAssignments] = await Promise.all([
        tx.perfEvaluationSubmission.findMany({
          where: { participantId, status: PerfReviewStatus.SUBMITTED },
          select: { stage: true },
        }),
        tx.perfReviewerAssignment.count({
          where: {
            participantId,
            status: PerfAssignmentStatus.PENDING,
          },
        }),
      ]);
      const effectiveStages = new Set(effective.map((item) => item.stage));
      const reopenTypes: PerfEvaluationTaskType[] = [];
      if (!effectiveStages.has(PerfEvaluationTaskType.SELF)) {
        reopenTypes.push(PerfEvaluationTaskType.SELF);
      }
      // PEER 任务由活跃指派的完成度派生，不能被某一份答卷代表。
      if (pendingPeerAssignments > 0) {
        reopenTypes.push(PerfEvaluationTaskType.PEER);
      }
      if (!effectiveStages.has(PerfEvaluationTaskType.MANAGER)) {
        reopenTypes.push(PerfEvaluationTaskType.MANAGER);
      }
      // AI 不属于人工答卷；撤销收口后交由异步任务按当前输入重新派生。
      reopenTypes.push(PerfEvaluationTaskType.AI);

      // NO_DATA 是本次收口的当前结果事实；撤销后删除它，草稿和有效提交均原样保留。
      await tx.perfStageResult.deleteMany({
        where: {
          participantId,
          cycleConfigVersionId: participant.cycle.currentConfigVersionId,
          stage: PerfEvaluationTaskType.SELF,
          status: PerfStageResultStatus.NO_DATA,
        },
      });
      await tx.perfEvaluationTask.updateMany({
        where: { participantId, type: { in: reopenTypes } },
        data: { completedAt: null },
      });
      return tx.perfParticipant.update({
        where: { id: participantId },
        data: { status: PerfParticipantStatus.PENDING_SELF_REVIEW },
      });
    });

    await this.auditService.record({
      operatorOpenId,
      action: 'participant.no_result.revoke',
      targetType: 'perf_participant',
      targetId: String(participantId),
      before: { status: PerfParticipantStatus.NO_RESULT },
      after: { status: PerfParticipantStatus.PENDING_SELF_REVIEW },
      reason: normalizedReason,
    });
    return result;
  }

  private requireReason(reason: string) {
    const normalized = reason?.trim();
    if (!normalized) throw new BadRequestException('操作原因不能为空');
    if (normalized.length > 500) {
      throw new BadRequestException('操作原因不能超过 500 个字符');
    }
    return normalized;
  }

  private async assertHrOrAdminScope(
    operatorOpenId: string,
    participant: { departmentIdSnapshot: string | null },
  ) {
    if (
      !(await this.rbacService.hasAnyRole(operatorOpenId, [
        PerfRole.HR,
        PerfRole.ADMIN,
      ]))
    ) {
      throw new ForbiddenException('只有 HR 或 Admin 可以处理无绩效结果');
    }
    const scope = await this.rbacService.getOrgScope(operatorOpenId);
    if (
      scope !== null &&
      (!participant.departmentIdSnapshot ||
        !scope.includes(participant.departmentIdSnapshot))
    ) {
      throw new ForbiddenException('该参与者不在你的 HR 授权组织范围内');
    }
  }

  private async lockParticipantAggregate(
    tx: Prisma.TransactionClient,
    cycleId: number,
    participantId: number,
  ) {
    const cycles = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT cycle."id"
      FROM "performance"."perf_cycles" AS cycle
      JOIN "performance"."perf_participants" AS participant
        ON participant."cycle_id" = cycle."id"
      WHERE cycle."id" = ${cycleId} AND participant."id" = ${participantId}
      FOR UPDATE OF cycle
    `;
    if (cycles.length !== 1) throw new NotFoundException('参与者不存在');
    const participants = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id"
      FROM "performance"."perf_participants"
      WHERE "id" = ${participantId} AND "cycle_id" = ${cycleId}
      FOR UPDATE
    `;
    if (participants.length !== 1) throw new NotFoundException('参与者不存在');
  }
}
