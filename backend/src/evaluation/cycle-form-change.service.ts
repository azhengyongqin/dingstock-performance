import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client';
import {
  PerfAssignmentStatus,
  PerfCycleStatus,
  PerfEvaluationTaskType,
  PerfReviewStatus,
} from '../generated/prisma/enums';
import type { FormTemplateVersionContract } from '../form-template/form-template.contract';
import { validateFormTemplatePublication } from '../form-template/publication-validator';
import { RbacService } from '../rbac/rbac.service';
import { PrismaService } from '../shared/database/prisma.service';
import {
  buildCycleFormChangePlan,
  classifyCycleFormChange,
  type CycleFormChangeCategory,
  type HumanEvaluationStage,
} from './cycle-form-change';
import type { FormSnapshotContent } from './evaluation.service-types';
import { ManagerStageResultService } from './manager-stage-result.service';
import { PeerStageResultService } from './peer-stage-result.service';

export type CycleFormSnapshotChangeInput = {
  expectedConfigVersionId: number;
  formSnapshots: Array<{
    jobLevelPrefix: 'D' | 'M';
    content: FormSnapshotContent & {
      schemaVersion: 1;
      name: string;
      description?: string | null;
      jobLevelPrefix: 'D' | 'M';
    };
  }>;
};

export type ApplyCycleFormChangeInput = CycleFormSnapshotChangeInput & {
  reason: string;
  confirmed: boolean;
  impactRevision: string;
};

const cycleFormChangeInclude = {
  currentConfigVersion: {
    include: {
      formSnapshots: { orderBy: { jobLevelPrefix: 'asc' as const } },
    },
  },
  participants: {
    orderBy: { id: 'asc' as const },
    select: {
      id: true,
      employeeOpenId: true,
      departmentIdSnapshot: true,
      jobLevelPrefixSnapshot: true,
      formSnapshotId: true,
      evaluationSubmissions: {
        where: {
          status: {
            in: [PerfReviewStatus.DRAFT, PerfReviewStatus.SUBMITTED],
          },
        },
        orderBy: { id: 'asc' as const },
        include: { items: { orderBy: { id: 'asc' as const } } },
      },
    },
  },
} satisfies Prisma.PerfCycleInclude;

type FormChangeCycle = Prisma.PerfCycleGetPayload<{
  include: typeof cycleFormChangeInclude;
}>;

type Submission =
  FormChangeCycle['participants'][number]['evaluationSubmissions'][number];

type SnapshotInput = CycleFormSnapshotChangeInput['formSnapshots'][number];
type CreatedConfigVersion = Prisma.PerfCycleConfigVersionGetPayload<{
  include: { formSnapshots: true };
}>;

/**
 * Ticket 18 表单变更编排边界：预览和应用共享同一分类与影响计划；结构变更
 * 在串行事务内创建新快照、迁移兼容答案并撤销受影响答卷的生效状态。
 */
@Injectable()
export class CycleFormChangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbacService: RbacService,
    private readonly peerStageResultService: PeerStageResultService,
    private readonly managerStageResultService: ManagerStageResultService,
  ) {}

  async preview(
    operatorOpenId: string,
    cycleId: number,
    input: CycleFormSnapshotChangeInput,
  ) {
    const cycle = await this.loadCycle(this.prisma, cycleId);
    await this.assertAuthorized(operatorOpenId, cycle);
    this.assertExpectedVersion(cycle, input.expectedConfigVersionId);
    this.assertSnapshotInputs(cycle, input.formSnapshots);
    return this.buildImpact(cycle, input.formSnapshots);
  }

  async apply(
    operatorOpenId: string,
    cycleId: number,
    input: ApplyCycleFormChangeInput,
  ) {
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException('修改周期表单必须填写原因');
    if (reason.length > 500) {
      throw new BadRequestException('修改原因不能超过 500 个字符');
    }
    if (input.confirmed !== true) {
      throw new BadRequestException('必须确认影响范围后才能修改周期表单');
    }

    return this.prisma.$transaction(
      async (tx) => {
        // 锁顺序与周期整体退回一致，避免退回和表单修改交错后绕过 DRAFT 门槛。
        await tx.$queryRaw`SELECT "id" FROM "performance"."perf_cycles" WHERE "id" = ${cycleId} AND "deleted_at" IS NULL FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "performance"."perf_participants" WHERE "cycle_id" = ${cycleId} ORDER BY "id" FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "performance"."perf_evaluation_submissions" WHERE "cycle_id" = ${cycleId} ORDER BY "id" FOR UPDATE`;
        const cycle = await this.loadCycle(tx, cycleId);
        await this.assertAuthorized(operatorOpenId, cycle);
        this.assertExpectedVersion(cycle, input.expectedConfigVersionId);
        this.assertSnapshotInputs(cycle, input.formSnapshots);
        const impact = this.buildImpact(cycle, input.formSnapshots);
        if (impact.impactRevision !== input.impactRevision) {
          throw new ConflictException({
            code: 'CYCLE_FORM_IMPACT_STALE',
            message: '预览后表单或答卷已变化，请刷新影响预览后重试',
            currentImpactRevision: impact.impactRevision,
          });
        }
        if (impact.category === 'NONE') {
          throw new BadRequestException('未检测到需要应用的表单变更');
        }
        if (impact.category === 'CALCULATION') {
          throw new BadRequestException({
            code: 'CYCLE_FORM_CALCULATION_CHANGE_REQUIRES_CONFIG_FLOW',
            message: '非结构性计算变更必须使用周期配置版本与重算流程',
          });
        }
        if (!impact.canApply) {
          throw new ConflictException({
            code: 'CYCLE_FORM_STRUCTURAL_CHANGE_REQUIRES_DRAFT',
            message: impact.blockedReason,
          });
        }

        if (impact.category === 'COPY_ONLY') {
          await this.applyCopyOnly(tx, cycle, input.formSnapshots);
          await this.writeAudit(tx, operatorOpenId, cycle, impact, reason);
          return {
            cycleId,
            category: impact.category,
            configVersionId: cycle.currentConfigVersionId,
            version: cycle.currentConfigVersion!.version,
            impact: impact.summary,
          };
        }

        const next = await this.createStructuralVersion(
          tx,
          cycle,
          input.formSnapshots,
          operatorOpenId,
        );
        await this.migrateSubmissions(
          tx,
          cycle,
          next.formSnapshots,
          impact,
          input.formSnapshots,
        );
        await tx.perfCycle.update({
          where: { id: cycleId },
          data: { currentConfigVersionId: next.id },
        });
        await this.recalculateUnaffectedStages(tx, cycle, impact);
        await this.writeAudit(tx, operatorOpenId, cycle, impact, reason, next);
        return {
          cycleId,
          category: impact.category,
          configVersionId: next.id,
          version: next.version,
          impact: impact.summary,
        };
      },
      { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 120_000 },
    );
  }

  private buildImpact(
    cycle: FormChangeCycle,
    inputs: CycleFormSnapshotChangeInput['formSnapshots'],
  ) {
    const currentByPrefix = new Map(
      cycle.currentConfigVersion!.formSnapshots.map((snapshot) => [
        snapshot.jobLevelPrefix,
        snapshot,
      ]),
    );
    const inputByPrefix = new Map(
      inputs.map((snapshot) => [snapshot.jobLevelPrefix, snapshot]),
    );
    const classifications = inputs.map((input) => ({
      jobLevelPrefix: input.jobLevelPrefix,
      ...classifyCycleFormChange(
        currentByPrefix.get(input.jobLevelPrefix)!
          .content as unknown as FormSnapshotContent,
        input.content,
      ),
    }));
    const category = strongestCategory(
      classifications.map((item) => item.category),
    );
    const affectedStageByPrefix = new Map(
      classifications.map((item) => [
        item.jobLevelPrefix,
        new Set(item.affectedStages),
      ]),
    );
    const affectedEffective: Submission[] = [];
    const affectedDrafts: Submission[] = [];
    const unaffectedEffective: Submission[] = [];
    const compatibleAnswers = new Set<string>();
    const incompatibleAnswers = new Set<string>();
    const affectedParticipants = new Set<number>();
    const affectedEvaluators = new Set<string>();

    for (const participant of cycle.participants) {
      const prefix = participant.jobLevelPrefixSnapshot;
      if (!prefix) continue;
      const affectedStages = affectedStageByPrefix.get(prefix) ?? new Set();
      const nextContent = inputByPrefix.get(prefix)!.content;
      for (const submission of participant.evaluationSubmissions) {
        const classification = classifications.find(
          (item) => item.jobLevelPrefix === prefix,
        )!;
        const affected =
          classification.category === 'STRUCTURAL' &&
          affectedStages.has(submission.stage as HumanEvaluationStage);
        if (!affected) {
          if (submission.status === PerfReviewStatus.SUBMITTED) {
            unaffectedEffective.push(submission);
          }
          continue;
        }
        affectedParticipants.add(participant.id);
        affectedEvaluators.add(submission.reviewerOpenId);
        if (submission.status === PerfReviewStatus.SUBMITTED) {
          affectedEffective.push(submission);
        } else {
          affectedDrafts.push(submission);
        }
        const plan = buildCycleFormChangePlan(
          nextContent,
          submission.stage as HumanEvaluationStage,
          submission.items,
        );
        const compatibleKeys = new Set(
          plan.compatibleItems.map((item) => item.itemKey),
        );
        for (const item of submission.items) {
          const answerIdentity = `${participant.id}:${submission.stage}:${submission.reviewerOpenId}:${item.itemKey}`;
          (compatibleKeys.has(item.itemKey)
            ? compatibleAnswers
            : incompatibleAnswers
          ).add(answerIdentity);
        }
      }
    }

    const affectedStages = stageOrder.filter((stage) =>
      classifications.some((item) => item.affectedStages.includes(stage)),
    );
    const summary = {
      affectedParticipantCount: affectedParticipants.size,
      affectedEffectiveSubmissionCount: affectedEffective.length,
      affectedDraftCount: affectedDrafts.length,
      affectedEvaluatorCount: affectedEvaluators.size,
      compatibleAnswerCount: compatibleAnswers.size,
      incompatibleAnswerCount: incompatibleAnswers.size,
      unaffectedEffectiveSubmissionCount: unaffectedEffective.length,
    };
    const structuralPrefixes = new Set(
      classifications
        .filter((item) => item.category === 'STRUCTURAL')
        .map((item) => item.jobLevelPrefix),
    );
    // 同一 D/M 表单快照已有任一正式提交时，结构编辑入口必须先整体退回 DRAFT。
    const hasEffectiveSubmissions = cycle.participants.some(
      (participant) =>
        participant.jobLevelPrefixSnapshot &&
        structuralPrefixes.has(participant.jobLevelPrefixSnapshot) &&
        participant.evaluationSubmissions.some(
          (submission) => submission.status === PerfReviewStatus.SUBMITTED,
        ),
    );
    const structuralGatePassed =
      category !== 'STRUCTURAL' ||
      !hasEffectiveSubmissions ||
      cycle.status === PerfCycleStatus.DRAFT;
    const canApply =
      (category === 'COPY_ONLY' || category === 'STRUCTURAL') &&
      structuralGatePassed;
    const revisionFacts = {
      cycleId: cycle.id,
      cycleUpdatedAt: cycle.updatedAt.toISOString(),
      currentConfigVersionId: cycle.currentConfigVersionId,
      status: cycle.status,
      currentForms: cycle.currentConfigVersion!.formSnapshots.map(
        (snapshot) => ({
          id: snapshot.id,
          updatedAt: snapshot.updatedAt.toISOString(),
          content: snapshot.content,
        }),
      ),
      proposedForms: inputs,
      submissions: cycle.participants.flatMap((participant) =>
        participant.evaluationSubmissions.map((submission) => ({
          id: submission.id,
          status: submission.status,
          updatedAt: submission.updatedAt.toISOString(),
          itemIds: submission.items.map((item) => item.id),
        })),
      ),
    };
    return {
      cycleId: cycle.id,
      category,
      affectedStages,
      classifications,
      summary,
      canApply,
      blockedReason: canApply
        ? null
        : category === 'CALCULATION'
          ? '非结构性计算变更必须使用周期配置版本与重算流程'
          : category === 'NONE'
            ? '未检测到需要应用的表单变更'
            : '已有正式提交的结构性表单变更只能在周期整体退回 DRAFT 后执行',
      impactRevision: createHash('sha256')
        .update(canonicalJson(revisionFacts))
        .digest('hex'),
    };
  }

  private async createStructuralVersion(
    tx: Prisma.TransactionClient,
    cycle: FormChangeCycle,
    inputs: CycleFormSnapshotChangeInput['formSnapshots'],
    operatorOpenId: string,
  ): Promise<CreatedConfigVersion> {
    const current = cycle.currentConfigVersion!;
    const inputByPrefix = new Map(
      inputs.map((input) => [input.jobLevelPrefix, input]),
    );
    return tx.perfCycleConfigVersion.create({
      data: {
        cycleId: cycle.id,
        version: current.version + 1,
        sourceConfigTemplateVersionId: current.sourceConfigTemplateVersionId,
        selfStageMode: current.selfStageMode,
        peerStageMode: current.peerStageMode,
        managerStageMode: current.managerStageMode,
        aiStageMode: current.aiStageMode,
        ratings: this.inputJson(current.ratings),
        constraintProfiles: this.inputJson(current.constraintProfiles),
        orgOwnerWeight: current.orgOwnerWeight,
        projectOwnerWeight: current.projectOwnerWeight,
        peerWeight: current.peerWeight,
        crossDeptWeight: current.crossDeptWeight,
        schedulePreset: this.inputJson(current.schedulePreset),
        notificationRules: this.inputJson(current.notificationRules),
        createdByOpenId: operatorOpenId,
        formSnapshots: {
          create: current.formSnapshots.map((snapshot) => ({
            cycleId: cycle.id,
            jobLevelPrefix: snapshot.jobLevelPrefix,
            sourceFormTemplateVersionId: snapshot.sourceFormTemplateVersionId,
            content: this.inputJson(
              inputByPrefix.get(snapshot.jobLevelPrefix)!.content,
            ),
          })),
        },
      },
      include: { formSnapshots: true },
    });
  }

  private async migrateSubmissions(
    tx: Prisma.TransactionClient,
    cycle: FormChangeCycle,
    nextSnapshots: Array<{ id: number; jobLevelPrefix: string }>,
    impact: ReturnType<CycleFormChangeService['buildImpact']>,
    proposedForms: SnapshotInput[],
  ) {
    const nextSnapshotByPrefix = new Map(
      nextSnapshots.map((snapshot) => [snapshot.jobLevelPrefix, snapshot.id]),
    );
    const proposedByPrefix = new Map(
      proposedForms.map((item) => [item.jobLevelPrefix, item.content]),
    );

    // 参与者只切换当前表单指针；历史提交继续指向其原始快照，直到填写人主动重新提交。
    for (const [prefix, nextSnapshotId] of nextSnapshotByPrefix) {
      await tx.perfParticipant.updateMany({
        where: {
          cycleId: cycle.id,
          jobLevelPrefixSnapshot: prefix as 'D' | 'M',
        },
        data: { formSnapshotId: nextSnapshotId },
      });
    }

    for (const participant of cycle.participants) {
      const prefix = participant.jobLevelPrefixSnapshot;
      if (!prefix) continue;
      const nextSnapshotId = nextSnapshotByPrefix.get(prefix);
      if (!nextSnapshotId) {
        throw new ConflictException(`参与者 #${participant.id} 缺少新表单快照`);
      }
      const classification = impact.classifications.find(
        (item) => item.jobLevelPrefix === prefix,
      )!;
      const affectedStages = new Set(
        classification.category === 'STRUCTURAL'
          ? classification.affectedStages
          : [],
      );
      const groups = groupSubmissions(participant.evaluationSubmissions);
      const reopenedStages = new Set<HumanEvaluationStage>();
      const peerAssignmentIds = new Set<number>();
      for (const submissions of groups.values()) {
        const stage = submissions[0].stage as HumanEvaluationStage;
        const affected = affectedStages.has(stage);
        const nextContent = proposedByPrefix.get(prefix)!;
        if (affected) {
          await this.turnGroupIntoDraft(
            tx,
            submissions,
            nextContent,
            nextSnapshotId,
          );
          reopenedStages.add(stage);
          if (stage === 'PEER') {
            for (const submission of submissions) {
              if (submission.reviewerAssignmentId !== null) {
                peerAssignmentIds.add(submission.reviewerAssignmentId);
              }
            }
          }
        }
      }
      if (reopenedStages.size > 0) {
        await tx.perfEvaluationTask.updateMany({
          where: {
            participantId: participant.id,
            type: { in: [...reopenedStages] },
          },
          data: { completedAt: null },
        });
      }
      if (peerAssignmentIds.size > 0) {
        await tx.perfReviewerAssignment.updateMany({
          where: {
            id: { in: [...peerAssignmentIds] },
            status: PerfAssignmentStatus.SUBMITTED,
          },
          data: { status: PerfAssignmentStatus.PENDING },
        });
      }
    }
  }

  private async turnGroupIntoDraft(
    tx: Prisma.TransactionClient,
    submissions: Submission[],
    nextContent: FormSnapshotContent,
    nextSnapshotId: number,
  ) {
    const submitted = submissions.find(
      (item) => item.status === PerfReviewStatus.SUBMITTED,
    );
    const draft = submissions.find(
      (item) => item.status === PerfReviewStatus.DRAFT,
    );
    const source = draft ?? submitted ?? submissions[0];
    const mergedItems = new Map<string, Submission['items'][number]>();
    for (const item of submitted?.items ?? [])
      mergedItems.set(item.itemKey, item);
    // 已有编辑草稿代表填写人的最新输入；按 item key 覆盖旧生效值，但保留未编辑项。
    for (const item of draft?.items ?? []) mergedItems.set(item.itemKey, item);
    const plan = buildCycleFormChangePlan(
      nextContent,
      source.stage as HumanEvaluationStage,
      [...mergedItems.values()],
    );
    const compatible = new Map(
      plan.compatibleItems.map((item) => [item.itemKey, item]),
    );
    const rows = [...mergedItems.values()]
      .filter((item) => compatible.has(item.itemKey))
      .map((item) => {
        const location = compatible.get(item.itemKey)!;
        return {
          formSnapshotId: nextSnapshotId,
          subformKey: location.subformKey,
          dimensionKey: location.dimensionKey,
          itemKey: item.itemKey,
          itemType: item.itemType,
          rawLevel: item.rawLevel,
          rawScore: item.rawScore,
          // 草稿不参与新配置计算，保留原始值但主动清空计算分。
          calculationScore: null,
          value: item.value ?? undefined,
        };
      });
    // 旧提交及其全部明细原样保留，只退出当前 DRAFT/SUBMITTED 唯一槽位。
    await tx.perfEvaluationSubmission.updateMany({
      where: { id: { in: submissions.map((submission) => submission.id) } },
      data: {
        status: PerfReviewStatus.INVALIDATED,
      },
    });
    const nextDraft = await tx.perfEvaluationSubmission.create({
      data: {
        cycleId: source.cycleId,
        participantId: source.participantId,
        stage: source.stage,
        reviewerOpenId: source.reviewerOpenId,
        reviewerAssignmentId: source.reviewerAssignmentId,
        formSnapshotId: nextSnapshotId,
        status: PerfReviewStatus.DRAFT,
      },
    });
    if (rows.length > 0) {
      await tx.perfEvaluationItemResult.createMany({
        data: rows.map((row) => ({ ...row, submissionId: nextDraft.id })),
      });
    }
  }

  private async recalculateUnaffectedStages(
    tx: Prisma.TransactionClient,
    cycle: FormChangeCycle,
    impact: ReturnType<CycleFormChangeService['buildImpact']>,
  ) {
    for (const participant of cycle.participants) {
      const prefix = participant.jobLevelPrefixSnapshot;
      if (!prefix) continue;
      const classification = impact.classifications.find(
        (item) => item.jobLevelPrefix === prefix,
      )!;
      const affected = new Set(
        classification.category === 'STRUCTURAL'
          ? classification.affectedStages
          : [],
      );
      const effectiveStages = new Set(
        participant.evaluationSubmissions
          .filter(
            (submission) => submission.status === PerfReviewStatus.SUBMITTED,
          )
          .map((submission) => submission.stage),
      );
      if (
        !affected.has('PEER') &&
        effectiveStages.has(PerfEvaluationTaskType.PEER)
      ) {
        await this.peerStageResultService.recalculate(participant.id, tx);
      }
      if (
        !affected.has('MANAGER') &&
        effectiveStages.has(PerfEvaluationTaskType.MANAGER)
      ) {
        await this.managerStageResultService.recalculate(participant.id, tx);
      }
    }
  }

  private async applyCopyOnly(
    tx: Prisma.TransactionClient,
    cycle: FormChangeCycle,
    inputs: SnapshotInput[],
  ) {
    const inputByPrefix = new Map(
      inputs.map((input) => [input.jobLevelPrefix, input]),
    );
    for (const snapshot of cycle.currentConfigVersion!.formSnapshots) {
      await tx.perfCycleFormSnapshot.update({
        where: { id: snapshot.id },
        data: {
          content: this.inputJson(
            inputByPrefix.get(snapshot.jobLevelPrefix)!.content,
          ),
        },
      });
    }
  }

  private async writeAudit(
    tx: Prisma.TransactionClient,
    operatorOpenId: string,
    cycle: FormChangeCycle,
    impact: ReturnType<CycleFormChangeService['buildImpact']>,
    reason: string,
    next?: { id: number; version: number },
  ) {
    await tx.auditLog.create({
      data: {
        operatorOpenId,
        action: 'cycle.form.change',
        targetType: 'perf_cycle',
        targetId: String(cycle.id),
        before: this.inputJson({
          configVersionId: cycle.currentConfigVersionId,
          version: cycle.currentConfigVersion!.version,
        }),
        after: this.inputJson({
          category: impact.category,
          configVersionId: next?.id ?? cycle.currentConfigVersionId,
          version: next?.version ?? cycle.currentConfigVersion!.version,
          impactRevision: impact.impactRevision,
          impact: impact.summary,
        }),
        reason,
      },
    });
  }

  private assertSnapshotInputs(
    cycle: FormChangeCycle,
    inputs: SnapshotInput[],
  ) {
    const currentPrefixes = cycle
      .currentConfigVersion!.formSnapshots.map((item) => item.jobLevelPrefix)
      .sort();
    const nextPrefixes = inputs.map((item) => item.jobLevelPrefix).sort();
    if (
      new Set(nextPrefixes).size !== nextPrefixes.length ||
      canonicalJson(currentPrefixes) !== canonicalJson(nextPrefixes)
    ) {
      throw new BadRequestException('新表单快照必须且只能覆盖当前全部职级前缀');
    }
    for (const input of inputs) {
      if (!isCycleFormContentShape(input.content)) {
        throw new BadRequestException(
          `${input.jobLevelPrefix} 表单内容格式无效`,
        );
      }
      if (
        input.content.schemaVersion !== 1 ||
        input.content.jobLevelPrefix !== input.jobLevelPrefix
      ) {
        throw new BadRequestException(
          `${input.jobLevelPrefix} 表单 schemaVersion 或职级前缀不匹配`,
        );
      }
      const issues = validateFormTemplatePublication({
        name:
          typeof input.content.name === 'string'
            ? input.content.name
            : `${input.jobLevelPrefix} 周期表单`,
        description:
          typeof input.content.description === 'string'
            ? input.content.description
            : null,
        jobLevelPrefix: input.jobLevelPrefix,
        subforms: input.content.subforms as never,
      } satisfies FormTemplateVersionContract);
      if (issues.length > 0) {
        throw new BadRequestException({
          code: 'CYCLE_FORM_INVALID',
          message: `${input.jobLevelPrefix} 周期表单校验失败`,
          issues,
        });
      }
      assertStableKeysUnique(input.content, input.jobLevelPrefix);
    }
  }

  private assertExpectedVersion(cycle: FormChangeCycle, expectedId: number) {
    if (
      !Number.isInteger(expectedId) ||
      cycle.currentConfigVersionId !== expectedId
    ) {
      throw new ConflictException({
        code: 'CYCLE_FORM_VERSION_STALE',
        message: '周期配置版本已变化，请刷新后重试',
        currentConfigVersionId: cycle.currentConfigVersionId,
      });
    }
  }

  private async assertAuthorized(
    operatorOpenId: string,
    cycle: FormChangeCycle,
  ) {
    if (await this.rbacService.isAdmin(operatorOpenId)) return;
    const scope = await this.rbacService.getOrgScope(operatorOpenId);
    if (scope === null) return;
    if (
      cycle.participants.some(
        (participant) =>
          !participant.departmentIdSnapshot ||
          !scope.includes(participant.departmentIdSnapshot),
      )
    ) {
      throw new ForbiddenException('你的 HR 授权范围未覆盖本周期全部参与者');
    }
  }

  private async loadCycle(
    db:
      | Pick<PrismaService, 'perfCycle'>
      | Pick<Prisma.TransactionClient, 'perfCycle'>,
    cycleId: number,
  ): Promise<FormChangeCycle> {
    const cycle = await db.perfCycle.findFirst({
      where: { id: cycleId, deletedAt: null },
      include: cycleFormChangeInclude,
    });
    if (!cycle) throw new NotFoundException('绩效周期不存在');
    if (cycle.status === PerfCycleStatus.ARCHIVED) {
      throw new ConflictException('已归档周期永久只读，不能修改表单');
    }
    if (!cycle.currentConfigVersionId || !cycle.currentConfigVersion) {
      throw new ConflictException('周期缺少当前配置版本，不能修改表单');
    }
    return cycle;
  }

  private inputJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}

const stageOrder: HumanEvaluationStage[] = ['SELF', 'PEER', 'MANAGER'];

function strongestCategory(categories: CycleFormChangeCategory[]) {
  const order: CycleFormChangeCategory[] = [
    'NONE',
    'COPY_ONLY',
    'CALCULATION',
    'STRUCTURAL',
  ];
  return categories.reduce(
    (strongest, item) =>
      order.indexOf(item) > order.indexOf(strongest) ? item : strongest,
    'NONE' as CycleFormChangeCategory,
  );
}

function groupSubmissions(submissions: Submission[]) {
  const result = new Map<string, Submission[]>();
  for (const submission of submissions) {
    const key = `${submission.stage}:${submission.reviewerOpenId}`;
    const group = result.get(key) ?? [];
    group.push(submission);
    result.set(key, group);
  }
  return result;
}

function assertStableKeysUnique(content: FormSnapshotContent, prefix: string) {
  const keys = new Set<string>();
  for (const subform of content.subforms) {
    for (const key of [subform.key]) {
      if (!key || keys.has(key)) {
        throw new BadRequestException(
          `${prefix} 表单存在空或重复稳定 key: ${key}`,
        );
      }
      keys.add(key);
    }
    for (const dimension of subform.dimensions) {
      if (!dimension.key || keys.has(dimension.key)) {
        throw new BadRequestException(
          `${prefix} 表单存在空或重复稳定 key: ${dimension.key}`,
        );
      }
      keys.add(dimension.key);
      for (const item of dimension.items) {
        if (!item.key || keys.has(item.key)) {
          throw new BadRequestException(
            `${prefix} 表单存在空或重复稳定 key: ${item.key}`,
          );
        }
        keys.add(item.key);
      }
    }
  }
}

function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** HTTP 之外也可能直接调用 service；先防御嵌套形状，再进入会遍历数组的领域校验器。 */
function isCycleFormContentShape(
  value: unknown,
): value is SnapshotInput['content'] {
  if (!isRecord(value) || !Array.isArray(value.subforms)) return false;
  return value.subforms.every(
    (subform) =>
      isRecord(subform) &&
      typeof subform.key === 'string' &&
      Array.isArray(subform.dimensions) &&
      subform.dimensions.every(
        (dimension) =>
          isRecord(dimension) &&
          typeof dimension.key === 'string' &&
          Array.isArray(dimension.items) &&
          dimension.items.every(
            (item) => isRecord(item) && typeof item.key === 'string',
          ),
      ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
