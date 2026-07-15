import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import {
  PerfEvaluationTaskType,
  PerfReviewStatus,
} from '../generated/prisma/enums';
import {
  calculateStageResult,
  type RatingScaleEntry,
  type StageDimensionInput,
  type StageResultMode,
} from '../calculation/stage-result-calculator';
import type { FormSnapshotContent } from '../evaluation/evaluation.service-types';

export type LegacyStageArtifacts = {
  configVersionId: number;
  formSnapshotIds: Record<'D' | 'M', number>;
};

/**
 * 迁移专用阶段结果重建器。正式 stage service 读取 currentConfigVersionId，而 Ticket 20
 * 不能提前切该指针；本服务显式消费迁移配置/快照，但复用同一个精确十进制计算引擎。
 */
@Injectable()
export class LegacyStageRebuilder {
  async rebuild(
    tx: Prisma.TransactionClient,
    input: {
      cycleId: number;
      participantId: number;
      artifacts: LegacyStageArtifacts;
      prefix: 'D' | 'M';
      stage: 'PEER' | 'MANAGER';
    },
  ): Promise<number> {
    const { cycleId, participantId, artifacts, prefix, stage } = input;
    const [config, snapshot, submissions, redLine] = await Promise.all([
      tx.perfCycleConfigVersion.findUniqueOrThrow({
        where: { id: artifacts.configVersionId },
      }),
      tx.perfCycleFormSnapshot.findUniqueOrThrow({
        where: { id: artifacts.formSnapshotIds[prefix] },
      }),
      tx.perfEvaluationSubmission.findMany({
        where: {
          participantId,
          stage,
          status: PerfReviewStatus.SUBMITTED,
        },
        include: { items: true, reviewerAssignment: true },
      }),
      tx.perfRedLineFinding.findFirst({
        where: {
          participantId,
          action: 'CONFIRM',
          revokedBy: { none: {} },
        },
        orderBy: { id: 'desc' },
      }),
    ]);
    const mode = (
      stage === 'PEER' ? config.peerStageMode : config.managerStageMode
    ) as StageResultMode;
    if (submissions.length === 0) {
      const noData = await tx.perfStageResult.upsert({
        where: {
          participantId_stage_cycleConfigVersionId: {
            participantId,
            stage,
            cycleConfigVersionId: config.id,
          },
        },
        create: {
          cycleId,
          participantId,
          cycleConfigVersionId: config.id,
          stage,
          status: 'NO_DATA',
          mode,
          reviewerCount: 0,
          constraintReasons: [],
          calculationDetail: { dimensions: [], inputSummary: [] },
        },
        update: {
          status: 'NO_DATA',
          reviewerCount: 0,
          compositeScore: null,
          initialLevel: null,
          stageLevel: null,
          constraintReasons: [],
          calculationDetail: { dimensions: [], inputSummary: [] },
          dimensions: { deleteMany: {} },
        },
      });
      return noData.id;
    }
    const content = snapshot.content as unknown as FormSnapshotContent;
    const dimensions = this.buildDimensions(content, mode, stage, submissions, {
      ORG_OWNER: config.orgOwnerWeight.toString(),
      PROJECT_OWNER: config.projectOwnerWeight.toString(),
      PEER: config.peerWeight.toString(),
      CROSS_DEPT: config.crossDeptWeight.toString(),
    });
    const calculated = calculateStageResult({
      mode,
      ratings: config.ratings as unknown as RatingScaleEntry[],
      dimensions,
      constraints: [],
      confirmedRedLine: redLine
        ? {
            findingId: `red-line:${redLine.id}`,
            category: redLine.findingType,
            reason: redLine.reason,
          }
        : null,
    });
    const dimensionRows = calculated.dimensions.map((dimension) => ({
      dimensionKey: dimension.id,
      name: dimension.name,
      weight: dimension.weight,
      isCore: dimension.isCore,
      score: dimension.score,
      level: dimension.level,
      ...(stage === PerfEvaluationTaskType.PEER
        ? {
            relationAggregates: {
              create: dimension.relations.map((relation) => ({
                relation: relation.type as
                  'ORG_OWNER' | 'PROJECT_OWNER' | 'PEER' | 'CROSS_DEPT',
                baseWeight: relation.baseWeight,
                adjustedWeight: relation.effectiveWeight,
                reviewerCount: relation.items.length,
                score: relation.score,
              })),
            },
          }
        : {}),
    }));
    const result = await tx.perfStageResult.upsert({
      where: {
        participantId_stage_cycleConfigVersionId: {
          participantId,
          stage,
          cycleConfigVersionId: config.id,
        },
      },
      create: {
        cycleId,
        participantId,
        cycleConfigVersionId: config.id,
        stage,
        status: 'READY',
        mode,
        reviewerCount: submissions.length,
        compositeScore: calculated.compositeScore,
        initialLevel: calculated.initialLevel,
        stageLevel: calculated.finalLevel,
        constraintReasons: inputJson(calculated.matchedConstraints),
        calculationDetail: inputJson({
          dimensions: calculated.dimensions,
          unroundedCompositeScore: calculated.unroundedCompositeScore,
          inputSummary: submissions.map((submission) => ({
            submissionId: submission.id,
            reviewerOpenId: submission.reviewerOpenId,
          })),
        }),
        dimensions: { create: dimensionRows },
      },
      update: {
        status: 'READY',
        mode,
        reviewerCount: submissions.length,
        compositeScore: calculated.compositeScore,
        initialLevel: calculated.initialLevel,
        stageLevel: calculated.finalLevel,
        constraintReasons: inputJson(calculated.matchedConstraints),
        calculationDetail: inputJson({
          dimensions: calculated.dimensions,
          unroundedCompositeScore: calculated.unroundedCompositeScore,
          inputSummary: submissions.map((submission) => ({
            submissionId: submission.id,
            reviewerOpenId: submission.reviewerOpenId,
          })),
        }),
        dimensions: { deleteMany: {}, create: dimensionRows },
      },
    });
    return result.id;
  }

  private buildDimensions(
    content: FormSnapshotContent,
    mode: StageResultMode,
    stage: 'PEER' | 'MANAGER',
    submissions: Array<{
      id: number;
      items: Array<{
        itemKey: string;
        dimensionKey: string;
        rawLevel: string | null;
        rawScore: { toString(): string } | null;
      }>;
      reviewerAssignment: { relation: string } | null;
    }>,
    relationWeights: Record<
      'ORG_OWNER' | 'PROJECT_OWNER' | 'PEER' | 'CROSS_DEPT',
      string
    >,
  ): StageDimensionInput[] {
    const audience = stage === 'PEER' ? 'REVIEWER' : 'LEADER';
    return content.subforms
      .filter((subform) => subform.type === stage)
      .flatMap((subform) => subform.dimensions)
      .filter(
        (dimension) =>
          dimension.audience === audience &&
          (!dimension.kind || dimension.kind === 'REGULAR'),
      )
      .map((dimension) => {
        const expectedType = mode === 'WEIGHTED_RATING' ? 'RATING' : 'SCORE';
        const item = dimension.items.find(
          (candidate) => candidate.type === expectedType,
        );
        if (!item) throw new Error(`INVALID_STAGE_STRUCTURE:${dimension.key}`);
        if (stage === 'MANAGER') {
          const submission = submissions[0];
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
                    itemId: item.key,
                    submissionId: String(submission.id),
                    rawValue: stageRawValue(
                      mode,
                      submission,
                      dimension.key,
                      item.key,
                    ),
                  },
                ],
              },
            ],
          };
        }
        const relations = (
          ['ORG_OWNER', 'PROJECT_OWNER', 'PEER', 'CROSS_DEPT'] as const
        ).flatMap((relation) => {
          const matches = submissions.filter(
            (submission) =>
              submission.reviewerAssignment?.relation === relation,
          );
          return matches.length === 0
            ? []
            : [
                {
                  type: relation,
                  weight: relationWeights[relation],
                  items: matches.map((submission) => ({
                    itemId: item.key,
                    submissionId: String(submission.id),
                    rawValue: stageRawValue(
                      mode,
                      submission,
                      dimension.key,
                      item.key,
                    ),
                  })),
                },
              ];
        });
        return {
          id: dimension.key,
          name: dimension.name ?? dimension.key,
          weight: dimension.weight ?? '0',
          isCore: Boolean(dimension.isCore),
          relations,
        };
      });
  }
}

function stageRawValue(
  mode: StageResultMode,
  submission: {
    items: Array<{
      itemKey: string;
      dimensionKey: string;
      rawLevel: string | null;
      rawScore: { toString(): string } | null;
    }>;
  },
  dimensionKey: string,
  itemKey: string,
) {
  const item = submission.items.find(
    (candidate) =>
      candidate.dimensionKey === dimensionKey && candidate.itemKey === itemKey,
  );
  const value =
    mode === 'WEIGHTED_RATING' ? item?.rawLevel : item?.rawScore?.toString();
  if (value === null || value === undefined) {
    throw new Error(`MISSING_STAGE_ITEM:${dimensionKey}/${itemKey}`);
  }
  return value;
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}
