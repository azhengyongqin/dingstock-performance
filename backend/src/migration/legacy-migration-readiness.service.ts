import { Injectable } from '@nestjs/common';
import { PerfLegacyMigrationItemStatus } from '../generated/prisma/enums';
import { PerfReviewStatus } from '../generated/prisma/enums';
import { PrismaService } from '../shared/database/prisma.service';
import {
  evaluateMigrationReadiness,
  type ReadinessReport,
} from './legacy-migration-domain';
import type { SourceCycle } from './legacy-migration.service';

export type LegacyMigrationIssue = {
  sourceType: string;
  sourceBusinessKey: string;
  code: string;
  message: string;
  details?: unknown;
};

export type LegacyShadowRow = {
  businessKey: string;
  participantId: number;
  employeeOpenId: string;
  legacyLevel: string | null;
  computedLevel: string | null;
  different: boolean;
  reason: string;
  disposition: 'UNRESOLVED' | 'ACCEPTED';
};

export type LegacyStatusMappingRow = {
  businessKey: string;
  sourceStatus: string;
  targetStatus: string | null;
  closed: boolean;
  reason?: string;
};

/** 汇总可观测校验报告，并形成 Ticket 21 唯一可消费的 readiness 结论。 */
@Injectable()
export class LegacyMigrationReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  async build(input: {
    runId: number;
    dryRun: boolean;
    sourceCounts: Record<string, number>;
    targetCounts: Record<string, number>;
    expectedBusinessKeys: string[];
    issues: LegacyMigrationIssue[];
    shadows: LegacyShadowRow[];
    statusMappings: LegacyStatusMappingRow[];
  }): Promise<{ readiness: ReadinessReport; validationReport: object }> {
    const migratedBusinessKeys = input.dryRun
      ? new Set<string>()
      : await this.migratedBusinessKeys(input.runId);
    const missingBusinessKeys = input.expectedBusinessKeys.filter(
      (key) => !migratedBusinessKeys.has(key),
    );
    const readiness = evaluateMigrationReadiness({
      sourceCounts: input.sourceCounts,
      targetCounts: input.targetCounts,
      missingBusinessKeys,
      invalidDimensionResults: input.issues.filter((issue) =>
        issue.code.includes('DIMENSION'),
      ).length,
      unclosedStatuses: input.statusMappings.filter((item) => !item.closed)
        .length,
      migrationFailures: input.issues.length,
      shadowComparisons: input.shadows,
    });
    if (input.dryRun) {
      readiness.ready = false;
      readiness.blockers.unshift({ code: 'DRY_RUN_ONLY', count: 1 });
    }
    return {
      readiness,
      validationReport: {
        sourceCounts: input.sourceCounts,
        targetCounts: input.targetCounts,
        businessKeys: {
          expected: input.expectedBusinessKeys.length,
          migrated: migratedBusinessKeys.size,
          missing: missingBusinessKeys,
        },
        statusMappings: input.statusMappings,
        issues: input.issues,
        checkedAt: new Date().toISOString(),
      },
    };
  }

  async countTargets(runId: number) {
    const migrated = await this.prisma.perfLegacyMigrationItem.findMany({
      where: { runId, status: PerfLegacyMigrationItemStatus.MIGRATED },
      select: { sourceType: true, targetId: true },
    });
    const submissionIds = migrated
      .filter((item) =>
        ['SELF_SUBMISSION', 'PEER_SUBMISSION', 'MANAGER_SUBMISSION'].includes(
          item.sourceType,
        ),
      )
      .flatMap((item) => (item.targetId ? [item.targetId] : []));
    const submittedRows = await this.prisma.perfEvaluationSubmission.findMany({
      where: {
        id: { in: submissionIds },
        status: PerfReviewStatus.SUBMITTED,
      },
      select: { id: true },
    });
    const stageResultIds = migrated
      .filter((item) =>
        ['PEER_STAGE_RESULT', 'MANAGER_STAGE_RESULT'].includes(item.sourceType),
      )
      .flatMap((item) => (item.targetId ? [item.targetId] : []));
    const [itemResults, dimensionResults, relationResults] = await Promise.all([
      this.prisma.perfEvaluationItemResult.count({
        where: { submissionId: { in: submittedRows.map((row) => row.id) } },
      }),
      this.prisma.perfStageDimensionResult.count({
        where: { stageResultId: { in: stageResultIds } },
      }),
      this.prisma.perfPeerRelationAggregate.count({
        where: {
          stageDimensionResult: { stageResultId: { in: stageResultIds } },
        },
      }),
    ]);
    return {
      cycles: migrated.filter(
        (item) => item.sourceType === 'CYCLE_CONFIGURATION',
      ).length,
      submittedReviews: submittedRows.length,
      results: migrated.filter((item) => item.sourceType === 'RESULT_VERSION')
        .length,
      itemResults,
      dimensionResults,
      relationResults,
    };
  }

  expectedSourceBusinessKeys(cycles: readonly SourceCycle[]) {
    const keys: string[] = [];
    for (const cycle of cycles) {
      keys.push(
        sourceLedgerKey('CYCLE_CONFIGURATION', `perf_cycles:${cycle.id}`),
      );
      for (const participant of cycle.participants) {
        if (participant.selfReview) {
          keys.push(
            sourceLedgerKey(
              'SELF_SUBMISSION',
              `perf_self_reviews:${participant.selfReview.id}`,
            ),
          );
        }
        for (const review of participant.reviews) {
          keys.push(
            sourceLedgerKey('PEER_SUBMISSION', `perf_reviews:${review.id}`),
          );
        }
        if (participant.managerReview) {
          keys.push(
            sourceLedgerKey(
              'MANAGER_SUBMISSION',
              `perf_manager_reviews:${participant.managerReview.id}`,
            ),
          );
        }
        if (participant.result) {
          keys.push(
            sourceLedgerKey(
              'RESULT_VERSION',
              `perf_results:${participant.result.id}`,
            ),
          );
        }
        keys.push(
          sourceLedgerKey(
            'PEER_STAGE_RESULT',
            `participant:${participant.id}/stage:PEER`,
          ),
        );
        if (participant.managerReview) {
          keys.push(
            sourceLedgerKey(
              'MANAGER_STAGE_RESULT',
              `participant:${participant.id}/stage:MANAGER`,
            ),
          );
        }
      }
    }
    return [...new Set(keys)].sort();
  }

  private async migratedBusinessKeys(runId: number) {
    const items = await this.prisma.perfLegacyMigrationItem.findMany({
      where: { runId, status: PerfLegacyMigrationItemStatus.MIGRATED },
      select: { sourceType: true, sourceBusinessKey: true },
    });
    return new Set(
      items.map((item) =>
        sourceLedgerKey(item.sourceType, item.sourceBusinessKey),
      ),
    );
  }
}

export function sourceLedgerKey(sourceType: string, sourceBusinessKey: string) {
  return `${sourceType}|${sourceBusinessKey}`;
}
