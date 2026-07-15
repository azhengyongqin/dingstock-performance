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
  calculateStageResult,
  type MatchedConstraint,
  type PerformanceLevel,
  type RatingScaleEntry,
  type StageConstraintRule,
  type StageDimensionInput,
  type StageDimensionResult,
  type StageResultMode,
} from '../calculation/stage-result-calculator';
import type { ConfigConstraintProfiles } from '../config-template/config-template.contract';
import { PrismaService } from '../shared/database/prisma.service';
import type {
  FormSnapshotContent,
  FormSnapshotDimension,
} from './evaluation.service-types';

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
  mode: StageResultMode;
  reviewerCount: number;
  compositeScore: string | null;
  initialLevel: PerformanceLevel | null;
  stageLevel: PerformanceLevel | null;
  constraintReasons: MatchedConstraint[];
  dimensions: StageDimensionResult[];
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
    const mode = this.requireManagerMode(config.managerStageMode);
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
      include: { items: true },
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
        mode,
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
    const result = calculateStageResult({
      mode,
      ratings: this.ratingsOf(config.ratings),
      dimensions: this.buildDimensions(content, mode, submission),
      constraints: this.constraintsOf(config.constraintProfiles, mode),
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
      mode,
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
    mode: StageResultMode,
    submission: {
      id: number;
      items: Array<{
        itemKey: string;
        dimensionKey: string;
        rawLevel: string | null;
        rawScore: { toString(): string } | number | string | null;
      }>;
    },
  ): StageDimensionInput[] {
    const dimensions = content.subforms
      .filter((subform) => subform.type === 'MANAGER')
      .flatMap((subform) => subform.dimensions)
      .filter(
        (dimension) =>
          dimension.audience === 'LEADER' &&
          (!dimension.kind || dimension.kind === 'REGULAR'),
      );
    if (dimensions.length === 0) {
      throw new ConflictException('MANAGER 表单快照缺少可计算维度');
    }

    return dimensions.map((dimension) => {
      const scoringItem = this.scoringItemOf(dimension, mode);
      const item = submission.items.find(
        (candidate) =>
          candidate.dimensionKey === dimension.key &&
          candidate.itemKey === scoringItem.key,
      );
      const rawValue =
        mode === 'WEIGHTED_RATING'
          ? item?.rawLevel
          : item?.rawScore?.toString();
      if (rawValue === null || rawValue === undefined) {
        throw new ConflictException(
          `有效上级评估缺少维度「${dimension.name ?? dimension.key}」的计分项`,
        );
      }
      return {
        id: dimension.key,
        name: dimension.name ?? dimension.key,
        weight: dimension.weight ?? '0',
        isCore: Boolean(dimension.isCore),
        relations: [
          {
            type: 'LEADER',
            weight: '100',
            items: [
              {
                itemId: scoringItem.key,
                submissionId: String(submission.id),
                rawValue,
              },
            ],
          },
        ],
      };
    });
  }

  private scoringItemOf(
    dimension: FormSnapshotDimension,
    mode: StageResultMode,
  ) {
    const expectedType = mode === 'WEIGHTED_RATING' ? 'RATING' : 'SCORE';
    const items = dimension.items.filter((item) => item.type === expectedType);
    if (items.length !== 1) {
      throw new ConflictException(
        `维度「${dimension.name ?? dimension.key}」必须且只能包含一个 ${expectedType} 计分项`,
      );
    }
    return items[0];
  }

  private requireManagerMode(mode: unknown): StageResultMode {
    if (mode !== 'WEIGHTED_RATING' && mode !== 'WEIGHTED_SCORE') {
      throw new ConflictException(
        '上级评估阶段结果模式必须是加权评级或加权评分',
      );
    }
    return mode;
  }

  private ratingsOf(value: unknown): RatingScaleEntry[] {
    if (!Array.isArray(value)) {
      throw new ConflictException('周期配置快照缺少评级定义');
    }
    return value as RatingScaleEntry[];
  }

  private constraintsOf(
    value: unknown,
    mode: StageResultMode,
  ): StageConstraintRule[] {
    const profiles = value as ConfigConstraintProfiles | null;
    if (!profiles) {
      throw new ConflictException('周期配置快照缺少阶段约束配置');
    }
    if (mode === 'WEIGHTED_RATING') {
      if (!Array.isArray(profiles.WEIGHTED_RATING)) {
        throw new ConflictException('周期配置快照缺少阶段约束配置');
      }
      return profiles.WEIGHTED_RATING.filter((rule) => rule.enabled).map(
        (rule) => ({
          id: rule.id,
          type: rule.type,
          triggerRating: rule.triggerRating,
          targetLevel: rule.targetLevel,
        }),
      );
    }
    if (!Array.isArray(profiles.WEIGHTED_SCORE)) {
      throw new ConflictException('周期配置快照缺少阶段约束配置');
    }
    return profiles.WEIGHTED_SCORE.filter((rule) => rule.enabled).map(
      (rule) => ({
        id: rule.id,
        type: rule.type,
        threshold: rule.threshold,
        targetLevel: rule.targetLevel,
      }),
    );
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
      mode: view.mode,
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
