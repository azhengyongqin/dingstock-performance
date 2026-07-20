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
  calculateUnifiedStageResult,
  type UnifiedMatchedConstraint,
  type UnifiedStageDimensionResult,
} from '../calculation/unified-stage-result-calculator';
import type {
  PerformanceLevel,
  RatingScaleEntry,
} from '../calculation/stage-result-calculator';
import type { ReviewerRelation } from '../config-template/config-template.contract';
import { REVIEWER_RELATIONS } from '../config-template/config-template.contract';
import { RbacService } from '../rbac/rbac.service';
import { PrismaService } from '../shared/database/prisma.service';
import type {
  FormSnapshotContent,
  FormSnapshotDimension,
} from './evaluation.service-types';
import { omitStageResultMode } from './stage-result.public';

type PeerStageResultDb = Pick<
  Prisma.TransactionClient,
  'perfParticipant' | 'perfEvaluationSubmission' | 'perfStageResult'
>;

type StoredDimensionAnswer = {
  dimensionKey: string;
  rawLevel: PerformanceLevel | null;
  rawScore: { toString(): string } | string | number | null;
  derivedLevel: PerformanceLevel | null;
  fields: Array<{ fieldKey: string; fieldType: string; value: unknown }>;
};

type EffectiveSubmission = {
  id: number;
  reviewerOpenId: string;
  reviewerAssignmentId: number | null;
  status: string;
  reviewerAssignment: {
    id: number;
    relation: string;
    status: string;
  } | null;
  dimensionAnswers: StoredDimensionAnswer[];
};

type RelationResultView = {
  relation: ReviewerRelation;
  baseWeight: string;
  adjustedWeight: string;
  reviewerCount: number;
  dimensionScores: Array<{ dimensionKey: string; score: string }>;
};

type PeerReviewFieldView = {
  fieldKey: string;
  title: string;
  type: string;
  value: unknown;
};

type PeerReviewDimensionView = {
  id: string;
  name: string;
  rawLevel: PerformanceLevel | null;
  rawScore: string | null;
  mappedLevel: PerformanceLevel | null;
  fields: PeerReviewFieldView[];
};

export type PeerReviewAnalysisView = {
  assignedReviewerCount: number;
  submittedReviewerCount: number;
  relationCounts: Array<{
    relation: ReviewerRelation;
    reviewerCount: number;
  }>;
  dimensions: Array<{
    id: string;
    name: string;
    score: string;
    level: PerformanceLevel;
    distribution: Record<PerformanceLevel, number>;
  }>;
  reviewers: Array<{
    submissionId: number;
    reviewerOpenId: string;
    relation: ReviewerRelation;
    dimensions: PeerReviewDimensionView[];
  }>;
};

export type PeerStageResultView = {
  participantId: number;
  cycleConfigVersionId: number;
  status: 'READY' | 'NO_DATA';
  /** 数据库旧列尚待最终清理 Ticket 删除；运行时不再读取配置模式。 */
  mode: 'WEIGHTED_SCORE';
  reviewerCount: number;
  compositeScore: string | null;
  initialLevel: PerformanceLevel | null;
  stageLevel: PerformanceLevel | null;
  constraintReasons: UnifiedMatchedConstraint[];
  validRelations: RelationResultView[];
  dimensions: UnifiedStageDimensionResult[];
  analysis: PeerReviewAnalysisView;
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
 * 360°阶段结果服务：只读取新版维度/字段作答，保持“关系内平均 → 有效关系归一化
 * → 关系加权 → 维度加权”的既有口径，并提供实名管理视角权限边界。
 */
@Injectable()
export class PeerStageResultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbacService: RbacService,
  ) {}

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
      throw new ConflictException('周期缺少当前配置快照，无法计算 360°阶段结果');
    }
    const content = participant.formSnapshot?.content as
      | FormSnapshotContent
      | undefined;
    if (!content) {
      throw new ConflictException('参与者缺少表单快照，无法计算 360°阶段结果');
    }

    const submissions = (await db.perfEvaluationSubmission.findMany({
      where: { participantId, stage: PerfEvaluationTaskType.PEER },
      include: {
        reviewerAssignment: {
          select: { id: true, relation: true, status: true },
        },
        dimensionAnswers: {
          include: { fields: true },
          orderBy: { id: 'asc' },
        },
      },
    })) as unknown as EffectiveSubmission[];
    const validSubmissions = submissions.filter(
      (submission) =>
        submission.status === PerfReviewStatus.SUBMITTED &&
        submission.reviewerAssignment?.status === PerfAssignmentStatus.SUBMITTED,
    );
    const draftReviewerOpenIds = new Set(
      submissions
        .filter((submission) => submission.status === PerfReviewStatus.DRAFT)
        .map((submission) => submission.reviewerOpenId),
    );
    const effectiveAssignmentIds = new Set(
      validSubmissions.flatMap((submission) =>
        submission.reviewerAssignmentId ? [submission.reviewerAssignmentId] : [],
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
        mode: 'WEIGHTED_SCORE',
        reviewerCount: 0,
        compositeScore: null,
        initialLevel: null,
        stageLevel: null,
        constraintReasons: [],
        validRelations: [],
        dimensions: [],
        analysis: {
          assignedReviewerCount: participant.reviewerAssignments.length,
          submittedReviewerCount: 0,
          relationCounts: [],
          dimensions: [],
          reviewers: [],
        },
        inputSummary,
      };
      await this.persist(db, participant.cycleId, view, null);
      return view;
    }

    const peerDimensions = this.scoringDimensionsOf(content);
    const relationWeights = this.relationWeightsOf(config);
    const result = calculateUnifiedStageResult({
      ratings: this.ratingsOf(config.ratings),
      confirmedRedLine: null,
      dimensions: peerDimensions.map((dimension) => ({
        id: dimension.key,
        name: dimension.name ?? dimension.key,
        scoringMethod: dimension.scoringMethod!,
        weight: dimension.weight ?? '0',
        isCore: Boolean(dimension.isCore),
        relations: REVIEWER_RELATIONS.flatMap((relation) => {
          const members = validSubmissions.filter(
            (submission) => submission.reviewerAssignment?.relation === relation,
          );
          if (members.length === 0) return [];
          return [
            {
              type: relation,
              weight: relationWeights[relation],
              items: members.map((submission) => {
                const answer = this.requireDimensionAnswer(submission, dimension);
                return {
                  submissionId: String(submission.id),
                  ...(dimension.scoringMethod === 'RATING'
                    ? { rawLevel: this.requirePerformanceLevel(answer.rawLevel) }
                    : { rawScore: this.requireRawScore(answer.rawScore) }),
                };
              }),
            },
          ];
        }),
      })),
    });
    const validRelations = REVIEWER_RELATIONS.flatMap((relation) => {
      const first = result.dimensions[0]?.relations.find(
        (entry) => entry.type === relation,
      );
      if (!first) return [];
      return [
        {
          relation,
          baseWeight: first.baseWeight,
          adjustedWeight: first.effectiveWeight,
          reviewerCount: validSubmissions.filter(
            (submission) => submission.reviewerAssignment?.relation === relation,
          ).length,
          dimensionScores: result.dimensions.map((dimension) => ({
            dimensionKey: dimension.id,
            score:
              dimension.relations.find((entry) => entry.type === relation)?.score ??
              '0',
          })),
        },
      ];
    });
    const view: PeerStageResultView = {
      participantId,
      cycleConfigVersionId: config.id,
      status: 'READY',
      mode: 'WEIGHTED_SCORE',
      reviewerCount: validSubmissions.length,
      compositeScore: result.compositeScore,
      initialLevel: result.initialLevel,
      stageLevel: result.finalLevel,
      constraintReasons: result.matchedConstraints,
      validRelations,
      dimensions: result.dimensions,
      analysis: this.buildAnalysis(
        content,
        participant.reviewerAssignments.length,
        validSubmissions,
        result.dimensions,
      ),
      inputSummary,
    };
    await this.persist(db, participant.cycleId, view, result.unroundedCompositeScore);
    return view;
  }

  async getForManager(operatorOpenId: string, participantId: number) {
    const participant = await this.prisma.perfParticipant.findUnique({
      where: { id: participantId },
      include: { cycle: { select: { deletedAt: true } } },
    });
    if (!participant || participant.cycle.deletedAt) {
      throw new NotFoundException('参与者不存在');
    }
    await this.assertCanView(operatorOpenId, participant);
    return omitStageResultMode(await this.recalculate(participantId));
  }

  private scoringDimensionsOf(content: FormSnapshotContent) {
    const dimensions = content.subforms
      .filter((subform) => subform.type === 'PEER')
      .flatMap((subform) => subform.dimensions)
      .filter(
        (dimension) =>
          dimension.audience === 'REVIEWER' && dimension.type === 'SCORING',
      );
    if (dimensions.length === 0) {
      throw new ConflictException('PEER 表单快照缺少计分维度');
    }
    return dimensions;
  }

  private buildAnalysis(
    content: FormSnapshotContent,
    assignedReviewerCount: number,
    submissions: EffectiveSubmission[],
    resultDimensions: UnifiedStageDimensionResult[],
  ): PeerReviewAnalysisView {
    const dimensions = content.subforms
      .filter((subform) => subform.type === 'PEER')
      .flatMap((subform) => subform.dimensions)
      .filter((dimension) => dimension.audience === 'REVIEWER');
    const reviewers = submissions.map((submission) => ({
      submissionId: submission.id,
      reviewerOpenId: submission.reviewerOpenId,
      relation: submission.reviewerAssignment!.relation as ReviewerRelation,
      dimensions: dimensions.map((dimension) => {
        const answer = submission.dimensionAnswers.find(
          (candidate) => candidate.dimensionKey === dimension.key,
        );
        if (dimension.type === 'SCORING' && !answer) {
          throw new ConflictException(
            `有效 360°提交缺少维度「${dimension.name ?? dimension.key}」的维度作答`,
          );
        }
        const mappedLevel =
          dimension.type === 'SCORING'
            ? this.requirePerformanceLevel(answer?.derivedLevel)
            : null;
        return {
          id: dimension.key,
          name: dimension.name ?? dimension.key,
          rawLevel: answer?.rawLevel ?? null,
          rawScore: answer?.rawScore?.toString() ?? null,
          mappedLevel,
          fields: (dimension.fields ?? []).flatMap((field) => {
            const stored = answer?.fields.find(
              (candidate) => candidate.fieldKey === field.key,
            );
            return stored
              ? [
                  {
                    fieldKey: field.key,
                    title: field.title,
                    type: field.type,
                    value: stored.value,
                  },
                ]
              : [];
          }),
        };
      }),
    }));

    return {
      assignedReviewerCount,
      submittedReviewerCount: submissions.length,
      relationCounts: REVIEWER_RELATIONS.flatMap((relation) => {
        const reviewerCount = reviewers.filter(
          (reviewer) => reviewer.relation === relation,
        ).length;
        return reviewerCount > 0 ? [{ relation, reviewerCount }] : [];
      }),
      dimensions: resultDimensions.map((dimension) => {
        const distribution: Record<PerformanceLevel, number> = {
          S: 0,
          A: 0,
          B: 0,
          C: 0,
        };
        reviewers.forEach((reviewer) => {
          const level = reviewer.dimensions.find(
            (entry) => entry.id === dimension.id,
          )?.mappedLevel;
          if (level) distribution[level] += 1;
        });
        return {
          id: dimension.id,
          name: dimension.name,
          score: dimension.score,
          level: dimension.level,
          distribution,
        };
      }),
      reviewers,
    };
  }

  private requireDimensionAnswer(
    submission: EffectiveSubmission,
    dimension: FormSnapshotDimension,
  ) {
    const answer = submission.dimensionAnswers.find(
      (candidate) => candidate.dimensionKey === dimension.key,
    );
    if (!answer) {
      throw new ConflictException(
        `有效 360°提交缺少维度「${dimension.name ?? dimension.key}」的维度作答`,
      );
    }
    return answer;
  }

  private requirePerformanceLevel(value: unknown): PerformanceLevel {
    if (value === 'S' || value === 'A' || value === 'B' || value === 'C') {
      return value;
    }
    throw new ConflictException('有效 360°提交缺少派生维度等级');
  }

  private requireRawScore(value: StoredDimensionAnswer['rawScore']) {
    if (value === null) {
      throw new ConflictException('有效 360°提交缺少原始分数');
    }
    return value.toString();
  }

  private ratingsOf(value: unknown): RatingScaleEntry[] {
    if (!Array.isArray(value)) {
      throw new ConflictException('周期配置快照缺少评级定义');
    }
    return value as RatingScaleEntry[];
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

  private async persist(
    db: PeerStageResultDb,
    cycleId: number,
    view: PeerStageResultView,
    unroundedCompositeScore: string | null,
  ) {
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
      calculationDetail: {
        inputSummary: view.inputSummary,
        validRelations: view.validRelations,
        dimensions: view.dimensions,
        unroundedCompositeScore,
      } as unknown as Prisma.InputJsonValue,
      calculatedAt: new Date(),
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
      create: { ...data, dimensions: { create: dimensions } },
      update: {
        ...data,
        dimensions: { deleteMany: {}, create: dimensions },
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
    if (!isHr) {
      throw new ForbiddenException('仅考核 Leader 或授权 HR 可查看 360°阶段结果');
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
}
