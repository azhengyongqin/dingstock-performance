import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import {
  PerfCalibrationDecision,
  PerfCycleStatus,
  PerfEvaluationTaskType,
  PerfParticipantStatus,
  PerfRatingSymbol,
  PerfRedLineAction,
  PerfRole,
} from '../generated/prisma/enums';
import { ParticipantNoResultService } from '../participant/participant-no-result.service';
import { RbacService } from '../rbac/rbac.service';
import { PrismaService } from '../shared/database/prisma.service';

export type CalibrationDecisionInput = {
  decision: PerfCalibrationDecision;
  afterLevel?: PerfRatingSymbol;
  reason?: string;
  expectedCalibrationRevision: number | null;
  expectedInputRevision: string;
};

/** Ticket 13 的逐员工决定聚合：权限、修订、显式决定与首次评估锁都在此收口。 */
@Injectable()
export class CalibrationDecisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly rbacService: RbacService,
    private readonly participantNoResultService: ParticipantNoResultService,
  ) {}

  async getContext(operatorOpenId: string, participantId: number) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockAggregate(tx, participantId);
      const state = await this.loadState(tx, participantId);
      await this.assertCanAccess(operatorOpenId, state.participant);
      return {
        participantId,
        preCalibrationLevel: state.preCalibrationLevel,
        currentLevel: state.currentLevel,
        calibrationRevision: state.calibrationRevision,
        inputRevision: state.inputRevision,
        evaluationLockedAt: state.participant.evaluationLockedAt,
        activeRedLineFindingIds: state.activeRedLines.map((item) => item.id),
        // 校准工作台是受对象权限保护的管理端边界，可直接展示红线完整事实。
        activeRedLineFindings: state.activeRedLines,
        // 同一授权边界内返回各人工阶段、AI 和等级差异，避免工作台再拼接身份受限接口。
        humanEvaluations: state.humanEvaluations,
        aiReport: state.participant.aiReport,
        levelComparison: this.buildLevelComparison(state),
      };
    });
  }

  async decide(
    operatorOpenId: string,
    participantId: number,
    input: CalibrationDecisionInput,
  ) {
    const reason = input.reason?.trim() || null;
    this.assertDecisionShape(input, reason);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockAggregate(tx, participantId);
      const state = await this.loadState(tx, participantId);
      await this.assertCanAccess(operatorOpenId, state.participant);
      this.assertCycleAllowsCalibration(state.participant);
      await this.participantNoResultService.assertCalibrationReady(
        participantId,
        tx,
      );
      if (input.expectedCalibrationRevision !== state.calibrationRevision) {
        throw new ConflictException({
          code: 'CALIBRATION_REVISION_STALE',
          message: '校准决定已被其他人更新，请刷新后重试',
        });
      }
      if (input.expectedInputRevision !== state.inputRevision) {
        throw new ConflictException({
          code: 'CALIBRATION_INPUT_STALE',
          message: '人工评估或红线输入已变化，请刷新后重试',
        });
      }

      const afterLevel = this.resolveAfterLevel(input, state);
      const decision = await tx.perfCalibration.create({
        data: {
          participantId,
          decision: input.decision,
          beforeLevel: state.currentLevel,
          afterLevel,
          reason,
          inputRevision: state.inputRevision,
          operatorOpenId,
        },
      });
      if (!state.participant.evaluationLockedAt) {
        await tx.perfParticipant.update({
          where: { id: participantId },
          data: {
            evaluationLockedAt: new Date(),
            status: PerfParticipantStatus.CALIBRATED,
          },
        });
      }
      return { decision, beforeLevel: state.currentLevel };
    });

    await this.auditService.record({
      operatorOpenId,
      action:
        input.decision === PerfCalibrationDecision.KEEP
          ? 'calibration.keep'
          : 'calibration.adjust',
      targetType: 'perf_participant',
      targetId: String(participantId),
      before: { level: result.beforeLevel },
      after: { level: result.decision.afterLevel },
      reason: reason ?? undefined,
    });
    return result.decision;
  }

  private assertDecisionShape(
    input: CalibrationDecisionInput,
    reason: string | null,
  ) {
    if (
      input.decision !== PerfCalibrationDecision.KEEP &&
      input.decision !== PerfCalibrationDecision.ADJUST
    ) {
      throw new BadRequestException('校准决定必须是 KEEP 或 ADJUST');
    }
    if (input.decision === PerfCalibrationDecision.ADJUST && !reason) {
      throw new BadRequestException('ADJUST 必须填写调整原因');
    }
  }

  private resolveAfterLevel(
    input: CalibrationDecisionInput,
    state: Awaited<ReturnType<CalibrationDecisionService['loadState']>>,
  ) {
    const requestedLevel = input.afterLevel;
    if (input.decision === PerfCalibrationDecision.KEEP) {
      if (requestedLevel && requestedLevel !== state.preCalibrationLevel) {
        throw new BadRequestException('KEEP 只能沿用 MANAGER 权威阶段等级');
      }
      return state.preCalibrationLevel;
    }
    if (!requestedLevel || !this.isRatingSymbol(requestedLevel)) {
      throw new BadRequestException('ADJUST 必须指定有效的 S/A/B/C 等级');
    }
    if (
      state.activeRedLines.length > 0 &&
      requestedLevel !== PerfRatingSymbol.C
    ) {
      throw new ConflictException({
        code: 'ACTIVE_RED_LINE_FORCES_C',
        message:
          '存在有效红线，不能调整为非 C；如需改判请先由 HR/Admin 撤销红线',
      });
    }
    if (requestedLevel === state.preCalibrationLevel) {
      throw new BadRequestException('调整后等级与校准前等级相同，请改用 KEEP');
    }
    return requestedLevel;
  }

  private async loadState(tx: Prisma.TransactionClient, participantId: number) {
    const participant = await tx.perfParticipant.findUnique({
      where: { id: participantId },
      include: {
        cycle: { include: { evaluationRule: true } },
        managerReview: { select: { initialLevel: true, status: true } },
        calibrations: { orderBy: { id: 'desc' }, take: 1 },
        result: { select: { archivedAt: true } },
        aiReport: {
          select: {
            status: true,
            referenceLevel: true,
            summary: true,
            highlights: true,
            improvements: true,
            promotionSummary: true,
            riskFlags: true,
            generatedAt: true,
          },
        },
      },
    });
    if (!participant || participant.cycle.deletedAt) {
      throw new NotFoundException('参与者不存在');
    }
    const [submissions, stageResults, redLineFindings] = await Promise.all([
      tx.perfEvaluationSubmission.findMany({
        where: {
          participantId,
          stage: {
            in: [
              PerfEvaluationTaskType.SELF,
              PerfEvaluationTaskType.PEER,
              PerfEvaluationTaskType.MANAGER,
            ],
          },
          status: 'SUBMITTED',
        },
        select: {
          id: true,
          stage: true,
          reviewerOpenId: true,
          reviewerAssignmentId: true,
          updatedAt: true,
          submittedAt: true,
          items: {
            select: {
              dimensionKey: true,
              itemKey: true,
              itemType: true,
              rawLevel: true,
              rawScore: true,
              calculationScore: true,
              value: true,
            },
            orderBy: { id: 'asc' },
          },
        },
        orderBy: { id: 'asc' },
      }),
      tx.perfStageResult.findMany({
        where: {
          participantId,
          cycleConfigVersionId:
            participant.cycle.currentConfigVersionId ?? undefined,
          stage: {
            in: [
              PerfEvaluationTaskType.SELF,
              PerfEvaluationTaskType.PEER,
              PerfEvaluationTaskType.MANAGER,
            ],
          },
        },
        select: {
          id: true,
          stage: true,
          status: true,
          mode: true,
          reviewerCount: true,
          compositeScore: true,
          initialLevel: true,
          stageLevel: true,
          constraintReasons: true,
          calculationDetail: true,
          calculatedAt: true,
          updatedAt: true,
          dimensions: {
            select: {
              dimensionKey: true,
              name: true,
              weight: true,
              isCore: true,
              score: true,
              level: true,
            },
            orderBy: { id: 'asc' },
          },
        },
        orderBy: { id: 'asc' },
      }),
      tx.perfRedLineFinding.findMany({
        where: { participantId },
        select: {
          id: true,
          action: true,
          revokeOfId: true,
          findingType: true,
          facts: true,
          evidence: true,
          reason: true,
          operatorOpenId: true,
          createdAt: true,
        },
        orderBy: { id: 'asc' },
      }),
    ]);
    const revokedIds = new Set(
      redLineFindings
        .filter((item) => item.action === PerfRedLineAction.REVOKE)
        .map((item) => item.revokeOfId)
        .filter((id): id is number => id !== null),
    );
    const activeRedLines = redLineFindings.filter(
      (item) =>
        item.action === PerfRedLineAction.CONFIRM && !revokedIds.has(item.id),
    );
    const managerLevel =
      stageResults.find((item) => item.stage === PerfEvaluationTaskType.MANAGER)
        ?.stageLevel ??
      participant.managerReview?.initialLevel ??
      null;
    if (!managerLevel || !this.isRatingSymbol(managerLevel)) {
      throw new ConflictException('上级评估尚未形成可校准的权威阶段等级');
    }
    const preCalibrationLevel =
      activeRedLines.length > 0 ? PerfRatingSymbol.C : managerLevel;
    const latestCalibration = participant.calibrations[0] ?? null;
    const humanEvaluations = [
      PerfEvaluationTaskType.SELF,
      PerfEvaluationTaskType.PEER,
      PerfEvaluationTaskType.MANAGER,
    ].map((stage) => ({
      stage,
      submissions: submissions.filter((item) => item.stage === stage),
      stageResult: stageResults.find((item) => item.stage === stage) ?? null,
    }));
    return {
      participant,
      preCalibrationLevel,
      // 红线是最终硬约束，不能让历史校准等级在工作台上看起来仍然有效。
      currentLevel:
        activeRedLines.length > 0
          ? PerfRatingSymbol.C
          : (latestCalibration?.afterLevel ?? preCalibrationLevel),
      calibrationRevision: latestCalibration?.id ?? null,
      inputRevision: createHash('sha256')
        .update(
          JSON.stringify({
            cycleConfigVersionId: participant.cycle.currentConfigVersionId,
            submissions,
            stageResults,
            redLineFindings,
          }),
        )
        .digest('hex'),
      activeRedLines,
      humanEvaluations,
    };
  }

  private buildLevelComparison(
    state: Awaited<ReturnType<CalibrationDecisionService['loadState']>>,
  ) {
    const stageLevels = Object.fromEntries(
      state.humanEvaluations.map((item) => [
        item.stage,
        item.stageResult?.stageLevel ?? null,
      ]),
    ) as Record<PerfEvaluationTaskType, PerfRatingSymbol | null>;
    const managerLevel = stageLevels[PerfEvaluationTaskType.MANAGER];
    const references = [
      {
        source: PerfEvaluationTaskType.SELF,
        level: stageLevels[PerfEvaluationTaskType.SELF],
      },
      {
        source: PerfEvaluationTaskType.PEER,
        level: stageLevels[PerfEvaluationTaskType.PEER],
      },
      {
        source: 'AI' as const,
        level: state.participant.aiReport?.referenceLevel ?? null,
      },
    ];
    return {
      managerLevel,
      references: references.map((reference) => ({
        ...reference,
        differsFromManager:
          reference.level !== null &&
          managerLevel !== null &&
          reference.level !== managerLevel,
      })),
      calibration: {
        beforeLevel: state.preCalibrationLevel,
        currentLevel: state.currentLevel,
        changed: state.preCalibrationLevel !== state.currentLevel,
      },
    };
  }

  private assertCycleAllowsCalibration(participant: {
    status: PerfParticipantStatus;
    cycle: { status: PerfCycleStatus };
    result: { archivedAt: Date | null } | null;
  }) {
    if (participant.cycle.status !== PerfCycleStatus.ACTIVE) {
      throw new ConflictException('只有进行中的周期可以校准');
    }
    if (participant.result?.archivedAt) {
      throw new ConflictException('结果已归档，不能继续校准');
    }
    if (participant.status === PerfParticipantStatus.NO_RESULT) {
      throw new ConflictException('当前周期无绩效结果的参与者不能校准');
    }
    const closedStatuses = new Set<PerfParticipantStatus>([
      PerfParticipantStatus.APPEALING,
      PerfParticipantStatus.RE_CONFIRMING,
      PerfParticipantStatus.ARCHIVED,
    ]);
    if (closedStatuses.has(participant.status)) {
      throw new ConflictException({
        code: 'CALIBRATION_STATE_CLOSED',
        message: '申诉、再次确认或归档阶段不能直接追加校准决定',
      });
    }
  }

  private async assertCanAccess(
    operatorOpenId: string,
    participant: {
      leaderOpenIdSnapshot: string | null;
      departmentIdSnapshot: string | null;
    },
  ) {
    if (participant.leaderOpenIdSnapshot === operatorOpenId) return;
    const allowed = await this.rbacService.hasAnyRole(operatorOpenId, [
      PerfRole.HR,
      PerfRole.ADMIN,
    ]);
    if (!allowed) throw new ForbiddenException('无权校准该员工');
    const scope = await this.rbacService.getOrgScope(operatorOpenId);
    if (
      scope !== null &&
      (!participant.departmentIdSnapshot ||
        !scope.includes(participant.departmentIdSnapshot))
    ) {
      throw new ForbiddenException('该参与者不在你的 HR 授权组织范围内');
    }
  }

  private async lockAggregate(
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
    await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id" FROM "performance"."perf_results"
      WHERE "participant_id" = ${participantId}
      FOR UPDATE
    `;
  }

  private isRatingSymbol(value: string): value is PerfRatingSymbol {
    return ['S', 'A', 'B', 'C'].includes(value);
  }
}
