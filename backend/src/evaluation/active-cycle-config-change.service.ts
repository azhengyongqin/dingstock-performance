import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import {
  PerfCycleStatus,
  PerfFormItemType,
  PerfReviewStatus,
} from '../generated/prisma/enums';
import type { ConfigTemplateVersionContract } from '../config-template/config-template.contract';
import { validateConfigTemplatePublication } from '../config-template/publication-validator';
import { toCycleConfigSnapshotData } from '../cycle/cycle-config-snapshot-data';
import { RbacService } from '../rbac/rbac.service';
import { PrismaService } from '../shared/database/prisma.service';
import {
  applyDimensionOverrides,
  buildActiveConfigImpact,
  cycleImpactInclude,
  type ActiveConfigImpactPreview,
  type ActiveConfigInput,
  type ImpactCycle,
  type ImpactStage,
} from './active-cycle-config-impact';
import type { FormSnapshotContent } from './evaluation.service-types';
import { ManagerStageResultService } from './manager-stage-result.service';
import { PeerStageResultService } from './peer-stage-result.service';

export type ApplyActiveConfigInput = ActiveConfigInput & {
  reason: string;
  confirmed: boolean;
  impactRevision: string;
};
export type { ActiveConfigImpactPreview } from './active-cycle-config-impact';

/**
 * ACTIVE 周期配置变更编排：影响计算是纯模块，当前服务只负责权限、锁、版本写入与重算事务。
 */
@Injectable()
export class ActiveCycleConfigChangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbacService: RbacService,
    private readonly peerStageResultService: PeerStageResultService,
    private readonly managerStageResultService: ManagerStageResultService,
  ) {}

  async preview(
    operatorOpenId: string,
    cycleId: number,
    input: ActiveConfigInput,
  ): Promise<ActiveConfigImpactPreview> {
    const cycle = await this.loadCycle(this.prisma, cycleId);
    await this.assertAuthorized(operatorOpenId, cycle);
    this.assertExpectedVersion(cycle, input.expectedConfigVersionId);
    this.assertNonStructuralConfigValid(cycle, input);
    return buildActiveConfigImpact(cycle, input);
  }

  async apply(
    operatorOpenId: string,
    cycleId: number,
    input: ApplyActiveConfigInput,
  ) {
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException('修改活动周期配置必须填写原因');
    if (reason.length > 500) {
      throw new BadRequestException('修改原因不能超过 500 个字符');
    }
    if (input.confirmed !== true) {
      throw new BadRequestException('必须确认影响范围后才能修改活动周期配置');
    }

    return this.prisma.$transaction(
      async (tx) => {
        // 周期与参与人聚合锁保证预览复核、版本切换和全部阶段重算原子完成。
        await tx.$queryRaw`SELECT "id" FROM "performance"."perf_cycles" WHERE "id" = ${cycleId} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "performance"."perf_participants" WHERE "cycle_id" = ${cycleId} ORDER BY "id" FOR UPDATE`;
        const cycle = await this.loadCycle(tx, cycleId);
        await this.assertAuthorized(operatorOpenId, cycle);
        this.assertExpectedVersion(cycle, input.expectedConfigVersionId);
        this.assertNonStructuralConfigValid(cycle, input);
        const impact = buildActiveConfigImpact(cycle, input);
        if (input.impactRevision !== impact.impactRevision) {
          throw new ConflictException({
            code: 'ACTIVE_CONFIG_IMPACT_STALE',
            message: '预览后评估或人工结果已变化，请刷新影响预览后重试',
            currentImpactRevision: impact.impactRevision,
          });
        }

        const current = cycle.currentConfigVersion!;
        if (!current.sourceConfigTemplateVersionId) {
          throw new ConflictException(
            '旧周期缺少配置来源版本，不能在线重算，请先退回草稿初始化',
          );
        }
        const next = await tx.perfCycleConfigVersion.create({
          data: {
            cycleId,
            version: current.version + 1,
            sourceConfigTemplateVersionId:
              current.sourceConfigTemplateVersionId,
            ...toCycleConfigSnapshotData({
              selfStageMode: input.stageModes.SELF,
              peerStageMode: input.stageModes.PEER,
              managerStageMode: input.stageModes.MANAGER,
              aiStageMode: input.stageModes.AI,
              ratings: input.ratings,
              constraintProfiles: input.constraintProfiles,
              orgOwnerWeight: input.reviewerRelationWeights.ORG_OWNER,
              projectOwnerWeight: input.reviewerRelationWeights.PROJECT_OWNER,
              peerWeight: input.reviewerRelationWeights.PEER,
              crossDeptWeight: input.reviewerRelationWeights.CROSS_DEPT,
              schedulePreset: current.schedulePreset,
              notificationRules: current.notificationRules,
            }),
            createdByOpenId: operatorOpenId,
            formSnapshots: {
              create: current.formSnapshots.map((snapshot) => ({
                jobLevelPrefix: snapshot.jobLevelPrefix,
                sourceFormTemplateVersionId:
                  snapshot.sourceFormTemplateVersionId,
                content: this.inputJson(
                  applyDimensionOverrides(
                    snapshot.content as unknown as FormSnapshotContent,
                    snapshot.jobLevelPrefix,
                    input.dimensionOverrides,
                  ),
                ),
              })),
            },
          },
          include: { formSnapshots: true },
        });

        await this.rebindSnapshotsAndCalculationScores(tx, cycle, next, input);
        await tx.perfCycle.update({
          where: { id: cycleId },
          data: { currentConfigVersionId: next.id },
        });
        await this.recalculateStages(tx, impact);

        // 审计与配置切换同事务，避免业务成功但原因或影响范围丢失。
        await tx.auditLog.create({
          data: {
            operatorOpenId,
            action: 'cycle.active_config.recalculate',
            targetType: 'perf_cycle',
            targetId: String(cycleId),
            before: this.inputJson({
              configVersionId: current.id,
              version: current.version,
              impactRevision: input.impactRevision,
            }),
            after: this.inputJson({
              configVersionId: next.id,
              version: next.version,
              impact: impact.summary,
            }),
            reason,
          },
        });
        return {
          cycleId,
          configVersionId: next.id,
          version: next.version,
          impact: impact.summary,
        };
      },
      { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 120_000 },
    );
  }

  private async rebindSnapshotsAndCalculationScores(
    tx: Prisma.TransactionClient,
    cycle: ImpactCycle,
    next: {
      id: number;
      formSnapshots: Array<{ id: number; jobLevelPrefix: string }>;
    },
    input: ActiveConfigInput,
  ) {
    const nextFormByPrefix = new Map(
      next.formSnapshots.map((snapshot) => [
        snapshot.jobLevelPrefix,
        snapshot.id,
      ]),
    );
    const participantIds: number[] = [];
    for (const participant of cycle.participants) {
      if (!participant.jobLevelPrefixSnapshot) continue;
      const nextFormSnapshotId = nextFormByPrefix.get(
        participant.jobLevelPrefixSnapshot,
      );
      if (!nextFormSnapshotId) {
        throw new ConflictException(
          `参与者 #${participant.id} 的职级前缀缺少新版本表单快照`,
        );
      }
      await tx.perfParticipant.update({
        where: { id: participant.id },
        data: { formSnapshotId: nextFormSnapshotId },
      });
      await tx.perfEvaluationSubmission.updateMany({
        where: {
          participantId: participant.id,
          status: {
            in: [PerfReviewStatus.DRAFT, PerfReviewStatus.SUBMITTED],
          },
        },
        data: { formSnapshotId: nextFormSnapshotId },
      });
      participantIds.push(participant.id);
    }
    // 原始评级不变；映射分属于新配置口径，必须在阶段重算前同步重放。
    for (const rating of input.ratings) {
      await tx.perfEvaluationItemResult.updateMany({
        where: {
          submission: { participantId: { in: participantIds } },
          itemType: PerfFormItemType.RATING,
          rawLevel: rating.symbol,
        },
        data: { calculationScore: rating.mappingScore },
      });
    }
  }

  private async recalculateStages(
    tx: Prisma.TransactionClient,
    impact: ActiveConfigImpactPreview,
  ) {
    const targets = new Set(
      impact.stageChanges.map((item) => `${item.participantId}:${item.stage}`),
    );
    for (const target of targets) {
      const [participantIdText, stage] = target.split(':') as [
        string,
        ImpactStage,
      ];
      const participantId = Number(participantIdText);
      if (stage === 'PEER') {
        await this.peerStageResultService.recalculate(participantId, tx);
      } else {
        await this.managerStageResultService.recalculate(participantId, tx);
      }
    }
  }

  private async loadCycle(
    db:
      | Pick<PrismaService, 'perfCycle'>
      | Pick<Prisma.TransactionClient, 'perfCycle'>,
    cycleId: number,
  ): Promise<ImpactCycle> {
    const cycle = await db.perfCycle.findFirst({
      where: { id: cycleId, deletedAt: null },
      include: cycleImpactInclude,
    });
    if (!cycle) throw new NotFoundException('绩效周期不存在');
    if (cycle.status !== PerfCycleStatus.ACTIVE) {
      throw new ConflictException('只有进行中的周期可以在线修改计算配置');
    }
    if (!cycle.currentConfigVersionId || !cycle.currentConfigVersion) {
      throw new ConflictException('周期缺少当前配置版本，不能在线重算');
    }
    return cycle;
  }

  private async assertAuthorized(operatorOpenId: string, cycle: ImpactCycle) {
    if (await this.rbacService.isAdmin(operatorOpenId)) return;
    const scope = await this.rbacService.getOrgScope(operatorOpenId);
    if (scope === null) return;
    const outOfScope = cycle.participants.some(
      (participant) =>
        !participant.departmentIdSnapshot ||
        !scope.includes(participant.departmentIdSnapshot),
    );
    if (outOfScope) {
      throw new ForbiddenException('你的 HR 授权范围未覆盖本周期全部参与者');
    }
  }

  private assertExpectedVersion(cycle: ImpactCycle, expectedId: number) {
    if (!Number.isInteger(expectedId) || expectedId <= 0) {
      throw new BadRequestException('expectedConfigVersionId 必须是正整数');
    }
    if (cycle.currentConfigVersionId !== expectedId) {
      throw new ConflictException({
        code: 'CYCLE_CONFIG_VERSION_STALE',
        message: '周期配置已被其他人修改，请刷新影响预览后重试',
        currentConfigVersionId: cycle.currentConfigVersionId,
      });
    }
  }

  private assertNonStructuralConfigValid(
    cycle: ImpactCycle,
    input: ActiveConfigInput,
  ) {
    const seenDimensionKeys = new Set<string>();
    for (const override of input.dimensionOverrides) {
      const identity = `${override.jobLevelPrefix}:${override.dimensionKey}`;
      if (seenDimensionKeys.has(identity)) {
        throw new BadRequestException(`维度配置 ${identity} 重复`);
      }
      seenDimensionKeys.add(identity);
      const snapshot = cycle.currentConfigVersion!.formSnapshots.find(
        (item) => item.jobLevelPrefix === override.jobLevelPrefix,
      );
      const content = snapshot?.content as unknown as
        FormSnapshotContent | undefined;
      const matches =
        content?.subforms
          .flatMap((subform) => subform.dimensions)
          .filter((dimension) => dimension.key === override.dimensionKey)
          .length ?? 0;
      if (matches !== 1) {
        throw new BadRequestException(
          `维度配置 ${identity} 未唯一命中当前表单快照`,
        );
      }
    }
    const contract = this.toValidationContract(
      cycle.currentConfigVersion!,
      input,
    );
    const relevantPrefixes = [
      'stageModes',
      'ratings',
      'constraintProfiles',
      'reviewerRelationWeights',
    ];
    const dimensionIssueCodes = new Set([
      'CORE_DIMENSION_COUNT_INVALID',
      'DIMENSION_WEIGHT_INVALID',
      'DIMENSION_WEIGHT_TOTAL_INVALID',
    ]);
    const issues = validateConfigTemplatePublication(contract).filter(
      (item) =>
        dimensionIssueCodes.has(item.code) ||
        relevantPrefixes.some(
          (prefix) =>
            item.path === prefix ||
            item.path.startsWith(`${prefix}.`) ||
            item.path.startsWith(`${prefix}[`),
        ),
    );
    if (issues.length > 0) {
      throw new BadRequestException({
        code: 'ACTIVE_CYCLE_CONFIG_INVALID',
        message: '活动周期计算配置校验失败',
        issues,
      });
    }
  }

  private toValidationContract(
    current: NonNullable<ImpactCycle['currentConfigVersion']>,
    input: ActiveConfigInput,
  ): ConfigTemplateVersionContract {
    return {
      name: '周期配置',
      stageModes: input.stageModes,
      ratings: input.ratings,
      constraintProfiles: input.constraintProfiles,
      reviewerRelationWeights: input.reviewerRelationWeights,
      formBindings: current.formSnapshots.map((snapshot) => {
        const content = applyDimensionOverrides(
          snapshot.content as unknown as FormSnapshotContent,
          snapshot.jobLevelPrefix,
          input.dimensionOverrides,
        );
        return {
          formTemplateVersionId: snapshot.sourceFormTemplateVersionId,
          status: 'PUBLISHED' as const,
          jobLevelPrefix: snapshot.jobLevelPrefix,
          subforms: content.subforms as never,
        };
      }),
      schedulePreset: current.schedulePreset as never,
      notificationRules: current.notificationRules as never,
    };
  }

  private inputJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
