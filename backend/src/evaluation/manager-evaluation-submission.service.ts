import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PerfEvaluationTaskType,
  PerfReviewStatus,
} from '../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { EvaluationTaskAccessService } from '../cycle/evaluation-task-access.service';
import { PrismaService } from '../shared/database/prisma.service';
import type { SaveManagerEvaluationDto } from './evaluation.dto';
import { EvaluationSubmissionService } from './evaluation-submission.service';
import { ManagerStageResultService } from './manager-stage-result.service';
import { PeerStageResultService } from './peer-stage-result.service';

/**
 * 上级评估提交服务：以参与者的当前 Leader 快照作为唯一写入权限，复用统一
 * 人工答卷模型，并在正式提交事务内生成校准前权威 MANAGER 阶段等级。
 */
@Injectable()
export class ManagerEvaluationSubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly taskAccessService: EvaluationTaskAccessService,
    private readonly submissionPolicy: EvaluationSubmissionService,
    private readonly peerStageResultService: PeerStageResultService,
    private readonly managerStageResultService: ManagerStageResultService,
  ) {}

  /** 必须先完成对象级 Leader 鉴权，才允许触发任务开放等有副作用的读取。 */
  private async requireManagedParticipant(
    leaderOpenId: string,
    participantId: number,
  ) {
    const participant = await this.prisma.perfParticipant.findUnique({
      where: { id: participantId },
      include: {
        formSnapshot: { select: { id: true, content: true } },
        cycle: {
          include: {
            currentConfigVersion: { select: { ratings: true } },
          },
        },
      },
    });
    if (!participant || participant.cycle.deletedAt) {
      throw new NotFoundException('参与者不存在');
    }
    if (participant.leaderOpenIdSnapshot !== leaderOpenId) {
      // HR/Admin 也不能代填；写权限只认当前考核 Leader 快照。
      throw new ForbiddenException(
        '只有当前直属 Leader 可以填写该员工的上级评估',
      );
    }
    return participant;
  }

  /** 动态表单、当前答卷及允许给 Leader 查看但不参与 MANAGER 计算的参考信息。 */
  async getManagerContext(leaderOpenId: string, participantId: number) {
    const participant = await this.requireManagedParticipant(
      leaderOpenId,
      participantId,
    );
    const task = await this.taskAccessService.openIfDue(
      participant.id,
      PerfEvaluationTaskType.MANAGER,
    );
    const cycle = {
      id: participant.cycle.id,
      name: participant.cycle.name,
      status: participant.cycle.status,
      currentConfigVersion: participant.cycle.currentConfigVersion,
    };
    if (!task?.openedAt) {
      return {
        participant: {
          id: participant.id,
          cycleId: participant.cycleId,
          isPromotionEnabled: participant.isPromotionEnabled,
        },
        cycle,
        employee: null,
        task,
        form: null,
        submitted: null,
        draft: null,
        state: null,
        selfEvaluation: null,
        peerResult: null,
        managerResult: null,
        history: [],
      };
    }

    const content = this.submissionPolicy.requireSnapshotContent(participant);
    const submissions = await this.prisma.perfEvaluationSubmission.findMany({
      where: {
        participantId: participant.id,
        stage: {
          in: [PerfEvaluationTaskType.SELF, PerfEvaluationTaskType.MANAGER],
        },
      },
      include: { items: true },
    });
    const managerSubmissions = submissions.filter(
      (submission) => submission.stage === PerfEvaluationTaskType.MANAGER,
    );
    const submitted =
      managerSubmissions.find(
        (submission) => submission.status === PerfReviewStatus.SUBMITTED,
      ) ?? null;
    const draft =
      managerSubmissions.find(
        (submission) => submission.status === PerfReviewStatus.DRAFT,
      ) ?? null;
    const selfEvaluation =
      submissions.find(
        (submission) =>
          submission.stage === PerfEvaluationTaskType.SELF &&
          submission.status === PerfReviewStatus.SUBMITTED,
      ) ?? null;
    const [employee, peerResult, history] = await Promise.all([
      this.prisma.larkUser.findUnique({
        where: { open_id: participant.employeeOpenId },
        select: {
          open_id: true,
          name: true,
          avatar: true,
          job_title: true,
        },
      }),
      this.peerStageResultService.recalculate(participant.id),
      this.prisma.perfResult.findMany({
        where: {
          participant: {
            employeeOpenId: participant.employeeOpenId,
            cycleId: { not: participant.cycleId },
          },
          archivedAt: { not: null },
        },
        select: {
          finalLevel: true,
          promotionResult: true,
          participant: {
            select: { cycle: { select: { id: true, name: true } } },
          },
        },
        orderBy: { id: 'desc' },
        take: 6,
      }),
    ]);
    const managerResult = submitted
      ? await this.managerStageResultService.recalculate(participant.id)
      : null;

    return {
      participant: {
        id: participant.id,
        cycleId: participant.cycleId,
        isPromotionEnabled: participant.isPromotionEnabled,
      },
      cycle,
      employee,
      task,
      form: {
        formSnapshotId: participant.formSnapshotId,
        subforms: this.submissionPolicy.selectManagerSubforms(
          content,
          participant.isPromotionEnabled,
        ),
      },
      submitted,
      draft,
      state: submitted ? (draft ? 'PENDING_RESUBMIT' : 'EFFECTIVE') : 'DRAFT',
      selfEvaluation,
      peerResult,
      managerResult,
      history,
    };
  }

  /** 权威结果查询同样只允许当前 Leader，避免管理角色借查询接口扩大代填边界。 */
  async getManagerResult(leaderOpenId: string, participantId: number) {
    await this.requireManagedParticipant(leaderOpenId, participantId);
    return this.managerStageResultService.recalculate(participantId);
  }

  /** 保存不完整的独立更新草稿，不覆盖当前生效答卷和权威阶段结果。 */
  async saveManagerDraft(leaderOpenId: string, dto: SaveManagerEvaluationDto) {
    const participant = await this.requireManagedParticipant(
      leaderOpenId,
      dto.participantId,
    );
    const content = this.submissionPolicy.requireSnapshotContent(participant);
    const resolved = this.submissionPolicy.validateManagerAnswers(
      content,
      participant.isPromotionEnabled,
      dto.items,
    );
    await this.taskAccessService.ensureWritable(
      participant.id,
      PerfEvaluationTaskType.MANAGER,
    );
    const rows = resolved.map((entry) =>
      this.submissionPolicy.toItemRow(entry, participant.formSnapshotId!, null),
    );

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.perfEvaluationSubmission.findFirst({
        where: {
          participantId: participant.id,
          stage: PerfEvaluationTaskType.MANAGER,
          reviewerOpenId: leaderOpenId,
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
              stage: PerfEvaluationTaskType.MANAGER,
              reviewerOpenId: leaderOpenId,
              formSnapshotId: participant.formSnapshotId!,
              status: PerfReviewStatus.DRAFT,
            },
          });
        } catch (error) {
          this.submissionPolicy.mapDuplicateSubmissionError(
            error,
            'active_draft_key',
            '保存冲突：已有并发保存的上级评估草稿，请重试',
          );
        }
      }
      await this.submissionPolicy.replaceItems(tx, submission.id, rows);
      return submission;
    });
  }

  /** 完整提交并原子生成 MANAGER 阶段权威结果；请求体没有人工初评等级字段。 */
  async submitManager(leaderOpenId: string, dto: SaveManagerEvaluationDto) {
    const participant = await this.requireManagedParticipant(
      leaderOpenId,
      dto.participantId,
    );
    const content = this.submissionPolicy.requireSnapshotContent(participant);
    const allowedSubforms = this.submissionPolicy.selectManagerSubforms(
      content,
      participant.isPromotionEnabled,
    );
    const resolved = this.submissionPolicy.validateManagerAnswers(
      content,
      participant.isPromotionEnabled,
      dto.items,
    );
    this.submissionPolicy.assertSubformsComplete(allowedSubforms, resolved);
    const ratings = this.submissionPolicy.requireRatings(participant);
    await this.taskAccessService.ensureWritable(
      participant.id,
      PerfEvaluationTaskType.MANAGER,
    );
    const rows = resolved.map((entry) =>
      this.submissionPolicy.toItemRow(
        entry,
        participant.formSnapshotId!,
        this.submissionPolicy.calculationScoreOf(entry, ratings),
      ),
    );
    const submittedAt = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.perfEvaluationSubmission.findFirst({
        where: {
          participantId: participant.id,
          stage: PerfEvaluationTaskType.MANAGER,
          reviewerOpenId: leaderOpenId,
          status: PerfReviewStatus.SUBMITTED,
        },
      });
      let submission: Awaited<
        ReturnType<typeof tx.perfEvaluationSubmission.update>
      >;
      if (existing) {
        submission = await tx.perfEvaluationSubmission.update({
          where: { id: existing.id },
          data: { submittedAt, submittedByOpenId: leaderOpenId },
        });
      } else {
        try {
          submission = await tx.perfEvaluationSubmission.create({
            data: {
              cycleId: participant.cycleId,
              participantId: participant.id,
              stage: PerfEvaluationTaskType.MANAGER,
              reviewerOpenId: leaderOpenId,
              formSnapshotId: participant.formSnapshotId!,
              status: PerfReviewStatus.SUBMITTED,
              submittedAt,
              submittedByOpenId: leaderOpenId,
            },
          });
        } catch (error) {
          this.submissionPolicy.mapDuplicateSubmissionError(
            error,
            'active_submitted_key',
            '提交冲突：已有并发上级评估提交生效，请重试',
          );
        }
      }
      await this.submissionPolicy.replaceItems(tx, submission.id, rows);
      await tx.perfEvaluationSubmission.deleteMany({
        where: {
          participantId: participant.id,
          stage: PerfEvaluationTaskType.MANAGER,
          reviewerOpenId: leaderOpenId,
          status: PerfReviewStatus.DRAFT,
        },
      });
      const stageResult = await this.managerStageResultService.recalculate(
        participant.id,
        tx,
      );
      if (stageResult.status !== 'READY') {
        throw new ConflictException('上级评估提交后未能生成权威阶段等级');
      }
      await tx.perfEvaluationTask.update({
        where: {
          participantId_type: {
            participantId: participant.id,
            type: PerfEvaluationTaskType.MANAGER,
          },
        },
        data: { completedAt: submittedAt },
      });
      return stageResult;
    });

    await this.auditService.record({
      operatorOpenId: leaderOpenId,
      action: 'evaluation.manager.submit',
      targetType: 'perf_participant',
      targetId: String(participant.id),
      after: {
        compositeScore: result.compositeScore,
        initialLevel: result.initialLevel,
        stageLevel: result.stageLevel,
      },
    });
    return { ok: true, result };
  }
}
