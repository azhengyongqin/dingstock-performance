import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import type { Prisma } from '../generated/prisma/client';
import {
  PerfAssignmentStatus,
  PerfEvaluationTaskType,
  PerfReviewStatus,
} from '../generated/prisma/enums';
import {
  calculateStageResult,
  type RatingScaleEntry,
  type StageConstraintRule,
  type StageDimensionInput,
  type StageRelationType,
  type StageResult,
  type StageResultMode,
} from '../calculation/stage-result-calculator';
import type {
  ConfigConstraintProfiles,
  ConfigStageModes,
  ConfigTemplateVersionContract,
  ReviewerRelation,
  ReviewerRelationWeight,
} from '../config-template/config-template.contract';
import type {
  FormSnapshotContent,
  FormSnapshotDimension,
} from './evaluation.service-types';

export type ActiveConfigInput = {
  expectedConfigVersionId: number;
  stageModes: ConfigStageModes;
  ratings: ConfigTemplateVersionContract['ratings'];
  constraintProfiles: ConfigConstraintProfiles;
  reviewerRelationWeights: ReviewerRelationWeight;
  dimensionOverrides: Array<{
    jobLevelPrefix: 'D' | 'M';
    dimensionKey: string;
    weight: string;
    isCore: boolean;
  }>;
};

export const cycleImpactInclude = {
  currentConfigVersion: {
    include: { formSnapshots: { orderBy: { jobLevelPrefix: 'asc' as const } } },
  },
  participants: {
    orderBy: { id: 'asc' as const },
    include: {
      formSnapshot: { select: { id: true, content: true } },
      evaluationSubmissions: {
        orderBy: { id: 'asc' as const },
        include: {
          items: { orderBy: { id: 'asc' as const } },
          reviewerAssignment: {
            select: { id: true, relation: true, status: true },
          },
        },
      },
      stageResults: {
        where: {
          stage: {
            in: [PerfEvaluationTaskType.PEER, PerfEvaluationTaskType.MANAGER],
          },
        },
        select: {
          id: true,
          cycleConfigVersionId: true,
          stage: true,
          status: true,
          compositeScore: true,
          stageLevel: true,
          constraintReasons: true,
          dimensions: {
            orderBy: { dimensionKey: 'asc' as const },
            select: {
              dimensionKey: true,
              name: true,
              weight: true,
              isCore: true,
              score: true,
              level: true,
            },
          },
        },
        orderBy: [{ stage: 'asc' as const }, { id: 'asc' as const }],
      },
      calibrations: {
        select: {
          id: true,
          afterLevel: true,
          inputRevision: true,
          createdAt: true,
        },
        orderBy: { id: 'asc' as const },
      },
      resultVersions: {
        where: { supersededAt: null },
        select: {
          id: true,
          version: true,
          finalLevel: true,
          supersededAt: true,
          confirmedAt: true,
        },
        take: 1,
      },
      redLineFindings: {
        select: {
          id: true,
          action: true,
          revokeOfId: true,
          findingType: true,
          reason: true,
        },
        orderBy: { id: 'asc' as const },
      },
    },
  },
} satisfies Prisma.PerfCycleInclude;

export type ImpactCycle = Prisma.PerfCycleGetPayload<{
  include: typeof cycleImpactInclude;
}>;

export type ImpactStage = 'PEER' | 'MANAGER';

export type ActiveConfigImpactPreview = {
  cycleId: number;
  currentConfigVersionId: number;
  currentVersion: number;
  nextVersion: number;
  /** 预览所依据的完整业务输入摘要；apply 必须原样回传，防止确认旧预览。 */
  impactRevision: string;
  summary: {
    affectedParticipantCount: number;
    affectedStageResultCount: number;
    changedStageResultCount: number;
    calibratedParticipantCount: number;
    publishedParticipantCount: number;
    confirmedParticipantCount: number;
    automaticRecalibrationParticipantCount: 0;
    affectedCalculationItemCount: number;
    changedCalculationItemCount: number;
  };
  stageChanges: Array<{
    participantId: number;
    employeeOpenId: string;
    stage: ImpactStage;
    before: StageImpactResult | null;
    after: StageImpactResult;
    changed: boolean;
    finalResultProtected: boolean;
  }>;
  calculationItemChanges: Array<{
    participantId: number;
    employeeOpenId: string;
    submissionId: number;
    stage: string;
    status: string;
    itemKey: string;
    before: string | null;
    after: string;
    changed: boolean;
  }>;
};

type StageImpactResult = {
  compositeScore: string | null;
  stageLevel: string | null;
  dimensions: Array<{
    key: string;
    name: string;
    weight: string;
    isCore: boolean;
    score: string;
    level: string;
  }>;
  matchedConstraints: unknown[];
};

type Submission =
  ImpactCycle['participants'][number]['evaluationSubmissions'][number];

const STAGE_POLICIES = {
  PEER: {
    audience: 'REVIEWER',
    acceptsSubmission: (submission: Submission) =>
      submission.reviewerAssignment?.status === PerfAssignmentStatus.SUBMITTED,
    relationOf: (submission: Submission) =>
      submission.reviewerAssignment?.relation,
  },
  MANAGER: {
    audience: 'LEADER',
    acceptsSubmission: () => true,
    relationOf: () => 'LEADER' as const,
  },
} satisfies Record<
  ImpactStage,
  {
    audience: 'REVIEWER' | 'LEADER';
    acceptsSubmission: (submission: Submission) => boolean;
    relationOf: (submission: Submission) => string | undefined;
  }
>;

/** 纯影响计算器：只消费当前快照和原始有效提交，不写数据库。 */
export function buildActiveConfigImpact(
  cycle: ImpactCycle,
  input: ActiveConfigInput,
): ActiveConfigImpactPreview {
  const stageChanges: ActiveConfigImpactPreview['stageChanges'] = [];
  const calculationItemChanges: ActiveConfigImpactPreview['calculationItemChanges'] =
    [];
  for (const participant of cycle.participants) {
    for (const submission of participant.evaluationSubmissions) {
      for (const item of submission.items) {
        if (item.itemType !== 'RATING' || !item.rawLevel) continue;
        const after = input.ratings.find(
          (rating) => rating.symbol === item.rawLevel,
        )?.mappingScore;
        if (after === undefined)
          throw new ConflictException(`评级 ${item.rawLevel} 缺少新映射分`);
        const before = item.calculationScore?.toString() ?? null;
        calculationItemChanges.push({
          participantId: participant.id,
          employeeOpenId: participant.employeeOpenId,
          submissionId: submission.id,
          stage: submission.stage,
          status: submission.status,
          itemKey: item.itemKey,
          before,
          after,
          changed: !equalNullableDecimal(before, after),
        });
      }
    }
    const currentStageResults = participant.stageResults.filter(
      (result) => result.cycleConfigVersionId === cycle.currentConfigVersionId,
    );
    const stages = new Set<ImpactStage>();
    for (const result of currentStageResults) {
      if (result.stage === 'PEER' || result.stage === 'MANAGER')
        stages.add(result.stage);
    }
    for (const submission of participant.evaluationSubmissions) {
      if (submission.stage === 'PEER' || submission.stage === 'MANAGER')
        stages.add(submission.stage);
    }
    for (const stage of stages) {
      const beforeRow = currentStageResults.find(
        (item) => item.stage === stage,
      );
      const before = beforeRow
        ? {
            compositeScore: beforeRow.compositeScore?.toString() ?? null,
            stageLevel: beforeRow.stageLevel ?? null,
            dimensions: beforeRow.dimensions.map((dimension) => ({
              key: dimension.dimensionKey,
              name: dimension.name,
              weight: dimension.weight.toString(),
              isCore: dimension.isCore,
              score: dimension.score.toString(),
              level: dimension.level,
            })),
            matchedConstraints: Array.isArray(beforeRow.constraintReasons)
              ? beforeRow.constraintReasons
              : [],
          }
        : null;
      const calculated = calculateParticipantStage(participant, stage, input);
      const after = {
        compositeScore: calculated?.compositeScore ?? null,
        stageLevel: calculated?.finalLevel ?? null,
        dimensions: (calculated?.dimensions ?? []).map((dimension) => ({
          key: dimension.id,
          name: dimension.name,
          weight: dimension.weight,
          isCore: dimension.isCore,
          score: dimension.score,
          level: dimension.level,
        })),
        matchedConstraints: calculated?.matchedConstraints ?? [],
      };
      const changed =
        !equalNullableDecimal(
          before?.compositeScore ?? null,
          after.compositeScore,
        ) ||
        before?.stageLevel !== after.stageLevel ||
        canonicalJson(before?.dimensions ?? []) !==
          canonicalJson(after.dimensions) ||
        canonicalJson(before?.matchedConstraints ?? []) !==
          canonicalJson(after.matchedConstraints);
      stageChanges.push({
        participantId: participant.id,
        employeeOpenId: participant.employeeOpenId,
        stage,
        before,
        after,
        changed,
        finalResultProtected:
          participant.calibrations.length > 0 ||
          participant.resultVersions.length > 0,
      });
    }
  }

  const affectedParticipantIds = new Set([
    ...stageChanges.map((item) => item.participantId),
    ...calculationItemChanges.map((item) => item.participantId),
  ]);
  const affected = cycle.participants.filter((item) =>
    affectedParticipantIds.has(item.id),
  );
  return {
    cycleId: cycle.id,
    currentConfigVersionId: cycle.currentConfigVersion!.id,
    currentVersion: cycle.currentConfigVersion!.version,
    nextVersion: cycle.currentConfigVersion!.version + 1,
    impactRevision: impactRevisionOf(cycle, input),
    summary: {
      affectedParticipantCount: affected.length,
      affectedStageResultCount: stageChanges.length,
      changedStageResultCount: stageChanges.filter((item) => item.changed)
        .length,
      calibratedParticipantCount: affected.filter(
        (item) => item.calibrations.length > 0,
      ).length,
      publishedParticipantCount: affected.filter(
        (item) => item.resultVersions.length > 0,
      ).length,
      confirmedParticipantCount: affected.filter(
        (item) => item.resultVersions[0]?.confirmedAt,
      ).length,
      automaticRecalibrationParticipantCount: 0,
      affectedCalculationItemCount: calculationItemChanges.length,
      changedCalculationItemCount: calculationItemChanges.filter(
        (item) => item.changed,
      ).length,
    },
    stageChanges,
    calculationItemChanges,
  };
}

/** 把预览使用的配置、原始提交、阶段结果及人工结果链一起纳入并发令牌。 */
export function impactRevisionOf(cycle: ImpactCycle, input: ActiveConfigInput) {
  return createHash('sha256')
    .update(
      canonicalJson({
        cycleId: cycle.id,
        currentConfigVersionId: cycle.currentConfigVersionId,
        input: {
          expectedConfigVersionId: input.expectedConfigVersionId,
          stageModes: input.stageModes,
          ratings: input.ratings,
          constraintProfiles: input.constraintProfiles,
          reviewerRelationWeights: input.reviewerRelationWeights,
          dimensionOverrides: input.dimensionOverrides,
        },
        participants: cycle.participants.map((participant) => ({
          id: participant.id,
          updatedAt: participant.updatedAt,
          submissions: participant.evaluationSubmissions,
          stageResults: participant.stageResults,
          calibrations: participant.calibrations,
          resultVersions: participant.resultVersions,
          redLineFindings: participant.redLineFindings,
        })),
      }),
    )
    .digest('hex');
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).sort(
          ([left], [right]) => left.localeCompare(right),
        ),
      );
    }
    return item;
  });
}

/** 维度稳定 key 不变，只在新快照中替换权重和核心标记。 */
export function applyDimensionOverrides(
  source: FormSnapshotContent,
  jobLevelPrefix: string | null,
  overrides: ActiveConfigInput['dimensionOverrides'],
): FormSnapshotContent {
  const byKey = new Map(
    overrides
      .filter((item) => item.jobLevelPrefix === jobLevelPrefix)
      .map((item) => [item.dimensionKey, item]),
  );
  return {
    ...source,
    subforms: source.subforms.map((subform) => ({
      ...subform,
      dimensions: subform.dimensions.map((dimension) => {
        const override = byKey.get(dimension.key);
        return override
          ? { ...dimension, weight: override.weight, isCore: override.isCore }
          : dimension;
      }),
    })),
  };
}

function calculateParticipantStage(
  participant: ImpactCycle['participants'][number],
  stage: ImpactStage,
  input: ActiveConfigInput,
): StageResult | null {
  const policy = STAGE_POLICIES[stage];
  const submissions = participant.evaluationSubmissions.filter(
    (item) =>
      item.stage === stage &&
      item.status === PerfReviewStatus.SUBMITTED &&
      policy.acceptsSubmission(item),
  );
  if (submissions.length === 0) return null;
  const sourceContent = participant.formSnapshot?.content as
    FormSnapshotContent | undefined;
  if (!sourceContent)
    throw new ConflictException(`参与者 #${participant.id} 缺少表单快照`);
  const content = applyDimensionOverrides(
    sourceContent,
    participant.jobLevelPrefixSnapshot,
    input.dimensionOverrides,
  );

  const mode = input.stageModes[stage];
  const dimensions = content.subforms
    .filter((subform) => subform.type === stage)
    .flatMap((subform) => subform.dimensions)
    .filter(
      (dimension) =>
        dimension.audience === policy.audience &&
        (!dimension.kind || dimension.kind === 'REGULAR'),
    )
    .map((dimension) =>
      toStageDimension(dimension, mode, policy, submissions, input),
    );
  const activeRedLine = activeRedLineOf(participant.redLineFindings);
  try {
    return calculateStageResult({
      mode,
      ratings: input.ratings.map((rating) => ({
        symbol: rating.symbol,
        minScore: rating.minScore,
        maxScore: rating.maxScore,
        mappingScore: rating.mappingScore,
      })) satisfies RatingScaleEntry[],
      dimensions,
      constraints: constraintsOf(input.constraintProfiles, mode),
      confirmedRedLine:
        stage === 'MANAGER' && activeRedLine
          ? {
              findingId: `red-line:${activeRedLine.id}`,
              category: activeRedLine.findingType,
              reason: activeRedLine.reason,
            }
          : null,
    });
  } catch (error) {
    throw new BadRequestException({
      code: 'ACTIVE_CYCLE_RECALCULATION_PREVIEW_FAILED',
      message: `参与者 #${participant.id} 的 ${stage} 阶段无法按新配置重算`,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function toStageDimension(
  dimension: FormSnapshotDimension,
  mode: StageResultMode,
  policy: (typeof STAGE_POLICIES)[ImpactStage],
  submissions: Submission[],
  input: ActiveConfigInput,
): StageDimensionInput {
  const expectedType = mode === 'WEIGHTED_RATING' ? 'RATING' : 'SCORE';
  const scoringItems = dimension.items.filter(
    (item) => item.type === expectedType,
  );
  if (scoringItems.length !== 1) {
    throw new ConflictException(
      `维度「${dimension.name ?? dimension.key}」与目标计算模式不兼容；计分项类型属于结构修改`,
    );
  }
  const scoringItem = scoringItems[0];
  const relationGroups = new Map<string, Submission[]>();
  for (const submission of submissions) {
    const relation = policy.relationOf(submission);
    if (!relation) continue;
    relationGroups.set(relation, [
      ...(relationGroups.get(relation) ?? []),
      submission,
    ]);
  }
  return {
    id: dimension.key,
    name: dimension.name ?? dimension.key,
    weight: dimension.weight ?? '0',
    isCore: Boolean(dimension.isCore),
    relations: [...relationGroups.entries()].map(([relation, rows]) => ({
      type: relation as StageRelationType,
      weight:
        relation === 'LEADER'
          ? '100'
          : input.reviewerRelationWeights[relation as ReviewerRelation],
      items: rows.map((submission) => {
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
            `有效提交缺少维度「${dimension.name ?? dimension.key}」计分值`,
          );
        }
        return {
          itemId: scoringItem.key,
          submissionId: String(submission.id),
          rawValue,
        };
      }),
    })),
  };
}

function activeRedLineOf(
  findings: ImpactCycle['participants'][number]['redLineFindings'],
) {
  const revokedIds = new Set(
    findings.flatMap((item) =>
      item.action === 'REVOKE' && item.revokeOfId ? [item.revokeOfId] : [],
    ),
  );
  return findings.find(
    (item) => item.action === 'CONFIRM' && !revokedIds.has(item.id),
  );
}

function constraintsOf(
  profiles: ConfigConstraintProfiles,
  mode: StageResultMode,
): StageConstraintRule[] {
  return profiles[mode]
    .filter((rule) => rule.enabled)
    .map((rule) =>
      'triggerRating' in rule
        ? {
            id: rule.id,
            type: rule.type,
            triggerRating: rule.triggerRating,
            targetLevel: rule.targetLevel,
          }
        : {
            id: rule.id,
            type: rule.type,
            threshold: rule.threshold,
            targetLevel: rule.targetLevel,
          },
    );
}

function equalNullableDecimal(left: string | null, right: string | null) {
  if (left === null || right === null) return left === right;
  return new Decimal(left).eq(right);
}
