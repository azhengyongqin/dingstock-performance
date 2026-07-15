import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import {
  PerfConfigTemplateVersionStatus,
  PerfEvaluationTaskType,
  PerfFormDimensionKind,
  PerfFormItemType,
  PerfFormTemplateVersionStatus,
  PerfLegacyMigrationItemStatus,
  PerfLegacyMigrationRunStatus,
  PerfRatingSymbol,
  PerfReviewStatus,
  PerfStageResultMode,
} from '../generated/prisma/enums';
import { PrismaService } from '../shared/database/prisma.service';
import {
  LegacyStageRebuilder,
  type LegacyStageArtifacts,
} from './legacy-stage-rebuilder';
import {
  buildLegacyFormSnapshot,
  mapLegacyCycleStatus,
  mapLegacyParticipantStatus,
  rebuildLegacyDimensionItems,
  type LegacyDimension,
  type ReadinessReport,
} from './legacy-migration-domain';
import { LegacyMigrationLedgerService } from './legacy-migration-ledger.service';
import {
  LegacyMigrationReadinessService,
  type LegacyMigrationIssue as MigrationIssue,
  type LegacyShadowRow as ShadowRow,
  type LegacyStatusMappingRow as StatusMappingRow,
} from './legacy-migration-readiness.service';

export type LegacyMigrationOptions = {
  runKey: string;
  cycleId?: number;
  dryRun: boolean;
  acceptShadowBusinessKeys?: readonly string[];
};

export type SourceCycle = Prisma.PerfCycleGetPayload<{
  include: {
    evaluationRule: true;
    dimensions: true;
    template: { include: { dimensions: true } };
    participants: {
      include: {
        selfReview: true;
        reviews: true;
        managerReview: true;
        reviewerAssignments: true;
        result: true;
        resultVersions: true;
        calibrations: true;
        appeals: true;
      };
    };
  };
}>;

type CycleArtifacts = LegacyStageArtifacts;

/**
 * Ticket 20 加法迁移 runner：只写新表和迁移账本，不切换 currentConfigVersionId，
 * 因此旧读取与现有用户流程在 readiness 通过前保持原样。
 */
@Injectable()
export class LegacyMigrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stageRebuilder: LegacyStageRebuilder,
    private readonly ledger: LegacyMigrationLedgerService,
    private readonly readinessBuilder: LegacyMigrationReadinessService,
  ) {}

  async run(options: LegacyMigrationOptions) {
    const startedAt = new Date();
    const previous = await this.prisma.perfLegacyMigrationRun.findUnique({
      where: { runKey: options.runKey },
    });
    if (previous?.status === PerfLegacyMigrationRunStatus.ROLLED_BACK) {
      throw new Error('已回滚批次不可复用，请创建新的 run-key');
    }
    if (
      previous &&
      (previous.dryRun !== options.dryRun ||
        previous.cycleId !== (options.cycleId ?? null))
    ) {
      throw new Error('同一 run-key 不允许改变 dry-run 或 cycle 范围');
    }
    if (previous?.status === PerfLegacyMigrationRunStatus.RUNNING) {
      throw new Error(`迁移批次 ${options.runKey} 正在执行，请勿并发启动`);
    }
    if (previous?.status === PerfLegacyMigrationRunStatus.COMPLETED) {
      return completedRunResponse(previous);
    }

    const run = previous
      ? await this.resumeFailedRun(previous.id, options, startedAt)
      : await this.createRun(options, startedAt);
    try {
      const cycles = await this.loadSourceCycles(options.cycleId);
      const sourceCounts = this.countSources(cycles);
      const issues: MigrationIssue[] = [];
      const shadows: ShadowRow[] = [];
      const statusMappings: StatusMappingRow[] = [];
      const artifacts = new Map<number, CycleArtifacts>();

      for (const cycle of cycles) {
        const mappedCycle = mapLegacyCycleStatus(cycle.status);
        if ('issue' in mappedCycle) {
          issues.push({
            sourceType: 'CYCLE_STATUS',
            sourceBusinessKey: `perf_cycles:${cycle.id}`,
            code: mappedCycle.issue,
            message: `无法映射周期状态 ${mappedCycle.sourceValue}`,
          });
          continue;
        }
        this.analyzeParticipants(cycle, issues, statusMappings);
        if (!options.dryRun) {
          const created = await this.migrateCycleArtifacts(
            run.id,
            cycle,
            issues,
          );
          if (created) artifacts.set(cycle.id, created);
        }
      }

      if (!options.dryRun) {
        for (const cycle of cycles) {
          const cycleArtifacts = artifacts.get(cycle.id);
          if (!cycleArtifacts) continue;
          await this.migrateCycleSubmissions(
            run.id,
            cycle,
            cycleArtifacts,
            issues,
          );
          await this.migrateLegacyResults(run.id, cycle, issues);
          await this.rebuildStageResults(
            run.id,
            cycle,
            cycleArtifacts,
            shadows,
            issues,
            new Set(options.acceptShadowBusinessKeys ?? []),
          );
        }
      }

      const targetCounts = options.dryRun
        ? {
            cycles: 0,
            submittedReviews: 0,
            results: 0,
            itemResults: 0,
            dimensionResults: 0,
            relationResults: 0,
          }
        : await this.readinessBuilder.countTargets(run.id);
      const { readiness, validationReport } = await this.readinessBuilder.build(
        {
          runId: run.id,
          dryRun: options.dryRun,
          sourceCounts,
          targetCounts,
          expectedBusinessKeys:
            this.readinessBuilder.expectedSourceBusinessKeys(cycles),
          issues,
          shadows,
          statusMappings,
        },
      );
      const completed = await this.prisma.perfLegacyMigrationRun.update({
        where: { id: run.id },
        data: {
          status: PerfLegacyMigrationRunStatus.COMPLETED,
          sourceCounts: inputJson(sourceCounts),
          migratedCounts: inputJson(targetCounts),
          validationReport: inputJson(validationReport),
          shadowReport: inputJson({
            total: shadows.length,
            differences: shadows.filter((item) => item.different).length,
            rows: shadows,
          }),
          readinessReport: inputJson(readiness),
          completedAt: new Date(),
        },
      });
      return {
        runId: completed.id,
        runKey: completed.runKey,
        dryRun: completed.dryRun,
        validationReport,
        shadowReport: shadows,
        readiness,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.perfLegacyMigrationRun.update({
        where: { id: run.id },
        data: {
          status: PerfLegacyMigrationRunStatus.FAILED,
          errorMessage: message,
          completedAt: new Date(),
        },
      });
      throw error;
    }
  }

  private async createRun(options: LegacyMigrationOptions, startedAt: Date) {
    try {
      return await this.prisma.perfLegacyMigrationRun.create({
        data: {
          runKey: options.runKey,
          cycleId: options.cycleId,
          dryRun: options.dryRun,
          status: PerfLegacyMigrationRunStatus.RUNNING,
          startedAt,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new Error(`迁移批次 ${options.runKey} 已存在或正在执行`);
      }
      throw error;
    }
  }

  private async resumeFailedRun(
    id: number,
    options: LegacyMigrationOptions,
    startedAt: Date,
  ) {
    const claimed = await this.prisma.perfLegacyMigrationRun.updateMany({
      where: {
        id,
        status: PerfLegacyMigrationRunStatus.FAILED,
        cycleId: options.cycleId ?? null,
        dryRun: options.dryRun,
      },
      data: {
        status: PerfLegacyMigrationRunStatus.RUNNING,
        startedAt,
        completedAt: null,
        errorMessage: null,
      },
    });
    if (claimed.count !== 1) {
      throw new Error(`迁移批次 ${options.runKey} 已被其他执行器领取`);
    }
    const run = await this.prisma.perfLegacyMigrationRun.findUnique({
      where: { id },
    });
    if (!run) throw new Error(`迁移批次 ${options.runKey} 不存在`);
    return run;
  }

  /** Ticket 21 切读前调用；没有成功且 ready 的批次就明确拒绝。 */
  async assertReady(runKey: string): Promise<ReadinessReport> {
    const run = await this.prisma.perfLegacyMigrationRun.findUnique({
      where: { runKey },
    });
    if (!run || run.status !== PerfLegacyMigrationRunStatus.COMPLETED) {
      throw new Error(`迁移批次 ${runKey} 不存在或未成功完成`);
    }
    const report = run.readinessReport as ReadinessReport | null;
    if (!report?.ready) {
      throw new Error(
        `迁移批次 ${runKey} 未达到切读门槛：${JSON.stringify(report?.blockers ?? [])}`,
      );
    }
    return report;
  }

  async getReport(runKey: string) {
    const run = await this.prisma.perfLegacyMigrationRun.findUnique({
      where: { runKey },
      include: {
        items: { orderBy: [{ status: 'asc' }, { sourceType: 'asc' }] },
      },
    });
    if (!run) throw new Error(`迁移批次 ${runKey} 不存在`);
    return run;
  }

  /**
   * 扩展期回滚不删除不可变新历史，只将本批次账本标记回滚；由于 runner 从未切 currentConfigVersionId，
   * 旧读路径天然保持有效。该补偿动作可安全演练并保留全部取证数据。
   */
  async rollback(runKey: string) {
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.perfLegacyMigrationRun.findUnique({
        where: { runKey },
      });
      if (!run) throw new Error(`迁移批次 ${runKey} 不存在`);
      if (run.status !== PerfLegacyMigrationRunStatus.COMPLETED) {
        throw new Error('只有已完成批次可以执行补偿回滚');
      }
      await tx.perfLegacyMigrationItem.updateMany({
        where: {
          runId: run.id,
          status: PerfLegacyMigrationItemStatus.MIGRATED,
        },
        data: {
          status: PerfLegacyMigrationItemStatus.ROLLED_BACK,
          detail: inputJson({
            rollbackMode: 'DETACH_ONLY',
            note: '未启用新读路径；保留不可变迁移产物供审计，Ticket 21 不得使用本批次切读',
          }),
        },
      });
      return tx.perfLegacyMigrationRun.update({
        where: { id: run.id },
        data: {
          status: PerfLegacyMigrationRunStatus.ROLLED_BACK,
          rolledBackAt: new Date(),
          readinessReport: inputJson({
            ready: false,
            blockers: [{ code: 'RUN_ROLLED_BACK', count: 1 }],
          }),
        },
      });
    });
  }

  private loadSourceCycles(cycleId?: number) {
    return this.prisma.perfCycle.findMany({
      where: {
        deletedAt: null,
        ...(cycleId ? { id: cycleId } : {}),
        OR: [
          { currentConfigVersionId: null },
          { templateId: { not: null } },
          { evaluationRule: { isNot: null } },
          { dimensions: { some: {} } },
        ],
      },
      include: {
        evaluationRule: true,
        dimensions: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        },
        template: {
          include: { dimensions: { orderBy: { sortOrder: 'asc' } } },
        },
        participants: {
          include: {
            selfReview: true,
            reviews: true,
            managerReview: true,
            reviewerAssignments: true,
            result: true,
            resultVersions: true,
            calibrations: true,
            appeals: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });
  }

  private countSources(cycles: readonly SourceCycle[]) {
    const dimensionBusinessKeys = new Set<string>();
    const relationBusinessKeys = new Set<string>();
    for (const cycle of cycles) {
      for (const participant of cycle.participants) {
        for (const review of participant.reviews.filter(
          (item) => item.status === 'SUBMITTED',
        )) {
          for (const dimensionId of legacyDimensionIds(
            review.dimensionScores,
          )) {
            dimensionBusinessKeys.add(
              `participant:${participant.id}/stage:PEER/dimension:${dimensionId}`,
            );
            const relation = participant.reviewerAssignments.find(
              (item) =>
                item.reviewerOpenId === review.reviewerOpenId &&
                item.status !== 'REPLACED',
            )?.relation;
            if (relation) {
              relationBusinessKeys.add(
                `participant:${participant.id}/dimension:${dimensionId}/relation:${relation}`,
              );
            }
          }
        }
        if (participant.managerReview?.status === 'SUBMITTED') {
          for (const dimensionId of legacyDimensionIds(
            participant.managerReview.dimensionScores,
          )) {
            dimensionBusinessKeys.add(
              `participant:${participant.id}/stage:MANAGER/dimension:${dimensionId}`,
            );
          }
        }
      }
    }
    return {
      cycles: cycles.length,
      submittedReviews: cycles.reduce(
        (total, cycle) =>
          total +
          cycle.participants.reduce(
            (participantTotal, participant) =>
              participantTotal +
              (participant.selfReview?.status === 'SUBMITTED' ? 1 : 0) +
              participant.reviews.filter(
                (review) => review.status === 'SUBMITTED',
              ).length +
              (participant.managerReview?.status === 'SUBMITTED' ? 1 : 0),
            0,
          ),
        0,
      ),
      results: cycles.reduce(
        (total, cycle) =>
          total + cycle.participants.filter((item) => item.result).length,
        0,
      ),
      itemResults: cycles.reduce(
        (total, cycle) =>
          total +
          cycle.participants.reduce((participantTotal, participant) => {
            const prefix = participantPrefix(participant);
            if (!prefix) return participantTotal;
            const snapshot = buildLegacyFormSnapshot(
              prefix,
              legacyDimensions(cycle.dimensions),
            );
            const selfItems =
              participant.selfReview?.status === 'SUBMITTED'
                ? legacySelfValueItems(participant.selfReview).length +
                  (extractLegacySelfLevel(
                    participant.selfReview.summary,
                    participant.selfReview.okrContent,
                  )
                    ? 1
                    : 0)
                : 0;
            const peerItems = participant.reviews
              .filter((review) => review.status === 'SUBMITTED')
              .reduce(
                (reviewTotal, review) =>
                  reviewTotal +
                  rebuildLegacyDimensionItems({
                    stage: 'PEER',
                    dimensionScores: review.dimensionScores,
                    snapshot,
                  }).items.length,
                0,
              );
            const managerItems =
              participant.managerReview?.status === 'SUBMITTED'
                ? rebuildLegacyDimensionItems({
                    stage: 'MANAGER',
                    dimensionScores: participant.managerReview.dimensionScores,
                    snapshot,
                  }).items.length
                : 0;
            return participantTotal + selfItems + peerItems + managerItems;
          }, 0),
        0,
      ),
      dimensionResults: dimensionBusinessKeys.size,
      relationResults: relationBusinessKeys.size,
    };
  }

  private analyzeParticipants(
    cycle: SourceCycle,
    issues: MigrationIssue[],
    statusMappings: StatusMappingRow[],
  ) {
    for (const participant of cycle.participants) {
      const prefix = participantPrefix(participant);
      if (!prefix) {
        issues.push({
          sourceType: 'PARTICIPANT',
          sourceBusinessKey: participantBusinessKey(
            cycle.id,
            participant.employeeOpenId,
          ),
          code: 'MISSING_JOB_LEVEL_PREFIX',
          message: '职级快照不能确定 D/M 前缀，必须人工修复主数据',
        });
      }
      if (prefix) {
        const snapshot = buildLegacyFormSnapshot(
          prefix,
          legacyDimensions(cycle.dimensions),
        );
        for (const review of participant.reviews.filter(
          (item) => item.status === 'SUBMITTED',
        )) {
          const rebuilt = rebuildLegacyDimensionItems({
            stage: 'PEER',
            dimensionScores: review.dimensionScores,
            snapshot,
          });
          if (rebuilt.issues.length > 0) {
            issues.push({
              sourceType: 'PEER_SUBMISSION',
              sourceBusinessKey: `perf_reviews:${review.id}`,
              code: 'INVALID_DIMENSION_JSON',
              message: '旧 360° 维度 JSON 无法完整重建',
              details: rebuilt.issues,
            });
          }
        }
        if (participant.managerReview?.status === 'SUBMITTED') {
          const rebuilt = rebuildLegacyDimensionItems({
            stage: 'MANAGER',
            dimensionScores: participant.managerReview.dimensionScores,
            snapshot,
          });
          if (rebuilt.issues.length > 0) {
            issues.push({
              sourceType: 'MANAGER_SUBMISSION',
              sourceBusinessKey: `perf_manager_reviews:${participant.managerReview.id}`,
              code: 'INVALID_DIMENSION_JSON',
              message: '旧上级评估维度 JSON 无法完整重建',
              details: rebuilt.issues,
            });
          }
        }
        if (
          participant.selfReview?.status === 'SUBMITTED' &&
          !extractLegacySelfLevel(
            participant.selfReview.summary,
            participant.selfReview.okrContent,
          )
        ) {
          issues.push({
            sourceType: 'SELF_SUBMISSION',
            sourceBusinessKey: `perf_self_reviews:${participant.selfReview.id}`,
            code: 'MISSING_LEGACY_SELF_LEVEL',
            message: '已提交旧自评缺少可验证的 S/A/B/C 自评等级',
          });
        }
      }
      const mapped = mapLegacyParticipantStatus(participant.status, {
        hasCalibration: participant.calibrations.some(
          (item) => !item.invalidatedAt,
        ),
        hasPublishedResult: participant.resultVersions.some(
          (item) => !item.supersededAt && !item.invalidatedAt,
        ),
        resultConfirmed:
          participant.result?.confirmedByEmployee === true ||
          participant.resultVersions.some((item) => item.confirmedAt !== null),
        hasOpenAppeal: participant.appeals.some(
          (item) => item.status !== 'RESOLVED' && !item.invalidatedAt,
        ),
      });
      if ('issue' in mapped) {
        statusMappings.push({
          businessKey: participantBusinessKey(
            cycle.id,
            participant.employeeOpenId,
          ),
          sourceStatus: participant.status,
          targetStatus: null,
          closed: false,
          reason: mapped.reason,
        });
        issues.push({
          sourceType: 'PARTICIPANT_STATUS',
          sourceBusinessKey: participantBusinessKey(
            cycle.id,
            participant.employeeOpenId,
          ),
          code: mapped.issue,
          message: mapped.reason ?? `无法映射状态 ${mapped.sourceValue}`,
        });
      } else {
        statusMappings.push({
          businessKey: participantBusinessKey(
            cycle.id,
            participant.employeeOpenId,
          ),
          sourceStatus: participant.status,
          targetStatus: mapped.value,
          closed: true,
        });
      }
    }
  }

  private async migrateCycleArtifacts(
    runId: number,
    cycle: SourceCycle,
    issues: MigrationIssue[],
  ): Promise<CycleArtifacts | null> {
    const sourceKey = `perf_cycles:${cycle.id}`;
    const payload = {
      id: cycle.id,
      templateId: cycle.templateId,
      rule: cycle.evaluationRule,
      dimensions: cycle.dimensions,
      windows: cycle.windows,
      notificationRules: cycle.notificationRules,
    };
    try {
      const targetId = await this.ledger.migrateItem(
        runId,
        'CYCLE_CONFIGURATION',
        sourceKey,
        payload,
        'PerfCycleConfigVersion',
        async (tx) => {
          const sourceBundle = await this.ensureSourceBundle(tx, cycle);
          const existing = await tx.perfCycleConfigVersion.findUnique({
            where: { cycleId_version: { cycleId: cycle.id, version: 1 } },
            include: { formSnapshots: true },
          });
          if (existing) return existing.id;
          const ratings = normalizedRatings(
            cycle.evaluationRule?.levels ?? cycle.template?.levels ?? [],
          );
          const config = await tx.perfCycleConfigVersion.create({
            data: {
              cycleId: cycle.id,
              version: 1,
              sourceConfigTemplateVersionId: sourceBundle.configVersionId,
              selfStageMode: PerfStageResultMode.DIRECT_RATING,
              peerStageMode: inferStageMode(cycle.dimensions, 'REVIEWER'),
              managerStageMode: inferStageMode(cycle.dimensions, 'LEADER'),
              aiStageMode: PerfStageResultMode.DIRECT_RATING,
              ratings: inputJson(ratings),
              constraintProfiles: {
                WEIGHTED_RATING: [],
                WEIGHTED_SCORE: [],
              },
              orgOwnerWeight: '30',
              projectOwnerWeight: '30',
              peerWeight: '25',
              crossDeptWeight: '15',
              schedulePreset: inputJson({ legacyWindows: cycle.windows }),
              notificationRules: inputJson(cycle.notificationRules ?? {}),
              createdByOpenId: 'system:migration',
              formSnapshots: {
                create: (['D', 'M'] as const).map((prefix) => ({
                  cycleId: cycle.id,
                  jobLevelPrefix: prefix,
                  sourceFormTemplateVersionId:
                    sourceBundle.formVersionIds[prefix],
                  content: inputJson(
                    buildLegacyFormSnapshot(
                      prefix,
                      legacyDimensions(cycle.dimensions),
                    ),
                  ),
                })),
              },
            },
          });
          return config.id;
        },
      );
      const snapshots = await this.prisma.perfCycleFormSnapshot.findMany({
        where: { cycleConfigVersionId: targetId },
      });
      const ids = Object.fromEntries(
        snapshots.map((snapshot) => [snapshot.jobLevelPrefix, snapshot.id]),
      ) as Partial<Record<'D' | 'M', number>>;
      if (!ids.D || !ids.M)
        throw new Error('迁移后的周期配置缺少 D/M 表单快照');
      return {
        configVersionId: targetId,
        formSnapshotIds: { D: ids.D, M: ids.M },
      };
    } catch (error) {
      issues.push(toIssue('CYCLE_CONFIGURATION', sourceKey, error));
      return null;
    }
  }

  private async ensureSourceBundle(
    tx: Prisma.TransactionClient,
    cycle: SourceCycle,
  ) {
    const stableSource = cycle.template
      ? `template:${cycle.template.id}`
      : `cycle:${cycle.id}`;
    const sourceDimensions = cycle.template?.dimensions ?? cycle.dimensions;
    const formVersionIds = {} as Record<'D' | 'M', number>;
    for (const prefix of ['D', 'M'] as const) {
      const systemKey = `LEGACY_FORM:${stableSource}:${prefix}`;
      let template = await tx.perfFormTemplate.findUnique({
        where: { systemKey },
        include: { versions: true },
      });
      if (!template) {
        template = await tx.perfFormTemplate.create({
          data: { systemKey, createdByOpenId: 'system:migration' },
          include: { versions: true },
        });
      }
      let version = template.versions.find((item) => item.version === 1);
      if (!version) {
        version = await tx.perfFormTemplateVersion.create({
          data: {
            templateId: template.id,
            version: 1,
            status: PerfFormTemplateVersionStatus.DRAFT,
            name: `${cycle.template?.name ?? cycle.name} ${prefix} 历史表单`,
            description: `Ticket 20 从 ${stableSource} 回填`,
            jobLevelPrefix: prefix,
            createdByOpenId: 'system:migration',
            updatedByOpenId: 'system:migration',
          },
        });
        const content = buildLegacyFormSnapshot(
          prefix,
          legacyDimensions(sourceDimensions),
        );
        for (const [subformIndex, subform] of content.subforms.entries()) {
          const createdSubform = await tx.perfFormSubform.create({
            data: {
              versionId: version.id,
              type: subform.type,
              title: subform.title ?? subform.type,
              description: subform.description,
              sortOrder: subformIndex,
            },
          });
          for (const [
            dimensionIndex,
            dimension,
          ] of subform.dimensions.entries()) {
            const createdDimension = await tx.perfFormDimension.create({
              data: {
                subformId: createdSubform.id,
                kind: (dimension.kind ?? 'REGULAR') as PerfFormDimensionKind,
                audience: dimension.audience,
                name: dimension.name ?? dimension.key,
                description: dimension.description,
                weight:
                  dimension.kind === 'REGULAR' && dimension.weight !== null
                    ? dimension.weight
                    : null,
                isCore: dimension.isCore ?? false,
                sortOrder: dimensionIndex,
              },
            });
            for (const [itemIndex, item] of dimension.items.entries()) {
              await tx.perfFormItem.create({
                data: {
                  dimensionId: createdDimension.id,
                  type: item.type as PerfFormItemType,
                  title: item.title,
                  description: item.description,
                  placeholder: item.placeholder,
                  required: item.required,
                  sortOrder: itemIndex,
                  config:
                    item.config === undefined
                      ? undefined
                      : inputJson(item.config),
                },
              });
            }
          }
        }
        version = await tx.perfFormTemplateVersion.update({
          where: { id: version.id },
          data: {
            status: PerfFormTemplateVersionStatus.PUBLISHED,
            publishedByOpenId: 'system:migration',
            publishedAt: new Date(),
          },
        });
      }
      formVersionIds[prefix] = version.id;
    }

    const configSystemKey = `LEGACY_CONFIG:${stableSource}`;
    let template = await tx.perfConfigTemplate.findUnique({
      where: { systemKey: configSystemKey },
      include: { versions: true },
    });
    if (!template) {
      template = await tx.perfConfigTemplate.create({
        data: {
          systemKey: configSystemKey,
          createdByOpenId: 'system:migration',
        },
        include: { versions: true },
      });
    }
    let version = template.versions.find((item) => item.version === 1);
    if (!version) {
      version = await tx.perfConfigTemplateVersion.create({
        data: {
          templateId: template.id,
          version: 1,
          status: PerfConfigTemplateVersionStatus.DRAFT,
          name: `${cycle.template?.name ?? cycle.name} 历史配置`,
          description: `Ticket 20 从 ${stableSource} 回填`,
          selfStageMode: PerfStageResultMode.DIRECT_RATING,
          peerStageMode: inferStageMode(sourceDimensions, 'REVIEWER'),
          managerStageMode: inferStageMode(sourceDimensions, 'LEADER'),
          aiStageMode: PerfStageResultMode.DIRECT_RATING,
          ratings: inputJson(
            normalizedRatings(
              cycle.template?.levels ?? cycle.evaluationRule?.levels ?? [],
            ),
          ),
          constraintProfiles: {
            WEIGHTED_RATING: [],
            WEIGHTED_SCORE: [],
          },
          orgOwnerWeight: '30',
          projectOwnerWeight: '30',
          peerWeight: '25',
          crossDeptWeight: '15',
          schedulePreset: inputJson({ legacyWindows: cycle.windows }),
          notificationRules: inputJson(cycle.notificationRules ?? {}),
          createdByOpenId: 'system:migration',
          updatedByOpenId: 'system:migration',
        },
      });
      for (const prefix of ['D', 'M'] as const) {
        await tx.perfConfigFormBinding.create({
          data: {
            configVersionId: version.id,
            formTemplateVersionId: formVersionIds[prefix],
            jobLevelPrefix: prefix,
          },
        });
      }
      version = await tx.perfConfigTemplateVersion.update({
        where: { id: version.id },
        data: {
          status: PerfConfigTemplateVersionStatus.PUBLISHED,
          publishedByOpenId: 'system:migration',
          publishedAt: new Date(),
        },
      });
    }
    return { configVersionId: version.id, formVersionIds };
  }

  private async migrateCycleSubmissions(
    runId: number,
    cycle: SourceCycle,
    artifacts: CycleArtifacts,
    issues: MigrationIssue[],
  ) {
    for (const participant of cycle.participants) {
      const prefix = participantPrefix(participant);
      if (!prefix) continue;
      const formSnapshotId = artifacts.formSnapshotIds[prefix];
      const snapshot = buildLegacyFormSnapshot(
        prefix,
        legacyDimensions(cycle.dimensions),
      );
      if (participant.selfReview) {
        await this.migrateSelfSubmission(
          runId,
          cycle,
          participant,
          formSnapshotId,
          issues,
        );
      }
      for (const review of participant.reviews) {
        const rebuilt = rebuildSubmissionItems(
          'PEER',
          review.status,
          review.dimensionScores,
          snapshot,
        );
        await this.migrateScoredSubmission({
          runId,
          cycle,
          participant,
          sourceType: 'PEER_SUBMISSION',
          sourceBusinessKey: `perf_reviews:${review.id}`,
          source: review,
          stage: PerfEvaluationTaskType.PEER,
          reviewerOpenId: review.reviewerOpenId,
          reviewerAssignmentId:
            participant.reviewerAssignments.find(
              (item) =>
                item.reviewerOpenId === review.reviewerOpenId &&
                item.status !== 'REPLACED',
            )?.id ?? null,
          formSnapshotId,
          rebuilt,
          ratings: normalizedRatings(
            cycle.evaluationRule?.levels ?? cycle.template?.levels ?? [],
          ),
          issues,
        });
      }
      if (participant.managerReview) {
        const review = participant.managerReview;
        const rebuilt = rebuildSubmissionItems(
          'MANAGER',
          review.status,
          review.dimensionScores,
          snapshot,
        );
        await this.migrateScoredSubmission({
          runId,
          cycle,
          participant,
          sourceType: 'MANAGER_SUBMISSION',
          sourceBusinessKey: `perf_manager_reviews:${review.id}`,
          source: review,
          stage: PerfEvaluationTaskType.MANAGER,
          reviewerOpenId: review.leaderOpenId,
          reviewerAssignmentId: null,
          formSnapshotId,
          rebuilt,
          ratings: normalizedRatings(
            cycle.evaluationRule?.levels ?? cycle.template?.levels ?? [],
          ),
          issues,
        });
      }
    }
  }

  private async migrateSelfSubmission(
    runId: number,
    cycle: SourceCycle,
    participant: SourceCycle['participants'][number],
    formSnapshotId: number,
    issues: MigrationIssue[],
  ) {
    const source = participant.selfReview;
    if (!source) return;
    const sourceBusinessKey = `perf_self_reviews:${source.id}`;
    const selfLevel = extractLegacySelfLevel(source.summary, source.okrContent);
    if (source.status === 'SUBMITTED' && !selfLevel) {
      const error = new Error(
        'MISSING_LEGACY_SELF_LEVEL: 已提交旧自评没有可验证的 S/A/B/C 自评等级',
      );
      await this.ledger.recordFailure(
        runId,
        'SELF_SUBMISSION',
        sourceBusinessKey,
        source,
        error,
      );
      issues.push(toIssue('SELF_SUBMISSION', sourceBusinessKey, error));
      return;
    }
    const items = [
      ...(selfLevel
        ? [
            {
              subformKey: 'legacy-subform:SELF',
              dimensionKey: 'legacy-self:fixed',
              itemKey: 'legacy-self:rating',
              itemType: PerfFormItemType.RATING,
              rawLevel: selfLevel,
            },
          ]
        : []),
      ...legacySelfValueItems(source),
    ];
    try {
      await this.ledger.migrateItem(
        runId,
        'SELF_SUBMISSION',
        sourceBusinessKey,
        source,
        'PerfEvaluationSubmission',
        async (tx) => {
          const existing = await tx.perfEvaluationSubmission.findFirst({
            where: {
              participantId: participant.id,
              stage: PerfEvaluationTaskType.SELF,
              reviewerOpenId: participant.employeeOpenId,
              status:
                source.status === 'SUBMITTED'
                  ? PerfReviewStatus.SUBMITTED
                  : PerfReviewStatus.DRAFT,
            },
          });
          if (existing) return existing.id;
          const created = await tx.perfEvaluationSubmission.create({
            data: {
              cycleId: cycle.id,
              participantId: participant.id,
              stage: PerfEvaluationTaskType.SELF,
              reviewerOpenId: participant.employeeOpenId,
              formSnapshotId,
              status:
                source.status === 'SUBMITTED'
                  ? PerfReviewStatus.SUBMITTED
                  : PerfReviewStatus.DRAFT,
              submittedAt: source.submittedAt,
              submittedByOpenId:
                source.status === 'SUBMITTED'
                  ? participant.employeeOpenId
                  : null,
              items: {
                create: items.map((item) => ({
                  ...item,
                  formSnapshotId,
                  value:
                    'value' in item && item.value !== undefined
                      ? inputJson(item.value)
                      : undefined,
                })),
              },
            },
          });
          return created.id;
        },
      );
    } catch (error) {
      issues.push(toIssue('SELF_SUBMISSION', sourceBusinessKey, error));
    }
  }

  private async migrateScoredSubmission(input: {
    runId: number;
    cycle: SourceCycle;
    participant: SourceCycle['participants'][number];
    sourceType: string;
    sourceBusinessKey: string;
    source:
      | SourceCycle['participants'][number]['reviews'][number]
      | NonNullable<SourceCycle['participants'][number]['managerReview']>;
    stage: 'PEER' | 'MANAGER';
    reviewerOpenId: string;
    reviewerAssignmentId: number | null;
    formSnapshotId: number;
    rebuilt: ReturnType<typeof rebuildLegacyDimensionItems>;
    ratings: ReturnType<typeof normalizedRatings>;
    issues: MigrationIssue[];
  }) {
    if (input.rebuilt.issues.length > 0) {
      const error = new Error(
        `INVALID_DIMENSION_JSON: ${JSON.stringify(input.rebuilt.issues)}`,
      );
      await this.ledger.recordFailure(
        input.runId,
        input.sourceType,
        input.sourceBusinessKey,
        input.source,
        error,
      );
      input.issues.push(
        toIssue(
          input.sourceType,
          input.sourceBusinessKey,
          error,
          input.rebuilt.issues,
        ),
      );
      return;
    }
    if (input.stage === 'PEER' && !input.reviewerAssignmentId) {
      const error = new Error('MISSING_REVIEWER_ASSIGNMENT_BUSINESS_KEY');
      await this.ledger.recordFailure(
        input.runId,
        input.sourceType,
        input.sourceBusinessKey,
        input.source,
        error,
      );
      input.issues.push(
        toIssue(input.sourceType, input.sourceBusinessKey, error),
      );
      return;
    }
    try {
      await this.ledger.migrateItem(
        input.runId,
        input.sourceType,
        input.sourceBusinessKey,
        input.source,
        'PerfEvaluationSubmission',
        async (tx) => {
          const status =
            input.source.status === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT';
          const existing = await tx.perfEvaluationSubmission.findFirst({
            where: {
              participantId: input.participant.id,
              stage: input.stage,
              reviewerOpenId: input.reviewerOpenId,
              status,
            },
          });
          if (existing) return existing.id;
          const created = await tx.perfEvaluationSubmission.create({
            data: {
              cycleId: input.cycle.id,
              participantId: input.participant.id,
              stage: input.stage,
              reviewerOpenId: input.reviewerOpenId,
              reviewerAssignmentId: input.reviewerAssignmentId,
              formSnapshotId: input.formSnapshotId,
              status,
              submittedAt: input.source.submittedAt,
              submittedByOpenId:
                status === 'SUBMITTED' ? input.reviewerOpenId : null,
              items: {
                create: input.rebuilt.items.map((item) => ({
                  formSnapshotId: input.formSnapshotId,
                  subformKey: item.subformKey,
                  dimensionKey: item.dimensionKey,
                  itemKey: item.itemKey,
                  itemType: item.itemType as PerfFormItemType,
                  rawLevel: item.rawLevel,
                  rawScore: item.rawScore,
                  calculationScore:
                    item.calculationScore ??
                    (item.rawLevel
                      ? mappingScore(input.ratings, item.rawLevel)
                      : null),
                  value:
                    item.value === undefined
                      ? undefined
                      : inputJson(item.value),
                })),
              },
            },
          });
          return created.id;
        },
      );
    } catch (error) {
      input.issues.push(
        toIssue(input.sourceType, input.sourceBusinessKey, error),
      );
    }
  }

  private async migrateLegacyResults(
    runId: number,
    cycle: SourceCycle,
    issues: MigrationIssue[],
  ) {
    for (const participant of cycle.participants) {
      const result = participant.result;
      if (!result) continue;
      const sourceBusinessKey = `perf_results:${result.id}`;
      if (!isRating(result.finalLevel)) {
        const error = new Error(`INVALID_RESULT_LEVEL: ${result.finalLevel}`);
        await this.ledger.recordFailure(
          runId,
          'RESULT_VERSION',
          sourceBusinessKey,
          result,
          error,
        );
        issues.push(toIssue('RESULT_VERSION', sourceBusinessKey, error));
        continue;
      }
      try {
        await this.ledger.migrateItem(
          runId,
          'RESULT_VERSION',
          sourceBusinessKey,
          result,
          'PerfResultVersion',
          async (tx) => {
            const existing = await tx.perfResultVersion.findFirst({
              where: { participantId: participant.id },
              orderBy: { version: 'desc' },
            });
            if (existing) return existing.id;
            const calibration = participant.calibrations
              .filter((item) => !item.invalidatedAt)
              .sort((left, right) => right.id - left.id)[0];
            const created = await tx.perfResultVersion.create({
              data: {
                participantId: participant.id,
                version: 1,
                finalLevel: result.finalLevel as PerfRatingSymbol,
                employeeExplanation: '历史结果迁移',
                sourceCalibrationId: calibration?.id,
                resultSnapshot: inputJson({
                  cycle: { id: cycle.id, name: cycle.name },
                  manager: {
                    compositeScore: null,
                    level: result.finalLevel,
                    dimensions: result.dimensionResults ?? [],
                    comments: [],
                  },
                  self: { level: null, items: [] },
                  promotion: result.promotionResult ?? null,
                }),
                publishedByOpenId: 'system:migration',
                publishedAt: result.createdAt,
                confirmedAt: result.confirmedAt,
                confirmedByOpenId: result.confirmedAt
                  ? participant.employeeOpenId
                  : null,
              },
            });
            return created.id;
          },
        );
      } catch (error) {
        issues.push(toIssue('RESULT_VERSION', sourceBusinessKey, error));
      }
    }
  }

  private async rebuildStageResults(
    runId: number,
    cycle: SourceCycle,
    artifacts: CycleArtifacts,
    shadows: ShadowRow[],
    issues: MigrationIssue[],
    accepted: ReadonlySet<string>,
  ) {
    for (const participant of cycle.participants) {
      for (const stage of [
        PerfEvaluationTaskType.PEER,
        PerfEvaluationTaskType.MANAGER,
      ] as const) {
        const sourceBusinessKey = `participant:${participant.id}/stage:${stage}`;
        const sourcePayload =
          stage === PerfEvaluationTaskType.PEER
            ? participant.reviews
            : participant.managerReview;
        if (!sourcePayload) continue;
        try {
          await this.ledger.migrateItem(
            runId,
            `${stage}_STAGE_RESULT`,
            sourceBusinessKey,
            sourcePayload,
            'PerfStageResult',
            (tx) =>
              this.stageRebuilder.rebuild(tx, {
                cycleId: cycle.id,
                participantId: participant.id,
                artifacts,
                prefix: requireParticipantPrefix(participant),
                stage,
              }),
          );
        } catch (error) {
          issues.push(
            toIssue(`${stage}_STAGE_RESULT`, sourceBusinessKey, error),
          );
        }
      }
      const manager = participant.managerReview;
      if (!manager || manager.status !== 'SUBMITTED') continue;
      const businessKey = participantBusinessKey(
        cycle.id,
        participant.employeeOpenId,
      );
      const result = await this.prisma.perfStageResult.findUnique({
        where: {
          participantId_stage_cycleConfigVersionId: {
            participantId: participant.id,
            stage: PerfEvaluationTaskType.MANAGER,
            cycleConfigVersionId: artifacts.configVersionId,
          },
        },
      });
      const row: ShadowRow = {
        businessKey,
        participantId: participant.id,
        employeeOpenId: participant.employeeOpenId,
        legacyLevel: manager.initialLevel,
        computedLevel: result?.stageLevel ?? null,
        different: result?.stageLevel !== manager.initialLevel,
        reason: result
          ? result.stageLevel === manager.initialLevel
            ? '新旧等级一致'
            : `新阶段结果 ${result.stageLevel ?? 'NO_DATA'} 与人工旧等级不同`
          : 'MISSING_REBUILT_MANAGER_STAGE_RESULT',
        disposition: accepted.has(businessKey) ? 'ACCEPTED' : 'UNRESOLVED',
      };
      shadows.push(row);
      if (!result) {
        const error = new Error('MISSING_REBUILT_MANAGER_STAGE_RESULT');
        await this.ledger.recordFailure(
          runId,
          'MANAGER_STAGE_RESULT',
          `participant:${participant.id}`,
          {
            participantId: participant.id,
            configVersionId: artifacts.configVersionId,
          },
          error,
        );
        issues.push(toIssue('MANAGER_STAGE_RESULT', businessKey, error));
      }
    }
  }
}

function legacyDimensions(
  dimensions: readonly (
    | SourceCycle['dimensions'][number]
    | NonNullable<SourceCycle['template']>['dimensions'][number]
  )[],
): LegacyDimension[] {
  return dimensions.map((dimension) => ({
    id: dimension.id,
    name: dimension.name,
    type: dimension.type,
    scoringMethod: dimension.scoringMethod,
    weight: dimension.weight?.toString() ?? null,
    required: dimension.required,
    sortOrder: dimension.sortOrder,
    editableRoles: dimension.editableRoles,
    formSchema: dimension.formSchema,
    applicableScope: dimension.applicableScope,
  }));
}

function participantPrefix(
  participant: SourceCycle['participants'][number],
): 'D' | 'M' | null {
  if (
    participant.jobLevelPrefixSnapshot === 'D' ||
    participant.jobLevelPrefixSnapshot === 'M'
  ) {
    return participant.jobLevelPrefixSnapshot;
  }
  const snapshot = participant.jobLevelSnapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot))
    return null;
  const source = snapshot as Record<string, unknown>;
  const candidates = [
    source.jobCategory,
    source.code,
    source.name,
    source.levelCode,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const match = /^\s*([DM])(?:\b|\d)/i.exec(candidate);
    if (match) return match[1].toUpperCase() as 'D' | 'M';
  }
  return null;
}

function requireParticipantPrefix(
  participant: SourceCycle['participants'][number],
): 'D' | 'M' {
  const prefix = participantPrefix(participant);
  if (!prefix) throw new Error('MISSING_JOB_LEVEL_PREFIX');
  return prefix;
}

function participantBusinessKey(cycleId: number, employeeOpenId: string) {
  return `cycle:${cycleId}/employee:${employeeOpenId}`;
}

function legacyDimensionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const dimensionId = (entry as Record<string, unknown>).dimensionId;
    return typeof dimensionId === 'string' || typeof dimensionId === 'number'
      ? [String(dimensionId)]
      : [];
  });
}

export function rebuildSubmissionItems(
  stage: 'PEER' | 'MANAGER',
  status: string,
  dimensionScores: unknown,
  snapshot: ReturnType<typeof buildLegacyFormSnapshot>,
) {
  const rebuilt = rebuildLegacyDimensionItems({
    stage,
    dimensionScores,
    snapshot,
  });
  // 草稿允许暂存不完整结构；只有生效提交进入严格重建与 readiness 校验。
  return status === 'DRAFT' && rebuilt.issues.length > 0
    ? { items: [], issues: [] }
    : rebuilt;
}

function normalizedRatings(value: unknown) {
  const defaults: Record<string, number> = { S: 95, A: 85, B: 70, C: 50 };
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === 'object',
    )
    .filter((item) => isRating(item.symbol))
    .map((item) => ({
      ...item,
      symbol: item.symbol as PerfRatingSymbol,
      minScore: scalarString(item.minScore, '0'),
      maxScore: scalarString(item.maxScore, '100'),
      mappingScore: scalarString(
        item.mappingScore,
        String(defaults[item.symbol as string]),
      ),
    }));
}

function scalarString(value: unknown, fallback: string) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : fallback;
}

function inferStageMode(
  dimensions: readonly {
    scoringMethod: string;
    editableRoles: readonly string[];
  }[],
  role: 'REVIEWER' | 'LEADER',
) {
  const methods = dimensions
    .filter((item) => item.editableRoles.includes(role))
    .map((item) => item.scoringMethod);
  return methods.length > 0 && methods.every((item) => item === 'LEVEL')
    ? PerfStageResultMode.WEIGHTED_RATING
    : PerfStageResultMode.WEIGHTED_SCORE;
}

function extractLegacySelfLevel(...values: unknown[]): PerfRatingSymbol | null {
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const source = value as Record<string, unknown>;
    for (const key of ['selfLevel', 'selfRating', 'level', 'rating']) {
      if (isRating(source[key])) return source[key];
    }
  }
  return null;
}

function legacySelfValueItems(
  source: NonNullable<SourceCycle['participants'][number]['selfReview']>,
) {
  const candidates: Array<[string, string, unknown]> = [
    ['legacy-self:okr', 'LONG_TEXT', source.okrContent],
    ['legacy-self:summary', 'MARKDOWN', source.summary],
    ['legacy-self:promotion', 'LONG_TEXT', source.promotionSelfReview],
    ['legacy-self:attachments', 'ATTACHMENT', source.attachments],
    ['legacy-self:document', 'LINK', source.documentToken],
  ];
  return candidates
    .filter(([, , value]) => value !== null && value !== undefined)
    .map(([itemKey, itemType, value]) => ({
      subformKey: 'legacy-subform:SELF',
      dimensionKey: 'legacy-self:fixed',
      itemKey,
      itemType: itemType as PerfFormItemType,
      value,
    }));
}

function mappingScore(
  ratings: ReturnType<typeof normalizedRatings>,
  symbol: PerfRatingSymbol,
) {
  return (
    ratings.find((rating) => rating.symbol === symbol)?.mappingScore ?? null
  );
}

function isRating(value: unknown): value is PerfRatingSymbol {
  return value === 'S' || value === 'A' || value === 'B' || value === 'C';
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function completedRunResponse(run: {
  id: number;
  runKey: string;
  dryRun: boolean;
  validationReport: unknown;
  shadowReport: unknown;
  readinessReport: unknown;
}) {
  const shadow = run.shadowReport as { rows?: ShadowRow[] } | null;
  return {
    runId: run.id,
    runKey: run.runKey,
    dryRun: run.dryRun,
    validationReport: run.validationReport,
    shadowReport: shadow?.rows ?? [],
    readiness: run.readinessReport as ReadinessReport,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function toIssue(
  sourceType: string,
  sourceBusinessKey: string,
  error: unknown,
  details?: unknown,
): MigrationIssue {
  const message = error instanceof Error ? error.message : String(error);
  return {
    sourceType,
    sourceBusinessKey,
    code: message.split(':')[0],
    message,
    ...(details === undefined ? {} : { details }),
  };
}
