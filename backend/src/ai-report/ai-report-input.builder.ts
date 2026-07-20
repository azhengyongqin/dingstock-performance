import { createHash } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import {
  PerfEvaluationTaskType,
  PerfReviewStatus,
} from '../generated/prisma/enums';
import type { AiReportDb, AiReportInput } from './ai-report.types';

const HUMAN_STAGES = [
  PerfEvaluationTaskType.SELF,
  PerfEvaluationTaskType.PEER,
  PerfEvaluationTaskType.MANAGER,
] as const;

/** 只负责把当前有效人工事实投影为稳定、可追溯的 AI 输入快照。 */
@Injectable()
export class AiReportInputBuilder {
  async build(
    participantId: number,
    db: AiReportDb,
  ): Promise<AiReportInput | null> {
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
      include: {
        dimensionAnswers: {
          include: { fields: { orderBy: { id: 'asc' } } },
          orderBy: { id: 'asc' },
        },
      },
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
        dimensionAnswers: submission.dimensionAnswers.map((dimension) => ({
          id: dimension.id,
          subformKey: dimension.subformKey,
          dimensionKey: dimension.dimensionKey,
          scoringMethod: dimension.scoringMethod,
          rawLevel: dimension.rawLevel,
          rawScore: dimension.rawScore?.toString() ?? null,
          calculationScore: dimension.calculationScore?.toString() ?? null,
          derivedLevel: dimension.derivedLevel,
          fields: dimension.fields.map((field) => ({
            id: field.id,
            fieldKey: field.fieldKey,
            fieldType: field.fieldType,
            value: field.value,
          })),
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
}
