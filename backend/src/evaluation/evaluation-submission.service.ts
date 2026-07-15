import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PerfEvaluationTaskType,
  PerfFormItemType,
  PerfParticipantStatus,
  PerfReviewStatus,
} from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../shared/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ParticipantService } from '../participant/participant.service';
import { EvaluationTaskAccessService } from '../cycle/evaluation-task-access.service';
import { AiReportService } from '../ai-report/ai-report.service';
import { ParticipantEvaluationLockService } from '../participant/participant-evaluation-lock.service';
import type {
  EvaluationItemAnswerDto,
  SaveSelfEvaluationDto,
} from './evaluation.dto';
import type {
  FormSnapshotContent,
  FormSnapshotDimension,
  FormSnapshotItem,
  FormSnapshotSubform,
} from './evaluation.service-types';

/** 自评提交状态标记：无 SUBMITTED=草稿；有 SUBMITTED 无 DRAFT=已生效；两者都有=待重新提交 */
export type SelfEvaluationState = 'DRAFT' | 'EFFECTIVE' | 'PENDING_RESUBMIT';

/** 校验后的明细行：已定位快照评估项并完成类型匹配 */
export type ResolvedAnswer = {
  answer: EvaluationItemAnswerDto;
  item: FormSnapshotItem;
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
    private readonly participantService: ParticipantService,
    private readonly taskAccessService: EvaluationTaskAccessService,
    private readonly aiReportService: AiReportService,
    private readonly participantEvaluationLockService: ParticipantEvaluationLockService,
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
            currentConfigVersion: { select: { ratings: true } },
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
        task,
        form: null,
        submitted: null,
        draft: null,
        state: null,
      };
    }

    const content = this.requireSnapshotContent(participant);
    const submissions = await this.prisma.perfEvaluationSubmission.findMany({
      where: {
        participantId: participant.id,
        stage: PerfEvaluationTaskType.SELF,
        reviewerOpenId: employeeOpenId,
      },
      include: { items: true },
    });
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
      task,
      form: {
        formSnapshotId: participant.formSnapshotId,
        subforms: this.selectEmployeeSubforms(
          content,
          participant.isPromotionEnabled,
        ),
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
    const resolved = this.validateAnswers(
      content,
      participant.isPromotionEnabled,
      dto.items,
    );
    await this.taskAccessService.ensureWritable(
      participant.id,
      PerfEvaluationTaskType.SELF,
    );

    // 草稿不写计算分（提交时才按周期配置换算），只保留原始输入。
    const rows = resolved.map((entry) =>
      this.toItemRow(entry, participant.formSnapshotId!, null),
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
      await this.replaceItems(tx, submission.id, rows);
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
    const resolved = this.validateAnswers(
      content,
      participant.isPromotionEnabled,
      dto.items,
    );
    this.assertComplete(content, participant.isPromotionEnabled, resolved);
    const ratings = this.requireRatings(participant);
    await this.taskAccessService.ensureWritable(
      participant.id,
      PerfEvaluationTaskType.SELF,
    );

    const rows = resolved.map((entry) =>
      this.toItemRow(
        entry,
        participant.formSnapshotId!,
        this.calculationScoreOf(entry, ratings),
      ),
    );
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
      await this.replaceItems(tx, submission.id, rows);
      // 镜像旧 SelfReviewService.submit：自评任务完成标记与提交同事务生效。
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

    if (
      participant.status === PerfParticipantStatus.PENDING_SELF_REVIEW ||
      participant.status === PerfParticipantStatus.RETURNED
    ) {
      // 重新提交不能回退已经推进到评审/AI 的参与者进度（与旧路径同语义）。
      await this.participantService.transition(
        employeeOpenId,
        participant.id,
        PerfParticipantStatus.SELF_SUBMITTED,
      );
    }
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
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }
    const target = error.meta?.target;
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
      throw new ConflictException('该参与者未匹配表单快照，无法填写自评');
    }
    return content;
  }

  requireRatings(participant: {
    cycle: { currentConfigVersion: { ratings: unknown } | null };
  }) {
    const ratings = participant.cycle.currentConfigVersion?.ratings as
      Array<{ symbol: string; mappingScore: string }> | undefined;
    if (!Array.isArray(ratings) || ratings.length === 0) {
      throw new ConflictException('周期配置快照缺少评级定义，无法换算计算分');
    }
    return ratings;
  }

  /** 员工可填子表单：SELF 全量；启用晋升评估时附带 PROMOTION 的员工区段（ADR-0011） */
  private selectEmployeeSubforms(
    content: FormSnapshotContent,
    isPromotionEnabled: boolean,
  ): FormSnapshotSubform[] {
    const subforms: FormSnapshotSubform[] = [];
    for (const subform of content.subforms) {
      if (subform.type === 'SELF') {
        subforms.push(subform);
      } else if (subform.type === 'PROMOTION' && isPromotionEnabled) {
        subforms.push({
          ...subform,
          dimensions: subform.dimensions.filter(
            (dimension) => dimension.audience === 'EMPLOYEE',
          ),
        });
      }
    }
    return subforms;
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

  /** 上级仅填写 MANAGER 子表单及启用晋升时 PROMOTION 的 LEADER 区段。 */
  selectManagerSubforms(
    content: FormSnapshotContent,
    isPromotionEnabled: boolean,
  ) {
    const subforms: FormSnapshotSubform[] = [];
    for (const subform of content.subforms) {
      if (subform.type === 'MANAGER') {
        subforms.push({
          ...subform,
          dimensions: subform.dimensions.filter(
            (dimension) => dimension.audience === 'LEADER',
          ),
        });
      } else if (subform.type === 'PROMOTION' && isPromotionEnabled) {
        subforms.push({
          ...subform,
          dimensions: subform.dimensions.filter(
            (dimension) => dimension.audience === 'LEADER',
          ),
        });
      }
    }
    return subforms;
  }

  validatePeerAnswers(
    content: FormSnapshotContent,
    answers: EvaluationItemAnswerDto[],
  ) {
    return this.validateAnswersInSubforms(
      content,
      this.selectPeerSubforms(content),
      answers,
      '360°评审员可填范围',
    );
  }

  validateManagerAnswers(
    content: FormSnapshotContent,
    isPromotionEnabled: boolean,
    answers: EvaluationItemAnswerDto[],
  ) {
    return this.validateAnswersInSubforms(
      content,
      this.selectManagerSubforms(content, isPromotionEnabled),
      answers,
      'Leader 可填范围',
      isPromotionEnabled,
    );
  }

  /**
   * 防伪造校验：每条作答的 (subformKey, dimensionKey, itemKey) 必须真实存在于
   * 员工可填的表单快照内容中，且载荷组件与评估项类型匹配。
   */
  private validateAnswers(
    content: FormSnapshotContent,
    isPromotionEnabled: boolean,
    answers: EvaluationItemAnswerDto[],
  ): ResolvedAnswer[] {
    const allowed = this.selectEmployeeSubforms(content, isPromotionEnabled);
    return this.validateAnswersInSubforms(
      content,
      allowed,
      answers,
      '员工可填范围',
      isPromotionEnabled,
    );
  }

  private validateAnswersInSubforms(
    content: FormSnapshotContent,
    allowed: readonly FormSnapshotSubform[],
    answers: EvaluationItemAnswerDto[],
    scopeLabel: string,
    isPromotionEnabled = false,
  ): ResolvedAnswer[] {
    const seenKeys = new Set<string>();
    return answers.map((answer) => {
      const subform = content.subforms.find(
        (candidate) => candidate.key === answer.subformKey,
      );
      if (subform?.type === 'PROMOTION' && !isPromotionEnabled) {
        throw new BadRequestException('未启用晋升评估，不能填写晋升评估内容');
      }
      const allowedSubform = allowed.find(
        (candidate) => candidate.key === answer.subformKey,
      );
      const dimension = allowedSubform?.dimensions.find(
        (candidate: FormSnapshotDimension) =>
          candidate.key === answer.dimensionKey,
      );
      const item = dimension?.items.find(
        (candidate) => candidate.key === answer.itemKey,
      );
      if (!allowedSubform || !dimension || !item) {
        throw new BadRequestException(
          `评估项 ${answer.itemKey} 不存在于当前表单快照的${scopeLabel}`,
        );
      }
      if (seenKeys.has(answer.itemKey)) {
        throw new BadRequestException(`评估项 ${item.title} 重复提交`);
      }
      seenKeys.add(answer.itemKey);
      this.assertPayloadMatchesType(item, answer);
      return { answer, item };
    });
  }

  /** 类型匹配：RATING 项只收 rawLevel，SCORE 项只收 rawScore，非计分项只收 value */
  private assertPayloadMatchesType(
    item: FormSnapshotItem,
    answer: EvaluationItemAnswerDto,
  ) {
    const has = {
      rawLevel: answer.rawLevel !== undefined,
      rawScore: answer.rawScore !== undefined,
      value: answer.value !== undefined,
    };
    const reject = () => {
      throw new BadRequestException(
        `评估项「${item.title}」为 ${item.type} 类型，提交的内容载荷与类型不匹配`,
      );
    };
    if (item.type === PerfFormItemType.RATING) {
      if (has.rawScore || has.value) reject();
    } else if (item.type === PerfFormItemType.SCORE) {
      if (has.rawLevel || has.value) reject();
    } else if (has.rawLevel || has.rawScore) {
      reject();
    }
  }

  /** 首次提交完整性：员工可填范围内全部 required 项必须给出有效作答 */
  private assertComplete(
    content: FormSnapshotContent,
    isPromotionEnabled: boolean,
    resolved: ResolvedAnswer[],
  ) {
    this.assertSubformsComplete(
      this.selectEmployeeSubforms(content, isPromotionEnabled),
      resolved,
    );
  }

  assertSubformsComplete(
    subforms: readonly FormSnapshotSubform[],
    resolved: ResolvedAnswer[],
  ) {
    const answeredKeys = new Set(
      resolved
        .filter((entry) => this.isAnswered(entry))
        .map((entry) => entry.item.key),
    );
    for (const subform of subforms) {
      for (const dimension of subform.dimensions) {
        for (const item of dimension.items) {
          if (item.required && !answeredKeys.has(item.key)) {
            throw new BadRequestException(
              `必填评估项「${item.title}」尚未填写，无法提交`,
            );
          }
        }
      }
    }
  }

  /** 是否给出有效作答：空字符串/空数组视为未作答 */
  private isAnswered({ answer, item }: ResolvedAnswer) {
    if (item.type === PerfFormItemType.RATING) {
      return answer.rawLevel !== undefined;
    }
    if (item.type === PerfFormItemType.SCORE) {
      return answer.rawScore !== undefined;
    }
    const value = answer.value;
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }

  /**
   * 计算分（ADR-0008/0018）：RATING = 周期配置快照中该评级的映射分；
   * SCORE = 原始分数；非计分项无计算分。
   */
  calculationScoreOf(
    { answer, item }: ResolvedAnswer,
    ratings: Array<{ symbol: string; mappingScore: string }>,
  ): string | number | null {
    if (item.type === PerfFormItemType.RATING) {
      const rating = ratings.find(
        (candidate) => candidate.symbol === answer.rawLevel,
      );
      if (!rating?.mappingScore) {
        throw new ConflictException(
          `周期评级配置缺少评级 ${answer.rawLevel} 的映射分，无法提交`,
        );
      }
      return rating.mappingScore;
    }
    if (item.type === PerfFormItemType.SCORE) {
      return answer.rawScore!;
    }
    return null;
  }

  toItemRow(
    { answer, item }: ResolvedAnswer,
    formSnapshotId: number,
    calculationScore: string | number | null,
  ) {
    return {
      formSnapshotId,
      subformKey: answer.subformKey,
      dimensionKey: answer.dimensionKey,
      itemKey: answer.itemKey,
      itemType: item.type as PerfFormItemType,
      rawLevel: answer.rawLevel ?? null,
      rawScore: answer.rawScore ?? null,
      calculationScore,
      value:
        answer.value === undefined
          ? undefined
          : (answer.value as Prisma.InputJsonValue),
    };
  }

  /** 明细整体替换：先清空该提交的全部明细再批量写入（同一事务内调用） */
  async replaceItems(
    tx: Prisma.TransactionClient,
    submissionId: number,
    rows: Array<ReturnType<EvaluationSubmissionService['toItemRow']>>,
  ) {
    await tx.perfEvaluationItemResult.deleteMany({ where: { submissionId } });
    if (rows.length > 0) {
      await tx.perfEvaluationItemResult.createMany({
        data: rows.map((row) => ({ ...row, submissionId })),
      });
    }
  }
}
