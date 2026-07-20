import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client';
import {
  PerfAssignmentStatus,
  PerfCycleStatus,
  PerfEvaluationTaskType,
  PerfFormFieldType,
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
      schemaVersion: 2;
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
  // 全部历史快照共同构成墓碑注册表，防止删除后的稳定 key 被后来复用。
  configVersions: {
    orderBy: { version: 'asc' as const },
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
        include: {
          dimensionAnswers: {
            include: { fields: { orderBy: { id: 'asc' as const } } },
            orderBy: { id: 'asc' as const },
          },
        },
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
        // 影响修订基于客户端临时 key 保持稳定；只有确认应用时才物化全新服务端身份。
        const materialized = this.materializeNewIdentityKeys(
          cycle,
          input.formSnapshots,
        );
        const auditImpact = this.materializeAuditImpact(
          cycle,
          impact,
          materialized.formSnapshots,
        );

        if (impact.category === 'COPY_ONLY') {
          await this.applyCopyOnly(tx, cycle, materialized.formSnapshots);
          await this.writeAudit(tx, operatorOpenId, cycle, auditImpact, reason);
          return {
            cycleId,
            category: impact.category,
            configVersionId: cycle.currentConfigVersionId,
            version: cycle.currentConfigVersion!.version,
            impact: impact.summary,
            materializedIdentities: materialized.identities,
          };
        }

        const next = await this.createStructuralVersion(
          tx,
          cycle,
          materialized.formSnapshots,
          operatorOpenId,
        );
        await this.migrateSubmissions(
          tx,
          cycle,
          next.formSnapshots,
          impact,
          materialized.formSnapshots,
        );
        await tx.perfCycle.update({
          where: { id: cycleId },
          data: { currentConfigVersionId: next.id },
        });
        await this.recalculateUnaffectedStages(tx, cycle, impact);
        await this.writeAudit(
          tx,
          operatorOpenId,
          cycle,
          auditImpact,
          reason,
          next,
        );
        return {
          cycleId,
          category: impact.category,
          configVersionId: next.id,
          version: next.version,
          impact: impact.summary,
          materializedIdentities: materialized.identities,
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
          submission.dimensionAnswers,
        );
        const identityPrefix = `${participant.id}:${submission.stage}:${submission.reviewerOpenId}`;
        for (const dimension of plan.compatibleDimensionAnswers) {
          compatibleAnswers.add(
            `${identityPrefix}:dimension:${dimension.dimensionKey}:scoring`,
          );
        }
        for (const field of plan.compatibleFieldAnswers) {
          compatibleAnswers.add(`${identityPrefix}:field:${field.fieldKey}`);
        }
        for (const key of plan.incompatibleAnswerKeys) {
          incompatibleAnswers.add(`${identityPrefix}:${key}`);
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
          dimensionAnswers: submission.dimensionAnswers.map((dimension) => ({
            id: dimension.id,
            fieldIds: dimension.fields.map((field) => field.id),
          })),
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
        ratings: this.inputJson(current.ratings),
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
    const mergedDimensions = mergeDimensionAnswers(
      submitted?.dimensionAnswers ?? [],
      draft?.dimensionAnswers ?? [],
    );
    const plan = buildCycleFormChangePlan(
      nextContent,
      source.stage as HumanEvaluationStage,
      mergedDimensions,
    );
    const rows = buildPrefilledDimensionRows(nextContent, plan, nextSnapshotId);
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
    for (const row of rows) {
      const { fields, ...dimension } = row;
      await tx.perfEvaluationDimensionAnswer.create({
        data: {
          ...dimension,
          submissionId: nextDraft.id,
          fields: { create: fields },
        },
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
          changes: impact.classifications.flatMap((classification) =>
            classification.changes.map((change) => ({
              jobLevelPrefix: classification.jobLevelPrefix,
              ...change,
            })),
          ),
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
        input.content.schemaVersion !== 2 ||
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
      this.assertRegisteredIdentities(cycle, input);
    }
  }

  private assertRegisteredIdentities(
    cycle: FormChangeCycle,
    input: SnapshotInput,
  ) {
    const currentSnapshot = cycle.currentConfigVersion!.formSnapshots.find(
      (snapshot) => snapshot.jobLevelPrefix === input.jobLevelPrefix,
    )!;
    const current = collectContentIdentities(
      currentSnapshot.content as unknown as FormSnapshotContent,
    );
    const registry = new Map<string, StableIdentityKind>();
    for (const version of cycle.configVersions) {
      for (const snapshot of version.formSnapshots) {
        const identities = collectContentIdentities(
          snapshot.content as unknown as FormSnapshotContent,
        );
        for (const [key, kind] of identities.all) {
          const previous = registry.get(key);
          if (previous && previous !== kind) {
            throw new ConflictException(
              `历史周期快照中的稳定 key ${key} 已出现身份类型冲突`,
            );
          }
          registry.set(key, kind);
        }
      }
    }

    const currentSubformByType = new Map(
      (currentSnapshot.content as unknown as FormSnapshotContent).subforms.map(
        (subform) => [subform.type, subform.key],
      ),
    );
    for (const subform of input.content.subforms) {
      if (!stageOrder.includes(subform.type)) {
        throw new BadRequestException(
          `${input.jobLevelPrefix} 周期表单只允许 SELF、PEER、MANAGER 子表单`,
        );
      }
      if (currentSubformByType.get(subform.type) !== subform.key) {
        throw new BadRequestException(
          `${subform.type} 子表单稳定 key 必须来自当前周期快照`,
        );
      }
      for (const dimension of subform.dimensions) {
        assertIdentityCanBeInherited(
          dimension.key,
          'DIMENSION',
          current,
          registry,
        );
        for (const field of dimension.fields ?? []) {
          assertIdentityCanBeInherited(field.key, 'FIELD', current, registry);
        }
      }
    }
  }

  private materializeNewIdentityKeys(
    cycle: FormChangeCycle,
    inputs: SnapshotInput[],
  ): {
    formSnapshots: SnapshotInput[];
    identities: Array<{
      kind: 'DIMENSION' | 'FIELD';
      jobLevelPrefix: 'D' | 'M';
      clientKey: string;
      serverKey: string;
    }>;
  } {
    const identities: Array<{
      kind: 'DIMENSION' | 'FIELD';
      jobLevelPrefix: 'D' | 'M';
      clientKey: string;
      serverKey: string;
    }> = [];
    const currentByPrefix = new Map(
      cycle.currentConfigVersion!.formSnapshots.map((snapshot) => [
        snapshot.jobLevelPrefix,
        collectContentIdentities(
          snapshot.content as unknown as FormSnapshotContent,
        ),
      ]),
    );
    const formSnapshots = inputs.map((input) => {
      const current = currentByPrefix.get(input.jobLevelPrefix)!;
      const content = structuredClone(input.content);
      for (const subform of content.subforms) {
        for (const dimension of subform.dimensions) {
          if (!current.dimensions.has(dimension.key)) {
            const clientKey = dimension.key;
            dimension.key = randomUUID();
            identities.push({
              kind: 'DIMENSION',
              jobLevelPrefix: input.jobLevelPrefix,
              clientKey,
              serverKey: dimension.key,
            });
          }
          for (const field of dimension.fields ?? []) {
            if (!current.fields.has(field.key)) {
              const clientKey = field.key;
              field.key = randomUUID();
              identities.push({
                kind: 'FIELD',
                jobLevelPrefix: input.jobLevelPrefix,
                clientKey,
                serverKey: field.key,
              });
            }
          }
        }
      }
      return { ...input, content };
    });
    return { formSnapshots, identities };
  }

  /** 审计只记录已持久化身份，避免预览临时 key 无法关联最终周期快照。 */
  private materializeAuditImpact(
    cycle: FormChangeCycle,
    impact: ReturnType<CycleFormChangeService['buildImpact']>,
    formSnapshots: SnapshotInput[],
  ): ReturnType<CycleFormChangeService['buildImpact']> {
    // 用最终快照重新分类，比字符串替换更安全：D/M 即使使用同名预览 key，
    // 每条 change 的维度、字段及父级引用仍会落到所属快照的服务端身份。
    const materialized = this.buildImpact(cycle, formSnapshots);
    return {
      ...impact,
      classifications: materialized.classifications,
    };
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

type StableIdentityKind = 'SUBFORM' | 'DIMENSION' | 'FIELD';

function collectContentIdentities(content: FormSnapshotContent) {
  const subforms = new Set<string>();
  const dimensions = new Set<string>();
  const fields = new Set<string>();
  const all = new Map<string, StableIdentityKind>();
  for (const subform of content.subforms) {
    subforms.add(subform.key);
    all.set(subform.key, 'SUBFORM');
    for (const dimension of subform.dimensions) {
      dimensions.add(dimension.key);
      all.set(dimension.key, 'DIMENSION');
      for (const field of dimension.fields ?? []) {
        fields.add(field.key);
        all.set(field.key, 'FIELD');
      }
    }
  }
  return { subforms, dimensions, fields, all };
}

function assertIdentityCanBeInherited(
  key: string,
  expectedKind: 'DIMENSION' | 'FIELD',
  current: ReturnType<typeof collectContentIdentities>,
  registry: Map<string, StableIdentityKind>,
) {
  const registeredKind = registry.get(key);
  if (registeredKind && registeredKind !== expectedKind) {
    throw new BadRequestException(
      `稳定 key ${key} 已注册为 ${registeredKind}，禁止串用为 ${expectedKind} 身份类型`,
    );
  }
  const currentKeys =
    expectedKind === 'DIMENSION' ? current.dimensions : current.fields;
  if (registeredKind === expectedKind && !currentKeys.has(key)) {
    throw new BadRequestException(`已删除的稳定 key ${key} 不得复用`);
  }
}

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

function mergeDimensionAnswers(
  submitted: Submission['dimensionAnswers'],
  draft: Submission['dimensionAnswers'],
) {
  const merged = new Map<
    string,
    Submission['dimensionAnswers'][number] & {
      fields: Submission['dimensionAnswers'][number]['fields'];
    }
  >();
  for (const dimension of submitted)
    merged.set(dimension.dimensionKey, dimension);
  for (const dimension of draft) {
    const previous = merged.get(dimension.dimensionKey);
    const fields = new Map(
      (previous?.fields ?? []).map((field) => [field.fieldKey, field]),
    );
    // 草稿是填写人的最新输入；按稳定 fieldKey 覆盖，未编辑字段仍从生效答卷预填。
    for (const field of dimension.fields) fields.set(field.fieldKey, field);
    merged.set(dimension.dimensionKey, {
      ...dimension,
      fields: [...fields.values()],
    });
  }
  return [...merged.values()];
}

function buildPrefilledDimensionRows(
  content: FormSnapshotContent,
  plan: ReturnType<typeof buildCycleFormChangePlan>,
  formSnapshotId: number,
) {
  const dimensions = new Map<
    string,
    {
      formSnapshotId: number;
      subformKey: string;
      dimensionKey: string;
      scoringMethod: 'RATING' | 'SCORE' | null;
      rawLevel: 'S' | 'A' | 'B' | 'C' | null;
      rawScore: string | null;
      calculationScore: null;
      derivedLevel: null;
      fields: Array<{
        fieldKey: string;
        fieldType: PerfFormFieldType;
        value: Prisma.InputJsonValue;
      }>;
    }
  >();
  const targetDimensions = new Map(
    content.subforms.flatMap((subform) =>
      subform.dimensions.map(
        (dimension) => [dimension.key, { subform, dimension }] as const,
      ),
    ),
  );
  const ensureRow = (subformKey: string, dimensionKey: string) => {
    const existing = dimensions.get(dimensionKey);
    if (existing) return existing;
    const target = targetDimensions.get(dimensionKey)!;
    const row = {
      formSnapshotId,
      subformKey,
      dimensionKey,
      scoringMethod:
        target.dimension.type === 'SCORING'
          ? (target.dimension.scoringMethod ?? null)
          : null,
      rawLevel: null,
      rawScore: null,
      // 结构变更后草稿不参与计算，只保留兼容原始值等待重新提交。
      calculationScore: null,
      derivedLevel: null,
      fields: [],
    };
    dimensions.set(dimensionKey, row);
    return row;
  };
  for (const answer of plan.compatibleDimensionAnswers) {
    const row = ensureRow(answer.subformKey, answer.dimensionKey);
    row.scoringMethod = answer.scoringMethod;
    row.rawLevel = answer.rawLevel;
    row.rawScore = answer.rawScore === null ? null : answer.rawScore.toString();
  }
  for (const field of plan.compatibleFieldAnswers) {
    const row = ensureRow(field.subformKey, field.dimensionKey);
    row.fields.push({
      fieldKey: field.fieldKey,
      fieldType: field.fieldType,
      value: field.value as Prisma.InputJsonValue,
    });
  }
  return [...dimensions.values()];
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
      for (const field of dimension.fields ?? []) {
        if (!field.key || keys.has(field.key)) {
          throw new BadRequestException(
            `${prefix} 表单存在空或重复稳定 key: ${field.key}`,
          );
        }
        keys.add(field.key);
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
          Array.isArray(dimension.fields) &&
          dimension.fields.every(
            (field) => isRecord(field) && typeof field.key === 'string',
          ),
      ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
