import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PerfEvaluationTaskType,
  PerfReviewStatus,
} from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../shared/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EvaluationTaskAccessService } from '../cycle/evaluation-task-access.service';
import { AiReportService } from '../ai-report/ai-report.service';
import { ParticipantEvaluationLockService } from '../participant/participant-evaluation-lock.service';
import type {
  EvaluationDimensionAnswerDto,
  EvaluationFieldAnswerDto,
  SaveSelfEvaluationDto,
} from './evaluation.dto';
import type {
  FormSnapshotContent,
  FormSnapshotDimension,
  FormSnapshotField,
  FormSnapshotSubform,
} from './evaluation.service-types';
import { EvaluationEmployeeProfileService } from './evaluation-employee-profile.service';
import {
  calculateUnifiedStageResult,
  type UnifiedStageResult,
} from '../calculation/unified-stage-result-calculator';

/** 自评提交状态标记：无 SUBMITTED=草稿；有 SUBMITTED 无 DRAFT=已生效；两者都有=待重新提交 */
export type SelfEvaluationState = 'DRAFT' | 'EFFECTIVE' | 'PENDING_RESUBMIT';

export type ResolvedFieldAnswer = {
  answer: EvaluationFieldAnswerDto;
  field: FormSnapshotField;
};

export type ResolvedDimensionAnswer = {
  answer: EvaluationDimensionAnswerDto;
  dimension: FormSnapshotDimension;
  fields: ResolvedFieldAnswer[];
};

/**
 * 统一人工评估提交策略与 SELF 答卷生命周期。
 * PEER 服务复用本类公开的快照防伪造、完整性校验和原子明细替换能力，
 * 保证不同人工评估阶段写入同一套 PerfEvaluationSubmission 规则。
 */
@Injectable()
export class EvaluationSubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly taskAccessService: EvaluationTaskAccessService,
    private readonly aiReportService: AiReportService,
    private readonly participantEvaluationLockService: ParticipantEvaluationLockService,
    private readonly employeeProfileService: EvaluationEmployeeProfileService,
  ) {}

  /** 找到我在指定周期（或最近一个进行中周期）的参与记录，附表单快照与周期评级配置 */
  private async findMyParticipant(employeeOpenId: string, cycleId?: number) {
    return this.prisma.perfParticipant.findFirst({
      where: {
        employeeOpenId,
        cycle: { deletedAt: null },
        ...(cycleId
          ? { cycleId }
          : {
              cycle: {
                status: { notIn: ['DRAFT', 'ARCHIVED'] },
                deletedAt: null,
              },
            }),
      },
      orderBy: { id: 'desc' },
      include: {
        formSnapshot: { select: { id: true, content: true } },
        cycle: {
          include: {
            currentConfigVersion: { select: { id: true, ratings: true } },
          },
        },
      },
    });
  }

  /** 自评上下文：任务开放状态 + 员工可填表单内容 + 当前生效/草稿明细 + 状态标记 */
  async getSelfContext(employeeOpenId: string, cycleId?: number) {
    const participant = await this.findMyParticipant(employeeOpenId, cycleId);
    if (!participant) {
      return {
        participant: null,
        employee: null,
        task: null,
        form: null,
        submitted: null,
        draft: null,
        state: null,
      };
    }

    // 员工身份已由 participant 查询确认，此后才允许惰性写入开放事实与通知事件。
    const task = await this.taskAccessService.openIfDue(
      participant.id,
      PerfEvaluationTaskType.SELF,
    );
    if (!task?.openedAt) {
      // 开始前只展示任务预告，不下发表单结构与已填内容。
      return {
        participant,
        employee: null,
        task,
        form: null,
        submitted: null,
        draft: null,
        state: null,
      };
    }

    const content = this.requireSnapshotContent(participant);
    const [submissions, employee] = await Promise.all([
      this.prisma.perfEvaluationSubmission.findMany({
        where: {
          participantId: participant.id,
          stage: PerfEvaluationTaskType.SELF,
          reviewerOpenId: employeeOpenId,
        },
        include: {
          dimensionAnswers: {
            include: { fields: true },
            orderBy: { id: 'asc' },
          },
        },
      }),
      this.employeeProfileService.getDetailed(employeeOpenId),
    ]);
    const submitted =
      submissions.find(
        (submission) => submission.status === PerfReviewStatus.SUBMITTED,
      ) ?? null;
    const draft =
      submissions.find(
        (submission) => submission.status === PerfReviewStatus.DRAFT,
      ) ?? null;
    const state: SelfEvaluationState = submitted
      ? draft
        ? 'PENDING_RESUBMIT'
        : 'EFFECTIVE'
      : 'DRAFT';

    return {
      participant,
      employee,
      task,
      form: {
        formSnapshotId: participant.formSnapshotId,
        subforms: this.selectEmployeeSubforms(content),
      },
      submitted,
      draft,
      state,
    };
  }

  /** 草稿保存（自动保存调用）：允许不完整，事务内 upsert DRAFT 提交并整体替换其明细 */
  async saveSelfDraft(employeeOpenId: string, dto: SaveSelfEvaluationDto) {
    const participant = await this.requireParticipant(
      employeeOpenId,
      dto.cycleId,
    );
    const content = this.requireSnapshotContent(participant);
    const resolved = this.validateSelfDimensionAnswers(content, dto.dimensions);
    await this.taskAccessService.ensureWritable(
      participant.id,
      PerfEvaluationTaskType.SELF,
    );

    // 草稿保留原始计分输入，但不写计算分与派生等级；条件必填只在正式提交执行。
    const rows = resolved.map((entry) =>
      this.toDimensionAnswerRow(entry, participant.formSnapshotId!),
    );
    return this.prisma.$transaction(async (tx) => {
      await this.participantEvaluationLockService.lockSelfWrite(
        tx,
        participant.id,
        employeeOpenId,
      );
      const existing = await tx.perfEvaluationSubmission.findFirst({
        where: {
          participantId: participant.id,
          stage: PerfEvaluationTaskType.SELF,
          reviewerOpenId: employeeOpenId,
          status: PerfReviewStatus.DRAFT,
        },
      });
      let submission = existing;
      if (!submission) {
        try {
          submission = await tx.perfEvaluationSubmission.create({
            data: {
              cycleId: participant.cycleId,
              participantId: participant.id,
              stage: PerfEvaluationTaskType.SELF,
              reviewerOpenId: employeeOpenId,
              formSnapshotId: participant.formSnapshotId!,
              status: PerfReviewStatus.DRAFT,
            },
          });
        } catch (error) {
          // 双击/网络重试并发创建 DRAFT：部分唯一索引兜底数据完整性，这里只转换错误语义为业务可读中文。
          this.mapDuplicateSubmissionError(
            error,
            'active_draft_key',
            '保存冲突：已有并发保存草稿，请重试',
          );
        }
      }
      await this.replaceDimensionAnswers(tx, submission.id, rows);
      return submission;
    });
  }

  /** 提交自评：完整性校验通过后事务内原子替换 SUBMITTED 明细并删除 DRAFT，无答案历史 */
  async submitSelf(employeeOpenId: string, dto: SaveSelfEvaluationDto) {
    const participant = await this.requireParticipant(
      employeeOpenId,
      dto.cycleId,
    );
    const content = this.requireSnapshotContent(participant);
    const resolved = this.validateSelfDimensionAnswers(content, dto.dimensions);
    const ratings = this.requireUnifiedRatings(participant);
    const stageResult = this.calculateDimensionStageResult(
      this.selectEmployeeSubforms(content)[0],
      resolved,
      ratings,
      { relationType: 'LEADER', submissionId: `self:${employeeOpenId}` },
    );
    this.assertDimensionAnswersComplete(
      this.selectEmployeeSubforms(content)[0],
      resolved,
      stageResult,
    );
    await this.taskAccessService.ensureWritable(
      participant.id,
      PerfEvaluationTaskType.SELF,
    );

    const resultByDimension = new Map(
      stageResult.dimensions.map((dimension) => [dimension.id, dimension]),
    );
    const rows = resolved.map((entry) => {
      const result = resultByDimension.get(entry.dimension.key);
      const row = this.toDimensionAnswerRow(
        entry,
        participant.formSnapshotId!,
        result?.score ?? null,
        result?.level ?? null,
      );
      return row;
    });
    const submittedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.participantEvaluationLockService.lockSelfWrite(
        tx,
        participant.id,
        employeeOpenId,
      );
      const existing = await tx.perfEvaluationSubmission.findFirst({
        where: {
          participantId: participant.id,
          stage: PerfEvaluationTaskType.SELF,
          reviewerOpenId: employeeOpenId,
          status: PerfReviewStatus.SUBMITTED,
        },
      });
      // 重新提交原子替换当前 SUBMITTED 行内容，不新增行（部分唯一索引兜底并发）。
      let submission: Awaited<
        ReturnType<typeof tx.perfEvaluationSubmission.update>
      >;
      if (existing) {
        submission = await tx.perfEvaluationSubmission.update({
          where: { id: existing.id },
          data: {
            formSnapshotId: participant.formSnapshotId!,
            submittedAt,
            submittedByOpenId: employeeOpenId,
          },
        });
      } else {
        try {
          submission = await tx.perfEvaluationSubmission.create({
            data: {
              cycleId: participant.cycleId,
              participantId: participant.id,
              stage: PerfEvaluationTaskType.SELF,
              reviewerOpenId: employeeOpenId,
              formSnapshotId: participant.formSnapshotId!,
              status: PerfReviewStatus.SUBMITTED,
              submittedAt,
              submittedByOpenId: employeeOpenId,
            },
          });
        } catch (error) {
          // 双击/网络重试并发创建 SUBMITTED：部分唯一索引兜底数据完整性，这里只转换错误语义为业务可读中文。
          this.mapDuplicateSubmissionError(
            error,
            'active_submitted_key',
            '提交冲突：已有并发提交生效，请重试',
          );
        }
      }
      await this.replaceDimensionAnswers(tx, submission.id, rows);
      await this.replaceSelfStageResult(tx, participant, stageResult);
      // 自评任务完成标记与统一提交必须在同一事务生效。
      await tx.perfEvaluationTask.update({
        where: {
          participantId_type: {
            participantId: participant.id,
            type: PerfEvaluationTaskType.SELF,
          },
        },
        data: { completedAt: submittedAt },
      });
      // 提交生效后草稿即失去意义，一并删除（无答案历史）。
      await tx.perfEvaluationSubmission.deleteMany({
        where: {
          participantId: participant.id,
          stage: PerfEvaluationTaskType.SELF,
          reviewerOpenId: employeeOpenId,
          status: PerfReviewStatus.DRAFT,
        },
      });
      // 只在正式提交事务内刷新 AI 输入；若 MANAGER 尚未生效则不会提前创建任务。
      await this.aiReportService.refreshForParticipant(participant.id, tx);
      return submission;
    });

    await this.auditService.record({
      operatorOpenId: employeeOpenId,
      action: 'evaluation.self.submit',
      targetType: 'perf_participant',
      targetId: String(participant.id),
    });
    return { ok: true };
  }

  // ---- 私有辅助 ----

  /**
   * 把并发创建 DRAFT/SUBMITTED 行触发的部分唯一索引冲突（P2002）转换为业务可读中文错误。
   * 只精确匹配 indexNameFragment 对应的约束，其余异常（含其他 P2002）原样抛出，不吞错误。
   */
  mapDuplicateSubmissionError(
    error: unknown,
    indexNameFragment: string,
    message: string,
  ): never {
    if (this.isSubmissionUniqueConflict(error, indexNameFragment)) {
      throw new ConflictException(message);
    }
    throw error;
  }

  private isSubmissionUniqueConflict(
    error: unknown,
    indexNameFragment: string,
  ): boolean {
    // Prisma 错误可能跨 Jest isolate/driver adapter 边界，按稳定的 code/meta 协议识别。
    if (!error || typeof error !== 'object' || !('code' in error)) {
      return false;
    }
    const prismaError = error as {
      code: unknown;
      meta?: { target?: string | string[] };
    };
    if (prismaError.code !== 'P2002') return false;
    const target = prismaError.meta?.target;
    if (typeof target === 'string') return target.includes(indexNameFragment);
    if (Array.isArray(target)) {
      return target.some((item) => String(item).includes(indexNameFragment));
    }
    return false;
  }

  private async requireParticipant(employeeOpenId: string, cycleId: number) {
    const participant = await this.findMyParticipant(employeeOpenId, cycleId);
    if (!participant) throw new NotFoundException('你不在本周期考核名单中');
    return participant;
  }

  requireSnapshotContent(participant: {
    formSnapshotId: number | null;
    formSnapshot: { content: unknown } | null;
  }) {
    const content = participant.formSnapshot?.content as
      FormSnapshotContent | undefined;
    if (!participant.formSnapshotId || !content?.subforms) {
      throw new ConflictException('该参与者未匹配表单快照，无法填写评估表单');
    }
    return content;
  }

  requireRatings(participant: {
    cycle: { currentConfigVersion: { ratings: unknown } | null };
  }) {
    const ratings = participant.cycle.currentConfigVersion?.ratings as
      | Array<{
          symbol: 'S' | 'A' | 'B' | 'C';
          minScore?: string;
          maxScore?: string;
          mappingScore: string;
        }>
      | undefined;
    if (
      !Array.isArray(ratings) ||
      ratings.length === 0 ||
      ratings.some(
        (rating) => !rating.symbol || rating.mappingScore === undefined,
      )
    ) {
      throw new ConflictException('周期配置快照缺少评级定义，无法换算计算分');
    }
    return ratings;
  }

  /** 统一维度计算依赖完整等级区间。 */
  requireUnifiedRatings(participant: {
    cycle: { currentConfigVersion: { ratings: unknown } | null };
  }) {
    const ratings = this.requireRatings(participant);
    if (
      ratings.some(
        (rating) =>
          rating.minScore === undefined || rating.maxScore === undefined,
      )
    ) {
      throw new ConflictException(
        '周期配置快照缺少评级区间，无法生成人工评估结果',
      );
    }
    return ratings as Array<{
      symbol: 'S' | 'A' | 'B' | 'C';
      minScore: string;
      maxScore: string;
      mappingScore: string;
    }>;
  }

  /** SELF 与另外两类人工评估共用统一维度加权入口；员工本人视为单一 100% 关系。 */
  calculateDimensionStageResult(
    subform: FormSnapshotSubform | undefined,
    resolved: ResolvedDimensionAnswer[],
    ratings: ReturnType<EvaluationSubmissionService['requireUnifiedRatings']>,
    source: {
      relationType: 'LEADER' | 'PEER';
      submissionId: string;
    },
  ) {
    if (!subform) throw new ConflictException('当前表单快照缺少人工评估子表单');
    const scoringDimensions = subform.dimensions.filter(
      (dimension) => dimension.type === 'SCORING',
    );
    const dimensions = scoringDimensions.map((dimension) => {
      const answer = resolved.find(
        (entry) => entry.dimension.key === dimension.key,
      )?.answer;
      const missing =
        !answer ||
        (dimension.scoringMethod === 'RATING'
          ? answer.rawLevel == null
          : answer.rawScore == null);
      if (missing) {
        throw new BadRequestException(
          `计分维度「${dimension.name}」尚未填写，无法提交`,
        );
      }
      return {
        id: dimension.key,
        name: dimension.name ?? dimension.key,
        scoringMethod: dimension.scoringMethod!,
        weight: dimension.weight!,
        isCore: Boolean(dimension.isCore),
        relations: [
          {
            type: source.relationType,
            weight: '100',
            items: [
              {
                submissionId: source.submissionId,
                ...(dimension.scoringMethod === 'RATING'
                  ? { rawLevel: answer.rawLevel }
                  : { rawScore: answer.rawScore }),
              },
            ],
          },
        ],
      };
    });
    return calculateUnifiedStageResult({
      ratings,
      dimensions,
      confirmedRedLine: null,
    });
  }

  /** 正式提交完整性：所有计分维度固定必填，字段按 ALWAYS/维度派生等级执行。 */
  assertDimensionAnswersComplete(
    subform: FormSnapshotSubform | undefined,
    resolved: ResolvedDimensionAnswer[],
    result: UnifiedStageResult,
  ) {
    if (!subform) throw new ConflictException('当前表单快照缺少人工评估子表单');
    const levels = new Map(
      result.dimensions.map((dimension) => [dimension.id, dimension.level]),
    );
    for (const dimension of subform.dimensions) {
      const answer = resolved.find(
        (entry) => entry.dimension.key === dimension.key,
      );
      for (const field of dimension.fields ?? []) {
        const answered = answer?.fields.some(
          (entry) =>
            entry.field.key === field.key &&
            this.isFieldValueAnswered(entry.answer.value),
        );
        const required =
          field.requiredRule === 'ALWAYS' ||
          (field.requiredRule === 'CONDITIONAL' &&
            (field.requiredLevels ?? []).includes(levels.get(dimension.key)!));
        if (required && !answered) {
          throw new BadRequestException(
            `必填表单字段「${field.title}」尚未填写，无法提交`,
          );
        }
      }
    }
  }

  /** 员工自评只读取 SELF 子表单；晋升已退出绩效评估提交链（ADR-0066）。 */
  private selectEmployeeSubforms(
    content: FormSnapshotContent,
  ): FormSnapshotSubform[] {
    return content.subforms.filter((subform) => subform.type === 'SELF');
  }

  /**
   * SELF 新版防伪造边界：维度与字段 key 都必须来自当前周期快照，
   * 且计分载荷必须匹配维度自己的 scoringMethod。
   */
  private validateSelfDimensionAnswers(
    content: FormSnapshotContent,
    answers: EvaluationDimensionAnswerDto[],
  ): ResolvedDimensionAnswer[] {
    const self = this.selectEmployeeSubforms(content)[0];
    if (!self) throw new ConflictException('当前表单快照缺少员工自评子表单');
    return this.validateDimensionAnswersInSubform(self, answers, '员工自评');
  }

  /** 360°新版防伪造边界：只接受当前 PEER 子表单内稳定的维度与字段 key。 */
  validatePeerDimensionAnswers(
    content: FormSnapshotContent,
    answers: EvaluationDimensionAnswerDto[],
  ): ResolvedDimensionAnswer[] {
    const peer = this.selectPeerSubforms(content)[0];
    if (!peer) throw new ConflictException('当前表单快照缺少 360°评估子表单');
    return this.validateDimensionAnswersInSubform(peer, answers, '360°评估');
  }

  /** 上级评估新版防伪造边界：只接受 MANAGER 子表单内稳定的维度与字段 key。 */
  validateManagerDimensionAnswers(
    content: FormSnapshotContent,
    answers: EvaluationDimensionAnswerDto[],
  ): ResolvedDimensionAnswer[] {
    const manager = this.selectManagerSubforms(content)[0];
    if (!manager) throw new ConflictException('当前表单快照缺少上级评估子表单');
    return this.validateDimensionAnswersInSubform(manager, answers, '上级评估');
  }

  private validateDimensionAnswersInSubform(
    subform: FormSnapshotSubform,
    answers: EvaluationDimensionAnswerDto[],
    scopeLabel: string,
  ): ResolvedDimensionAnswer[] {
    const seenDimensions = new Set<string>();
    return answers.map((answer) => {
      const dimension = subform.dimensions.find(
        (candidate) => candidate.key === answer.dimensionKey,
      );
      if (answer.subformKey !== subform.key || !dimension) {
        throw new BadRequestException(
          `评估维度 ${answer.dimensionKey} 不存在于当前${scopeLabel}表单快照`,
        );
      }
      if (seenDimensions.has(answer.dimensionKey)) {
        throw new BadRequestException(`评估维度「${dimension.name}」重复提交`);
      }
      seenDimensions.add(answer.dimensionKey);

      const scoringMethod = dimension.scoringMethod ?? null;
      if (
        (scoringMethod === 'RATING' && answer.rawScore !== undefined) ||
        (scoringMethod === 'SCORE' && answer.rawLevel !== undefined) ||
        (!scoringMethod &&
          (answer.rawLevel !== undefined || answer.rawScore !== undefined))
      ) {
        throw new BadRequestException(
          `评估维度「${dimension.name}」的计分载荷与计分方式不匹配`,
        );
      }

      const seenFields = new Set<string>();
      const fields = answer.fields.map((fieldAnswer) => {
        const field = (dimension.fields ?? []).find(
          (candidate) => candidate.key === fieldAnswer.fieldKey,
        );
        if (!field) {
          throw new BadRequestException(
            `表单字段 ${fieldAnswer.fieldKey} 不存在于评估维度「${dimension.name}」`,
          );
        }
        if (seenFields.has(field.key)) {
          throw new BadRequestException(`表单字段「${field.title}」重复提交`);
        }
        seenFields.add(field.key);
        if (!this.isFieldValueAnswered(fieldAnswer.value)) {
          throw new BadRequestException(
            `表单字段「${field.title}」没有有效内容`,
          );
        }
        if (!this.isFieldValueCompatible(field, fieldAnswer.value)) {
          throw new BadRequestException(
            `表单字段「${field.title}」的内容载荷与字段类型不匹配`,
          );
        }
        return { answer: fieldAnswer, field };
      });
      return { answer, dimension, fields };
    });
  }

  /** 服务端按快照字段类型约束 JSON 形状，不能只依赖可被绕过的前端控件。 */
  private isFieldValueCompatible(field: FormSnapshotField, value: unknown) {
    if (
      field.type === 'SHORT_TEXT' ||
      field.type === 'LONG_TEXT' ||
      field.type === 'MARKDOWN' ||
      field.type === 'SINGLE_SELECT'
    ) {
      return typeof value === 'string';
    }
    if (field.type === 'LINK') {
      return typeof value === 'string' && this.isHttpUrl(value);
    }
    if (field.type === 'MULTI_SELECT') {
      return (
        Array.isArray(value) &&
        value.every(
          (entry) => typeof entry === 'string' && entry.trim().length > 0,
        )
      );
    }
    if (field.type === 'ATTACHMENT') {
      return (
        Array.isArray(value) &&
        value.every((entry) => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            return false;
          }
          const attachment = entry as Record<string, unknown>;
          const name = attachment.name;
          const url = attachment.url;
          if (
            typeof name !== 'string' ||
            !name.trim() ||
            typeof url !== 'string'
          ) {
            return false;
          }
          return this.isHttpUrl(url);
        })
      );
    }
    return false;
  }

  private isHttpUrl(value: string) {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  toDimensionAnswerRow(
    resolved: ResolvedDimensionAnswer,
    formSnapshotId: number,
    calculationScore: string | null = null,
    derivedLevel: 'S' | 'A' | 'B' | 'C' | null = null,
  ) {
    return {
      formSnapshotId,
      subformKey: resolved.answer.subformKey,
      dimensionKey: resolved.answer.dimensionKey,
      scoringMethod: resolved.dimension.scoringMethod ?? null,
      rawLevel: resolved.answer.rawLevel ?? null,
      rawScore: resolved.answer.rawScore ?? null,
      calculationScore,
      derivedLevel,
      fields: resolved.fields.map(({ answer, field }) => ({
        fieldKey: answer.fieldKey,
        fieldType: field.type,
        value: answer.value as Prisma.InputJsonValue,
      })),
    };
  }

  /** 维度回答整体替换；字段回答通过父维度的级联删除与嵌套创建保持原子性。 */
  async replaceDimensionAnswers(
    tx: Prisma.TransactionClient,
    submissionId: number,
    rows: Array<
      ReturnType<EvaluationSubmissionService['toDimensionAnswerRow']>
    >,
  ) {
    await tx.perfEvaluationDimensionAnswer.deleteMany({
      where: { submissionId },
    });
    for (const row of rows) {
      const { fields, ...dimension } = row;
      await tx.perfEvaluationDimensionAnswer.create({
        data: {
          ...dimension,
          submissionId,
          fields: { create: fields },
        },
      });
    }
  }

  /** 正式 SELF 提交与阶段结果在同一事务内生效，避免答卷和结果出现短暂不一致。 */
  private async replaceSelfStageResult(
    tx: Prisma.TransactionClient,
    participant: {
      id: number;
      cycleId: number;
      cycle: { currentConfigVersion: { id: number } | null };
    },
    result: UnifiedStageResult,
  ) {
    const cycleConfigVersionId = participant.cycle.currentConfigVersion?.id;
    if (!cycleConfigVersionId) {
      throw new ConflictException('周期缺少当前配置版本，无法生成自评结果');
    }
    const calculationDetail = result as unknown as Prisma.InputJsonObject;
    const constraintReasons =
      result.matchedConstraints as unknown as Prisma.InputJsonArray;
    const values = {
      status: 'READY' as const,
      reviewerCount: 1,
      compositeScore: result.compositeScore,
      initialLevel: result.initialLevel,
      stageLevel: result.finalLevel,
      constraintReasons,
      calculationDetail,
      calculatedAt: new Date(),
    };
    const stageResult = await tx.perfStageResult.upsert({
      where: {
        participantId_stage_cycleConfigVersionId: {
          participantId: participant.id,
          stage: PerfEvaluationTaskType.SELF,
          cycleConfigVersionId,
        },
      },
      create: {
        cycleId: participant.cycleId,
        participantId: participant.id,
        cycleConfigVersionId,
        stage: PerfEvaluationTaskType.SELF,
        ...values,
      },
      update: values,
    });
    await tx.perfStageDimensionResult.deleteMany({
      where: { stageResultId: stageResult.id },
    });
    await tx.perfStageDimensionResult.createMany({
      data: result.dimensions.map((dimension) => ({
        stageResultId: stageResult.id,
        dimensionKey: dimension.id,
        name: dimension.name,
        weight: dimension.weight,
        isCore: dimension.isCore,
        score: dimension.score,
        level: dimension.level,
      })),
    });
  }

  private isFieldValueAnswered(value: unknown) {
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }

  /** 360°只使用 PEER 子表单的 REVIEWER 区段；晋升子表单无条件排除（ADR-0011）。 */
  selectPeerSubforms(content: FormSnapshotContent) {
    return content.subforms
      .filter((subform) => subform.type === 'PEER')
      .map((subform) => ({
        ...subform,
        dimensions: subform.dimensions.filter(
          (dimension) => dimension.audience === 'REVIEWER',
        ),
      }));
  }

  /** 晋升已退出绩效提交链；Leader 只填写 MANAGER 子表单。 */
  selectManagerSubforms(content: FormSnapshotContent) {
    return content.subforms
      .filter((subform) => subform.type === 'MANAGER')
      .map((subform) => ({
        ...subform,
        dimensions: subform.dimensions.filter(
          (dimension) => dimension.audience === 'LEADER',
        ),
      }));
  }
}
