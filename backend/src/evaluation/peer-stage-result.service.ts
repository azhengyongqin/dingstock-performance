import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PerfAssignmentStatus,
  PerfEvaluationTaskType,
  PerfReviewStatus,
  PerfRole,
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
import type {
  ConfigConstraintProfiles,
  ReviewerRelation,
} from '../config-template/config-template.contract';
import { REVIEWER_RELATIONS } from '../config-template/config-template.contract';
import { RbacService } from '../rbac/rbac.service';
import { PrismaService } from '../shared/database/prisma.service';
import type {
  FormSnapshotContent,
  FormSnapshotDimension,
} from './evaluation.service-types';

type PeerStageResultDb = Pick<
  Prisma.TransactionClient,
  'perfParticipant' | 'perfEvaluationSubmission' | 'perfStageResult'
>;

type RelationResultView = {
  relation: ReviewerRelation;
  baseWeight: string;
  adjustedWeight: string;
  reviewerCount: number;
  dimensionScores: Array<{ dimensionKey: string; score: string }>;
};

export type PeerStageResultView = {
  participantId: number;
  cycleConfigVersionId: number;
  status: 'READY' | 'NO_DATA';
  mode: StageResultMode;
  reviewerCount: number;
  compositeScore: string | null;
  initialLevel: PerformanceLevel | null;
  stageLevel: PerformanceLevel | null;
  constraintReasons: MatchedConstraint[];
  validRelations: RelationResultView[];
  dimensions: StageDimensionResult[];
  inputSummary: {
    assignedReviewerCount: number;
    submittedReviewerCount: number;
    draftReviewerCount: number;
    excludedPendingReviewerCount: number;
    effectiveSubmissions: Array<{
      submissionId: number;
      assignmentId: number;
      reviewerOpenId: string;
      relation: string;
    }>;
    excludedAssignments: Array<{
      assignmentId: number;
      reviewerOpenId: string;
      relation: string;
      status: string;
      hasDraft: boolean;
      reason: 'NO_EFFECTIVE_SUBMISSION';
    }>;
  };
};

/**
 * 360°阶段结果应用服务：把当前有效提交转换为计算引擎输入，持久化可解释结果，
 * 并提供 Leader / 授权 HR / Admin 的对象级查询边界。
 */
@Injectable()
export class PeerStageResultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbacService: RbacService,
  ) {}

  /** 基于当前有效答卷重算；可传事务 client，保证提交与阶段结果原子生效。 */
  async recalculate(
    participantId: number,
    db: PeerStageResultDb = this.prisma,
  ): Promise<PeerStageResultView> {
    const participant = await db.perfParticipant.findUnique({
      where: { id: participantId },
      include: {
        formSnapshot: { select: { content: true } },
        cycle: { include: { currentConfigVersion: true } },
        reviewerAssignments: {
          where: { status: { not: PerfAssignmentStatus.REPLACED } },
          select: {
            id: true,
            reviewerOpenId: true,
            relation: true,
            status: true,
          },
        },
      },
    });
    if (!participant || participant.cycle.deletedAt) {
      throw new NotFoundException('参与者不存在');
    }
    const config = participant.cycle.currentConfigVersion;
    if (!participant.cycle.currentConfigVersionId || !config) {
      throw new ConflictException(
        '周期缺少当前配置快照，无法计算 360°阶段结果',
      );
    }
    const mode = this.requirePeerMode(config.peerStageMode);
    const content = participant.formSnapshot?.content as
      FormSnapshotContent | undefined;
    if (!content) {
      throw new ConflictException('参与者缺少表单快照，无法计算 360°阶段结果');
    }

    // 同时读取 SUBMITTED 与 DRAFT：只有前者计分，后者只进入输入摘要用于解释排除原因。
    const submissions = await db.perfEvaluationSubmission.findMany({
      where: {
        participantId,
        stage: PerfEvaluationTaskType.PEER,
      },
      include: {
        reviewerAssignment: {
          select: { id: true, relation: true, status: true },
        },
        items: true,
      },
    });
    const validSubmissions = submissions.filter(
      (submission) =>
        submission.status === PerfReviewStatus.SUBMITTED &&
        submission.reviewerAssignment?.status ===
          PerfAssignmentStatus.SUBMITTED,
    );
    const draftReviewerOpenIds = new Set(
      submissions
        .filter((submission) => submission.status === PerfReviewStatus.DRAFT)
        .map((submission) => submission.reviewerOpenId),
    );
    const effectiveAssignmentIds = new Set(
      validSubmissions.flatMap((submission) =>
        submission.reviewerAssignmentId
          ? [submission.reviewerAssignmentId]
          : [],
      ),
    );
    const excludedAssignments = participant.reviewerAssignments
      .filter((assignment) => !effectiveAssignmentIds.has(assignment.id))
      .map((assignment) => ({
        assignmentId: assignment.id,
        reviewerOpenId: assignment.reviewerOpenId,
        relation: assignment.relation,
        status: assignment.status,
        hasDraft: draftReviewerOpenIds.has(assignment.reviewerOpenId),
        reason: 'NO_EFFECTIVE_SUBMISSION' as const,
      }));
    const inputSummary = {
      assignedReviewerCount: participant.reviewerAssignments.length,
      submittedReviewerCount: validSubmissions.length,
      draftReviewerCount: draftReviewerOpenIds.size,
      excludedPendingReviewerCount: excludedAssignments.length,
      effectiveSubmissions: validSubmissions.map((submission) => ({
        submissionId: submission.id,
        assignmentId: submission.reviewerAssignmentId!,
        reviewerOpenId: submission.reviewerOpenId,
        relation: submission.reviewerAssignment!.relation,
      })),
      excludedAssignments,
    };

    if (validSubmissions.length === 0) {
      const view: PeerStageResultView = {
        participantId,
        cycleConfigVersionId: config.id,
        status: 'NO_DATA',
        mode,
        reviewerCount: 0,
        compositeScore: null,
        initialLevel: null,
        stageLevel: null,
        constraintReasons: [],
        validRelations: [],
        dimensions: [],
        inputSummary,
      };
      await this.persist(db, participant.cycleId, view, null);
      return view;
    }

    const relationWeights = this.relationWeightsOf(config);
    const engineDimensions = this.buildDimensions(
      content,
      mode,
      validSubmissions,
      relationWeights,
    );
    const result = calculateStageResult({
      mode,
      ratings: this.ratingsOf(config.ratings),
      dimensions: engineDimensions,
      constraints: this.constraintsOf(config.constraintProfiles, mode),
      confirmedRedLine: null,
    });
    const validRelations = REVIEWER_RELATIONS.flatMap((relation) => {
      const first = result.dimensions[0]?.relations.find(
        (item) => item.type === relation,
      );
      if (!first) return [];
      return [
        {
          relation,
          baseWeight: first.baseWeight,
          adjustedWeight: first.effectiveWeight,
          reviewerCount: validSubmissions.filter(
            (submission) =>
              submission.reviewerAssignment?.relation === relation,
          ).length,
          dimensionScores: result.dimensions.map((dimension) => ({
            dimensionKey: dimension.id,
            score:
              dimension.relations.find((item) => item.type === relation)
                ?.score ?? '0',
          })),
        },
      ];
    });
    const view: PeerStageResultView = {
      participantId,
      cycleConfigVersionId: config.id,
      status: 'READY',
      mode,
      reviewerCount: validSubmissions.length,
      compositeScore: result.compositeScore,
      initialLevel: result.initialLevel,
      stageLevel: result.finalLevel,
      constraintReasons: result.matchedConstraints,
      validRelations,
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

  /** 管理视角读取时始终按当前有效输入重算，避免替换或未来配置变更留下陈旧结果。 */
  async getForManager(operatorOpenId: string, participantId: number) {
    const participant = await this.prisma.perfParticipant.findUnique({
      where: { id: participantId },
      include: { cycle: { select: { deletedAt: true } } },
    });
    if (!participant || participant.cycle.deletedAt) {
      throw new NotFoundException('参与者不存在');
    }
    await this.assertCanView(operatorOpenId, participant);
    return this.recalculate(participantId);
  }

  private buildDimensions(
    content: FormSnapshotContent,
    mode: StageResultMode,
    submissions: Array<{
      id: number;
      reviewerAssignment: { relation: unknown } | null;
      items: Array<{
        itemKey: string;
        dimensionKey: string;
        rawLevel: string | null;
        rawScore: { toString(): string } | number | string | null;
      }>;
    }>,
    relationWeights: Record<ReviewerRelation, string>,
  ): StageDimensionInput[] {
    const dimensions = content.subforms
      .filter((subform) => subform.type === 'PEER')
      .flatMap((subform) => subform.dimensions)
      .filter(
        (dimension) =>
          dimension.audience === 'REVIEWER' &&
          (!dimension.kind || dimension.kind === 'REGULAR'),
      );
    if (dimensions.length === 0) {
      throw new ConflictException('PEER 表单快照缺少可计算维度');
    }

    return dimensions.map((dimension) => {
      const scoringItem = this.scoringItemOf(dimension, mode);
      return {
        id: dimension.key,
        name: dimension.name ?? dimension.key,
        weight: dimension.weight ?? '0',
        isCore: Boolean(dimension.isCore),
        relations: REVIEWER_RELATIONS.flatMap((relation) => {
          const relationSubmissions = submissions.filter(
            (submission) =>
              submission.reviewerAssignment?.relation === relation,
          );
          if (relationSubmissions.length === 0) return [];
          return [
            {
              type: relation,
              weight: relationWeights[relation],
              items: relationSubmissions.map((submission) => {
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
                    `有效 360°提交缺少维度「${dimension.name ?? dimension.key}」的计分项`,
                  );
                }
                return {
                  itemId: scoringItem.key,
                  submissionId: String(submission.id),
                  rawValue,
                };
              }),
            },
          ];
        }),
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

  private relationWeightsOf(config: {
    orgOwnerWeight: { toString(): string } | string | number;
    projectOwnerWeight: { toString(): string } | string | number;
    peerWeight: { toString(): string } | string | number;
    crossDeptWeight: { toString(): string } | string | number;
  }): Record<ReviewerRelation, string> {
    return {
      ORG_OWNER: config.orgOwnerWeight.toString(),
      PROJECT_OWNER: config.projectOwnerWeight.toString(),
      PEER: config.peerWeight.toString(),
      CROSS_DEPT: config.crossDeptWeight.toString(),
    };
  }

  private requirePeerMode(mode: unknown): StageResultMode {
    if (mode !== 'WEIGHTED_RATING' && mode !== 'WEIGHTED_SCORE') {
      throw new ConflictException('360°阶段结果模式必须是加权评级或加权评分');
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
    db: PeerStageResultDb,
    cycleId: number,
    view: PeerStageResultView,
    unroundedCompositeScore: string | null,
  ) {
    const calculatedAt = new Date();
    const calculationDetail = {
      inputSummary: view.inputSummary,
      validRelations: view.validRelations,
      dimensions: view.dimensions,
      unroundedCompositeScore,
    } as unknown as Prisma.InputJsonValue;
    const data = {
      cycleId,
      participantId: view.participantId,
      cycleConfigVersionId: view.cycleConfigVersionId,
      stage: PerfEvaluationTaskType.PEER,
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
      calculationDetail,
      calculatedAt,
    };
    const dimensions = view.dimensions.map((dimension) => ({
      dimensionKey: dimension.id,
      name: dimension.name,
      weight: dimension.weight,
      isCore: dimension.isCore,
      score: dimension.score,
      level: dimension.level,
      relationAggregates: {
        create: dimension.relations.map((relation) => ({
          relation: relation.type as ReviewerRelation,
          baseWeight: relation.baseWeight,
          adjustedWeight: relation.effectiveWeight,
          reviewerCount: relation.items.length,
          score: relation.score,
        })),
      },
    }));
    await db.perfStageResult.upsert({
      where: {
        participantId_stage_cycleConfigVersionId: {
          participantId: view.participantId,
          stage: PerfEvaluationTaskType.PEER,
          cycleConfigVersionId: view.cycleConfigVersionId,
        },
      },
      create: {
        ...data,
        dimensions: { create: dimensions },
      },
      update: {
        ...data,
        // 子聚合不单独版本化；每次重算以当前有效输入原子替换完整集合。
        dimensions: {
          deleteMany: {},
          create: dimensions,
        },
      },
    });
  }

  private async assertCanView(
    operatorOpenId: string,
    participant: {
      leaderOpenIdSnapshot: string | null;
      departmentIdSnapshot: string | null;
    },
  ) {
    if (participant.leaderOpenIdSnapshot === operatorOpenId) return;
    const isHr = await this.rbacService.hasAnyRole(operatorOpenId, [
      PerfRole.HR,
      PerfRole.ADMIN,
    ]);
    if (!isHr)
      throw new ForbiddenException(
        '仅考核 Leader 或授权 HR 可查看 360°阶段结果',
      );
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
