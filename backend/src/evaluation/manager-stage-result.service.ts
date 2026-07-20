import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PerfEvaluationTaskType,
  PerfRedLineAction,
  PerfReviewStatus,
  PerfStageResultStatus,
} from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
import {
  type PerformanceLevel,
  type RatingScaleEntry,
} from '../calculation/stage-result-calculator';
import {
  calculateUnifiedStageResult,
  type UnifiedMatchedConstraint,
  type UnifiedStageDimensionInput,
  type UnifiedStageDimensionResult,
} from '../calculation/unified-stage-result-calculator';
import { PrismaService } from '../shared/database/prisma.service';
import type { FormSnapshotContent } from './evaluation.service-types';

type ManagerStageResultDb = Pick<
  Prisma.TransactionClient,
  | 'perfParticipant'
  | 'perfEvaluationSubmission'
  | 'perfStageResult'
  | 'perfRedLineFinding'
>;

export type ManagerStageResultView = {
  participantId: number;
  cycleConfigVersionId: number;
  status: 'READY' | 'NO_DATA';
  reviewerCount: number;
  compositeScore: string | null;
  initialLevel: PerformanceLevel | null;
  stageLevel: PerformanceLevel | null;
  constraintReasons: UnifiedMatchedConstraint[];
  dimensions: UnifiedStageDimensionResult[];
  inputSummary: {
    effectiveSubmissionId: number | null;
    reviewerOpenId: string | null;
  };
};

/**
 * MANAGER 阶段结果服务：只消费当前生效的上级评估答卷，按配置计算
 * 校准前权威等级。SELF、PEER、AI 只作为填写参考，不进入本阶段二次加权。
 */
@Injectable()
export class ManagerStageResultService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 读取当前配置版本已持久化的权威结果。查询不触发重算，
   * 因此归档周期可以继续查看历史，也不会突破永久写冻结。
   */
  async getCurrent(
    participantId: number,
  ): Promise<ManagerStageResultView | null> {
    const participant = await this.prisma.perfParticipant.findUnique({
      where: { id: participantId },
      select: {
        cycle: { select: { deletedAt: true, currentConfigVersionId: true } },
      },
    });
    if (!participant || participant.cycle.deletedAt) {
      throw new NotFoundException('参与者不存在');
    }
    const cycleConfigVersionId = participant.cycle.currentConfigVersionId;
    if (!cycleConfigVersionId) return null;
    const result = await this.prisma.perfStageResult.findUnique({
      where: {
        participantId_stage_cycleConfigVersionId: {
          participantId,
          stage: PerfEvaluationTaskType.MANAGER,
          cycleConfigVersionId,
        },
      },
    });
    if (!result) return null;
    const detail = result.calculationDetail as unknown as {
      inputSummary?: ManagerStageResultView['inputSummary'];
      dimensions?: UnifiedStageDimensionResult[];
    };
    return {
      participantId,
      cycleConfigVersionId,
      status: result.status,
      reviewerCount: result.reviewerCount,
      compositeScore: result.compositeScore?.toFixed(2) ?? null,
      initialLevel: result.initialLevel,
      stageLevel: result.stageLevel,
      constraintReasons:
        result.constraintReasons as unknown as UnifiedMatchedConstraint[],
      dimensions: detail.dimensions ?? [],
      inputSummary: detail.inputSummary ?? {
        effectiveSubmissionId: null,
        reviewerOpenId: null,
      },
    };
  }

  /** 可传事务 client，使正式提交、任务完成与权威阶段结果原子生效。 */
  async recalculate(
    participantId: number,
    db: ManagerStageResultDb = this.prisma,
  ): Promise<ManagerStageResultView> {
    const participant = await db.perfParticipant.findUnique({
      where: { id: participantId },
      include: {
        formSnapshot: { select: { content: true } },
        cycle: { include: { currentConfigVersion: true } },
      },
    });
    if (!participant || participant.cycle.deletedAt) {
      throw new NotFoundException('参与者不存在');
    }
    const config = participant.cycle.currentConfigVersion;
    if (!participant.cycle.currentConfigVersionId || !config) {
      throw new ConflictException('周期缺少当前配置快照，无法计算上级评估结果');
    }
    const content = participant.formSnapshot?.content as
      FormSnapshotContent | undefined;
    if (!content) {
      throw new ConflictException('参与者缺少表单快照，无法计算上级评估结果');
    }

    // 更新草稿不进入计算；当前 SUBMITTED 在重新提交成功前持续保持权威。
    const submission = await db.perfEvaluationSubmission.findFirst({
      where: {
        participantId,
        stage: PerfEvaluationTaskType.MANAGER,
        status: PerfReviewStatus.SUBMITTED,
      },
      include: {
        dimensionAnswers: {
          include: { fields: true },
          orderBy: { id: 'asc' },
        },
      },
    });
    const inputSummary = {
      effectiveSubmissionId: submission?.id ?? null,
      reviewerOpenId: submission?.reviewerOpenId ?? null,
    };

    if (!submission) {
      const view: ManagerStageResultView = {
        participantId,
        cycleConfigVersionId: config.id,
        status: 'NO_DATA',
        reviewerCount: 0,
        compositeScore: null,
        initialLevel: null,
        stageLevel: null,
        constraintReasons: [],
        dimensions: [],
        inputSummary,
      };
      await this.persist(db, participant.cycleId, view, null);
      return view;
    }

    const confirmedRedLine = await db.perfRedLineFinding.findFirst({
      where: {
        participantId,
        action: PerfRedLineAction.CONFIRM,
        revokedBy: { none: {} },
      },
      select: { id: true, findingType: true, reason: true },
      orderBy: { id: 'desc' },
    });
    const result = calculateUnifiedStageResult({
      ratings: this.ratingsOf(config.ratings),
      dimensions: this.buildDimensions(content, submission),
      confirmedRedLine: confirmedRedLine
        ? {
            findingId: `red-line:${confirmedRedLine.id}`,
            category: confirmedRedLine.findingType,
            reason: confirmedRedLine.reason,
          }
        : null,
    });
    const view: ManagerStageResultView = {
      participantId,
      cycleConfigVersionId: config.id,
      status: 'READY',
      reviewerCount: 1,
      compositeScore: result.compositeScore,
      initialLevel: result.initialLevel,
      stageLevel: result.finalLevel,
      constraintReasons: result.matchedConstraints,
      dimensions: result.dimensions,
      inputSummary,
    };
    await this.persist(
      db,
      participant.cycleId,
      view,
      result.unroundedCompositeScore,
    );
    return view;
  }

  private buildDimensions(
    content: FormSnapshotContent,
    submission: {
      id: number;
      dimensionAnswers: Array<{
        dimensionKey: string;
        rawLevel: PerformanceLevel | null;
        rawScore: { toString(): string } | number | string | null;
      }>;
    },
  ): UnifiedStageDimensionInput[] {
    const dimensions = content.subforms
      .filter((subform) => subform.type === 'MANAGER')
      .flatMap((subform) => subform.dimensions)
      .filter(
        (dimension) =>
          dimension.audience === 'LEADER' && dimension.type === 'SCORING',
      );
    if (dimensions.length === 0) {
      throw new ConflictException('MANAGER 表单快照缺少计分维度');
    }

    return dimensions.map((dimension) => {
      const answer = submission.dimensionAnswers.find(
        (candidate) => candidate.dimensionKey === dimension.key,
      );
      if (!answer) {
        throw new ConflictException(
          `有效上级评估缺少维度「${dimension.name ?? dimension.key}」的维度作答`,
        );
      }
      return {
        id: dimension.key,
        name: dimension.name ?? dimension.key,
        scoringMethod: dimension.scoringMethod!,
        weight: dimension.weight ?? '0',
        isCore: Boolean(dimension.isCore),
        relations: [
          {
            type: 'LEADER' as const,
            weight: '100',
            items: [
              {
                submissionId: String(submission.id),
                ...(dimension.scoringMethod === 'RATING'
                  ? { rawLevel: this.requirePerformanceLevel(answer.rawLevel) }
                  : { rawScore: this.requireRawScore(answer.rawScore) }),
              },
            ],
          },
        ],
      };
    });
  }

  private requirePerformanceLevel(value: unknown): PerformanceLevel {
    if (value === 'S' || value === 'A' || value === 'B' || value === 'C') {
      return value;
    }
    throw new ConflictException('有效上级评估缺少原始评级');
  }

  private requireRawScore(
    value: { toString(): string } | number | string | null,
  ) {
    if (value === null) {
      throw new ConflictException('有效上级评估缺少原始分数');
    }
    return value.toString();
  }

  private ratingsOf(value: unknown): RatingScaleEntry[] {
    if (!Array.isArray(value)) {
      throw new ConflictException('周期配置快照缺少评级定义');
    }
    return value as RatingScaleEntry[];
  }

  private async persist(
    db: ManagerStageResultDb,
    cycleId: number,
    view: ManagerStageResultView,
    unroundedCompositeScore: string | null,
  ) {
    const calculatedAt = new Date();
    const data = {
      cycleId,
      participantId: view.participantId,
      cycleConfigVersionId: view.cycleConfigVersionId,
      stage: PerfEvaluationTaskType.MANAGER,
      status:
        view.status === 'READY'
          ? PerfStageResultStatus.READY
          : PerfStageResultStatus.NO_DATA,
      reviewerCount: view.reviewerCount,
      compositeScore: view.compositeScore,
      initialLevel: view.initialLevel,
      stageLevel: view.stageLevel,
      constraintReasons:
        view.constraintReasons as unknown as Prisma.InputJsonValue,
      calculationDetail: {
        inputSummary: view.inputSummary,
        dimensions: view.dimensions,
        unroundedCompositeScore,
      } as unknown as Prisma.InputJsonValue,
      calculatedAt,
    };
    const dimensions = view.dimensions.map((dimension) => ({
      dimensionKey: dimension.id,
      name: dimension.name,
      weight: dimension.weight,
      isCore: dimension.isCore,
      score: dimension.score,
      level: dimension.level,
    }));
    await db.perfStageResult.upsert({
      where: {
        participantId_stage_cycleConfigVersionId: {
          participantId: view.participantId,
          stage: PerfEvaluationTaskType.MANAGER,
          cycleConfigVersionId: view.cycleConfigVersionId,
        },
      },
      create: { ...data, dimensions: { create: dimensions } },
      update: {
        ...data,
        dimensions: { deleteMany: {}, create: dimensions },
      },
    });
  }
}
