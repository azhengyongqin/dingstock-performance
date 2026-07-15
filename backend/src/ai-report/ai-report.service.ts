import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import {
  PerfAiReportStatus,
  PerfEvaluationTaskType,
  PerfReviewStatus,
  PerfRole,
} from '../generated/prisma/enums';
import { RbacService } from '../rbac/rbac.service';
import { PrismaService } from '../shared/database/prisma.service';

const HUMAN_STAGES = [
  PerfEvaluationTaskType.SELF,
  PerfEvaluationTaskType.PEER,
  PerfEvaluationTaskType.MANAGER,
] as const;
const REFERENCE_LEVELS = new Set(['S', 'A', 'B', 'C']);
const MAX_AUTOMATIC_ATTEMPTS = 3;

type AiReportDb = Pick<
  Prisma.TransactionClient,
  | 'perfParticipant'
  | 'perfEvaluationSubmission'
  | 'perfStageResult'
  | 'perfAiReport'
  | 'perfEvaluationTask'
>;

export type AiReportOutput = {
  referenceLevel: 'S' | 'A' | 'B' | 'C';
  summary: string;
  highlights?: Prisma.InputJsonValue | null;
  improvements?: Prisma.InputJsonValue | null;
  promotionSummary?: string | null;
  riskFlags?: Prisma.InputJsonValue | null;
};

/**
 * AI 报告任务边界：保存稳定输入快照和修订，worker 只按修订领取/回写。
 * 该服务不修改参与者状态、不生成 AI 阶段加权结果，失败也不影响人工主链。
 */
@Injectable()
export class AiReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbacService: RbacService,
  ) {}

  /**
   * 人工正式提交事务内调用。只有已有有效 MANAGER 提交才创建任务；
   * 草稿不在查询范围，相同输入修订保持现有 SUCCESS/FAILED 状态不变。
   */
  async refreshForParticipant(
    participantId: number,
    db: AiReportDb = this.prisma,
  ) {
    const input = await this.buildEffectiveInput(participantId, db);
    const existing = await db.perfAiReport.findUnique({
      where: { participantId },
    });
    if (!input) return null;
    if (existing?.inputRevision === input.revision) return existing;

    const now = new Date();
    const data = {
      status: PerfAiReportStatus.PENDING,
      inputRevision: input.revision,
      processingRevision: null,
      inputSnapshot: input.snapshot,
      inputsDigest: input.digest,
      attemptCount: 0,
      availableAt: now,
      startedAt: null,
      referenceLevel: null,
      summary: null,
      highlights: Prisma.DbNull,
      improvements: Prisma.DbNull,
      promotionSummary: null,
      riskFlags: Prisma.DbNull,
      errorMessage: null,
      generatedAt: null,
      reviewedByOpenId: null,
      reviewedAction: null,
    } as const;
    if (existing) {
      return db.perfAiReport.update({ where: { id: existing.id }, data });
    }
    return db.perfAiReport.create({
      data: { participantId, ...data },
    });
  }

  /** worker 并发领取一个可用任务；条件更新失败表示已被其他 worker 领取。 */
  async claimNext(now = new Date()) {
    const report = await this.prisma.perfAiReport.findFirst({
      where: {
        status: { in: [PerfAiReportStatus.PENDING, PerfAiReportStatus.FAILED] },
        availableAt: { lte: now },
        attemptCount: { lt: MAX_AUTOMATIC_ATTEMPTS },
        inputRevision: { not: null },
        inputSnapshot: { not: Prisma.DbNull },
      },
      orderBy: [{ availableAt: 'asc' }, { id: 'asc' }],
    });
    if (!report?.inputRevision || report.inputSnapshot === null) return null;

    const claimed = await this.prisma.perfAiReport.updateMany({
      where: {
        id: report.id,
        status: report.status,
        inputRevision: report.inputRevision,
      },
      data: {
        status: PerfAiReportStatus.GENERATING,
        processingRevision: report.inputRevision,
        startedAt: now,
        attemptCount: { increment: 1 },
        errorMessage: null,
      },
    });
    if (claimed.count !== 1) return null;
    return {
      id: report.id,
      participantId: report.participantId,
      revision: report.inputRevision,
      input: report.inputSnapshot,
    };
  }

  /** 只有运行修订仍是当前输入修订时才允许成功，防止旧模型响应覆盖新输入。 */
  async complete(reportId: number, revision: string, output: AiReportOutput) {
    if (!REFERENCE_LEVELS.has(output.referenceLevel)) {
      throw new BadRequestException('AI 参考等级必须是 S/A/B/C');
    }
    const generatedAt = new Date();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.perfAiReport.updateMany({
        where: {
          id: reportId,
          status: PerfAiReportStatus.GENERATING,
          inputRevision: revision,
          processingRevision: revision,
        },
        data: {
          status: PerfAiReportStatus.SUCCESS,
          referenceLevel: output.referenceLevel,
          summary: output.summary,
          highlights: output.highlights ?? Prisma.DbNull,
          improvements: output.improvements ?? Prisma.DbNull,
          promotionSummary: output.promotionSummary ?? null,
          riskFlags: output.riskFlags ?? Prisma.DbNull,
          errorMessage: null,
          generatedAt,
          processingRevision: null,
          startedAt: null,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'AI 输入已更新或任务已被处理，本次结果已丢弃',
        );
      }
      const report = await tx.perfAiReport.findUnique({
        where: { id: reportId },
        select: { participantId: true },
      });
      if (report) {
        await tx.perfEvaluationTask.updateMany({
          where: {
            participantId: report.participantId,
            type: PerfEvaluationTaskType.AI,
          },
          data: { completedAt: generatedAt },
        });
      }
      return { ok: true };
    });
  }

  /** 失败保持 FAILED，availableAt 采用指数退避；主流程不会读取该状态作为阻塞条件。 */
  async fail(reportId: number, revision: string, error: unknown) {
    const report = await this.prisma.perfAiReport.findUnique({
      where: { id: reportId },
      select: {
        status: true,
        inputRevision: true,
        processingRevision: true,
        attemptCount: true,
      },
    });
    if (
      !report ||
      report.status !== PerfAiReportStatus.GENERATING ||
      report.inputRevision !== revision ||
      report.processingRevision !== revision
    ) {
      throw new ConflictException(
        'AI 输入已更新或任务已结束，本次失败结果已丢弃',
      );
    }
    const delayMs = Math.min(
      60_000 * 2 ** Math.max(report.attemptCount - 1, 0),
      3_600_000,
    );
    const message = error instanceof Error ? error.message : String(error);
    const updated = await this.prisma.perfAiReport.updateMany({
      where: {
        id: reportId,
        status: PerfAiReportStatus.GENERATING,
        inputRevision: revision,
        processingRevision: revision,
      },
      data: {
        status: PerfAiReportStatus.FAILED,
        errorMessage: message.slice(0, 2000),
        availableAt: new Date(Date.now() + delayMs),
        processingRevision: null,
        startedAt: null,
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException('AI 输入已更新，本次失败结果已丢弃');
    }
    return { ok: true };
  }

  /** 调度器定期把长时间未回写的运行任务转为 FAILED，随后走相同重试规则。 */
  async recoverTimedOut(timeoutMs: number, now = new Date()) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new BadRequestException('超时时间必须为正数');
    }
    return this.prisma.perfAiReport.updateMany({
      where: {
        status: PerfAiReportStatus.GENERATING,
        startedAt: { lt: new Date(now.getTime() - timeoutMs) },
      },
      data: {
        status: PerfAiReportStatus.FAILED,
        errorMessage: 'AI 报告生成超时',
        availableAt: now,
        processingRevision: null,
        startedAt: null,
      },
    });
  }

  async requestGeneration(operatorOpenId: string, participantId: number) {
    await this.assertCanView(operatorOpenId, participantId);
    const report = await this.refreshForParticipant(participantId);
    if (!report) {
      throw new ConflictException('上级评估尚未生效，暂不能生成 AI 参考');
    }
    return this.toManagementView(report);
  }

  async retry(operatorOpenId: string, participantId: number) {
    await this.assertCanView(operatorOpenId, participantId);
    const report = await this.prisma.perfAiReport.findUnique({
      where: { participantId },
    });
    if (!report) throw new NotFoundException('AI 报告任务不存在');
    if (!report.inputRevision || report.inputSnapshot === null) {
      throw new ConflictException(
        'AI 报告缺少有效输入，请先按当前人工评估重新生成',
      );
    }
    if (report.status === PerfAiReportStatus.GENERATING) {
      throw new ConflictException('AI 报告正在生成，请勿重复提交');
    }
    const updated = await this.prisma.perfAiReport.update({
      where: { id: report.id },
      data: {
        status: PerfAiReportStatus.PENDING,
        attemptCount: 0,
        availableAt: new Date(),
        processingRevision: null,
        startedAt: null,
        errorMessage: null,
        referenceLevel: null,
        summary: null,
        highlights: Prisma.DbNull,
        improvements: Prisma.DbNull,
        promotionSummary: null,
        riskFlags: Prisma.DbNull,
        generatedAt: null,
      },
    });
    return this.toManagementView(updated);
  }

  async getForManager(operatorOpenId: string, participantId: number) {
    await this.assertCanView(operatorOpenId, participantId);
    const report = await this.prisma.perfAiReport.findUnique({
      where: { participantId },
    });
    return report ? this.toManagementView(report) : null;
  }

  private async buildEffectiveInput(participantId: number, db: AiReportDb) {
    const participant = await db.perfParticipant.findUnique({
      where: { id: participantId },
      select: {
        id: true,
        cycleId: true,
        employeeOpenId: true,
        isPromotionEnabled: true,
        cycle: {
          select: { deletedAt: true, currentConfigVersionId: true },
        },
      },
    });
    if (!participant || participant.cycle.deletedAt) {
      throw new NotFoundException('参与者不存在');
    }
    const submissions = await db.perfEvaluationSubmission.findMany({
      where: {
        participantId,
        stage: { in: [...HUMAN_STAGES] },
        status: PerfReviewStatus.SUBMITTED,
      },
      include: { items: { orderBy: { id: 'asc' } } },
      orderBy: [{ stage: 'asc' }, { id: 'asc' }],
    });
    if (
      !submissions.some(
        (submission) => submission.stage === PerfEvaluationTaskType.MANAGER,
      )
    ) {
      return null;
    }
    const stageResults = participant.cycle.currentConfigVersionId
      ? await db.perfStageResult.findMany({
          where: {
            participantId,
            cycleConfigVersionId: participant.cycle.currentConfigVersionId,
            stage: { in: [...HUMAN_STAGES] },
          },
          include: { dimensions: { orderBy: { id: 'asc' } } },
          orderBy: [{ stage: 'asc' }, { id: 'asc' }],
        })
      : [];
    const snapshot = {
      participant: {
        id: participant.id,
        cycleId: participant.cycleId,
        employeeOpenId: participant.employeeOpenId,
        isPromotionEnabled: participant.isPromotionEnabled,
      },
      submissions: submissions.map((submission) => ({
        id: submission.id,
        stage: submission.stage,
        reviewerOpenId: submission.reviewerOpenId,
        formSnapshotId: submission.formSnapshotId,
        submittedAt: submission.submittedAt?.toISOString() ?? null,
        updatedAt: submission.updatedAt.toISOString(),
        items: submission.items.map((item) => ({
          id: item.id,
          itemKey: item.itemKey,
          itemType: item.itemType,
          rawLevel: item.rawLevel,
          rawScore: item.rawScore?.toString() ?? null,
          calculationScore: item.calculationScore?.toString() ?? null,
          value: item.value,
        })),
      })),
      stageResults: stageResults.map((result) => ({
        id: result.id,
        stage: result.stage,
        status: result.status,
        compositeScore: result.compositeScore?.toString() ?? null,
        initialLevel: result.initialLevel,
        stageLevel: result.stageLevel,
        updatedAt: result.updatedAt.toISOString(),
        dimensions: result.dimensions.map((dimension) => ({
          dimensionKey: dimension.dimensionKey,
          name: dimension.name,
          score: dimension.score.toString(),
          level: dimension.level,
        })),
      })),
    };
    const revision = createHash('sha256')
      .update(JSON.stringify(snapshot))
      .digest('hex');
    const digest = {
      revision,
      submissions: snapshot.submissions.map(
        ({ id, stage, submittedAt, updatedAt }) => ({
          id,
          stage,
          submittedAt,
          updatedAt,
        }),
      ),
      stageResults: snapshot.stageResults.map(({ id, stage, updatedAt }) => ({
        id,
        stage,
        updatedAt,
      })),
    };
    return {
      revision,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      digest: digest as unknown as Prisma.InputJsonValue,
    };
  }

  private async assertCanView(operatorOpenId: string, participantId: number) {
    const participant = await this.prisma.perfParticipant.findUnique({
      where: { id: participantId },
      select: {
        leaderOpenIdSnapshot: true,
        departmentIdSnapshot: true,
        cycle: { select: { deletedAt: true } },
      },
    });
    if (!participant || participant.cycle.deletedAt) {
      throw new NotFoundException('参与者不存在');
    }
    if (participant.leaderOpenIdSnapshot === operatorOpenId) return;
    const isManager = await this.rbacService.hasAnyRole(operatorOpenId, [
      PerfRole.HR,
      PerfRole.ADMIN,
    ]);
    if (!isManager) {
      throw new ForbiddenException(
        '仅当前 Leader 或授权 HR/Admin 可查看 AI 参考',
      );
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

  /** API 不返回原始输入快照，减少敏感人工答卷的额外暴露面。 */
  private toManagementView(report: {
    id: number;
    participantId: number;
    status: unknown;
    referenceLevel?: unknown;
    summary?: unknown;
    highlights?: unknown;
    improvements?: unknown;
    promotionSummary?: unknown;
    riskFlags?: unknown;
    inputRevision?: unknown;
    errorMessage?: unknown;
    generatedAt?: unknown;
    attemptCount?: unknown;
    updatedAt?: unknown;
  }) {
    return {
      id: report.id,
      participantId: report.participantId,
      status: report.status,
      referenceLevel: report.referenceLevel ?? null,
      summary: report.summary ?? null,
      highlights: report.highlights ?? null,
      improvements: report.improvements ?? null,
      promotionSummary: report.promotionSummary ?? null,
      riskFlags: report.riskFlags ?? null,
      inputRevision: report.inputRevision ?? null,
      errorMessage: report.errorMessage ?? null,
      generatedAt: report.generatedAt ?? null,
      attemptCount: report.attemptCount ?? 0,
      updatedAt: report.updatedAt ?? null,
    };
  }
}
