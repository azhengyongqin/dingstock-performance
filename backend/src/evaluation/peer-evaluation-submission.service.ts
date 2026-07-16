import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  PerfAssignmentStatus,
  PerfEvaluationTaskType,
  PerfReviewStatus,
} from '../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { EvaluationTaskAccessService } from '../cycle/evaluation-task-access.service';
import { PrismaService } from '../shared/database/prisma.service';
import type { SavePeerEvaluationDto } from './evaluation.dto';
import { EvaluationSubmissionService } from './evaluation-submission.service';
import { PeerStageResultService } from './peer-stage-result.service';
import { AiReportService } from '../ai-report/ai-report.service';
import { ParticipantEvaluationLockService } from '../participant/participant-evaluation-lock.service';

/**
 * 360°评估提交服务：负责评审指派鉴权、PEER 上下文和答卷生命周期。
 * 表单快照校验与明细替换复用统一提交策略，避免 SELF/PEER 出现两套判定口径。
 */
@Injectable()
export class PeerEvaluationSubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly taskAccessService: EvaluationTaskAccessService,
    private readonly submissionPolicy: EvaluationSubmissionService,
    private readonly peerStageResultService: PeerStageResultService,
    private readonly aiReportService: AiReportService,
    private readonly participantEvaluationLockService: ParticipantEvaluationLockService,
  ) {}

  /** 先做对象级鉴权，再允许触发任务开放等有副作用的操作。 */
  private async requirePeerAssignment(
    reviewerOpenId: string,
    assignmentId: number,
  ) {
    const assignment = await this.prisma.perfReviewerAssignment.findFirst({
      where: {
        id: assignmentId,
        reviewerOpenId,
        status: { not: PerfAssignmentStatus.REPLACED },
      },
      include: {
        participant: {
          include: {
            formSnapshot: { select: { id: true, content: true } },
            cycle: {
              include: {
                currentConfigVersion: { select: { ratings: true } },
              },
            },
          },
        },
      },
    });
    if (!assignment || assignment.participant.cycle.deletedAt) {
      throw new ForbiddenException('你没有该员工的有效 360°评审任务');
    }
    return assignment;
  }

  /** 只下发被评人基础信息与 PEER 子表单，PROMOTION 永不进入此边界。 */
  async getPeerContext(reviewerOpenId: string, assignmentId: number) {
    const assignment = await this.requirePeerAssignment(
      reviewerOpenId,
      assignmentId,
    );
    const { participant } = assignment;
    const task = await this.taskAccessService.openIfDue(
      participant.id,
      PerfEvaluationTaskType.PEER,
    );
    const cycle = {
      id: participant.cycle.id,
      name: participant.cycle.name,
      status: participant.cycle.status,
      currentConfigVersion: participant.cycle.currentConfigVersion,
    };
    if (!task?.openedAt) {
      return {
        assignment: this.toPublicAssignment(assignment),
        participant: { id: participant.id, cycleId: participant.cycleId },
        cycle,
        employee: null,
        task,
        form: null,
        submitted: null,
        draft: null,
        state: null,
        selfEvaluation: null,
      };
    }

    const content = this.submissionPolicy.requireSnapshotContent(participant);
    // 提交唯一性按“参与者 + 阶段 + 评审员”约束；重新指派同一人时继续读取其有效答卷。
    const [submissions, selfEvaluation, employee] = await Promise.all([
      this.prisma.perfEvaluationSubmission.findMany({
        where: {
          participantId: participant.id,
          stage: PerfEvaluationTaskType.PEER,
          reviewerOpenId,
        },
        include: { items: true },
      }),
      // 左侧参考区展示员工已生效自评摘要（只读，不参与 360° 计分）
      this.prisma.perfEvaluationSubmission.findFirst({
        where: {
          participantId: participant.id,
          stage: PerfEvaluationTaskType.SELF,
          status: PerfReviewStatus.SUBMITTED,
        },
        include: { items: true },
      }),
      this.prisma.larkUser.findUnique({
        where: { open_id: participant.employeeOpenId },
        select: { open_id: true, name: true, avatar: true, job_title: true },
      }),
    ]);
    const submitted =
      submissions.find((item) => item.status === PerfReviewStatus.SUBMITTED) ??
      null;
    const draft =
      submissions.find((item) => item.status === PerfReviewStatus.DRAFT) ??
      null;

    return {
      assignment: this.toPublicAssignment(assignment),
      participant: { id: participant.id, cycleId: participant.cycleId },
      cycle,
      employee,
      task,
      form: {
        formSnapshotId: participant.formSnapshotId,
        subforms: this.submissionPolicy.selectPeerSubforms(content),
      },
      submitted,
      draft,
      state: submitted ? (draft ? 'PENDING_RESUBMIT' : 'EFFECTIVE') : 'DRAFT',
      selfEvaluation,
    };
  }

  /** 保存不完整 PEER 草稿；已有 SUBMITTED 时仍只写独立 DRAFT 行。 */
  async savePeerDraft(reviewerOpenId: string, dto: SavePeerEvaluationDto) {
    const assignment = await this.requirePeerAssignment(
      reviewerOpenId,
      dto.assignmentId,
    );
    const { participant } = assignment;
    const content = this.submissionPolicy.requireSnapshotContent(participant);
    const resolved = this.submissionPolicy.validatePeerAnswers(
      content,
      dto.items,
    );
    await this.taskAccessService.ensureWritable(
      participant.id,
      PerfEvaluationTaskType.PEER,
    );
    const rows = resolved.map((entry) =>
      this.submissionPolicy.toItemRow(entry, participant.formSnapshotId!, null),
    );

    return this.prisma.$transaction(async (tx) => {
      await this.participantEvaluationLockService.lockHumanWrite(
        tx,
        participant.id,
      );
      // no-op 字段更新用于锁定有效指派；替换已先提交时 count=0，旧评审员不能继续写草稿。
      const assignmentClaim = await tx.perfReviewerAssignment.updateMany({
        where: {
          id: assignment.id,
          reviewerOpenId,
          status: { not: PerfAssignmentStatus.REPLACED },
        },
        data: { updatedAt: new Date() },
      });
      if (assignmentClaim.count !== 1) {
        throw new ConflictException('评审关系已被替换，请刷新任务列表');
      }
      const existing = await tx.perfEvaluationSubmission.findFirst({
        where: {
          participantId: participant.id,
          stage: PerfEvaluationTaskType.PEER,
          reviewerOpenId,
          status: PerfReviewStatus.DRAFT,
        },
      });
      let submission = existing;
      if (submission) {
        // 同一评审员被替换后再次指派时复用唯一草稿，并切换到当前有效指派。
        submission = await tx.perfEvaluationSubmission.update({
          where: { id: submission.id },
          data: { reviewerAssignmentId: assignment.id },
        });
      } else {
        try {
          submission = await tx.perfEvaluationSubmission.create({
            data: {
              cycleId: participant.cycleId,
              participantId: participant.id,
              stage: PerfEvaluationTaskType.PEER,
              reviewerOpenId,
              reviewerAssignmentId: assignment.id,
              formSnapshotId: participant.formSnapshotId!,
              status: PerfReviewStatus.DRAFT,
            },
          });
        } catch (error) {
          this.submissionPolicy.mapDuplicateSubmissionError(
            error,
            'active_draft_key',
            '保存冲突：已有并发保存的 360°草稿，请重试',
          );
        }
      }
      await this.submissionPolicy.replaceItems(tx, submission.id, rows);
      return submission;
    });
  }

  /** 完整校验后原子替换生效明细，并删除临时更新草稿。 */
  async submitPeer(reviewerOpenId: string, dto: SavePeerEvaluationDto) {
    const assignment = await this.requirePeerAssignment(
      reviewerOpenId,
      dto.assignmentId,
    );
    const { participant } = assignment;
    const content = this.submissionPolicy.requireSnapshotContent(participant);
    const resolved = this.submissionPolicy.validatePeerAnswers(
      content,
      dto.items,
    );
    this.submissionPolicy.assertSubformsComplete(
      this.submissionPolicy.selectPeerSubforms(content),
      resolved,
    );
    const ratings = this.submissionPolicy.requireRatings(participant);
    await this.taskAccessService.ensureWritable(
      participant.id,
      PerfEvaluationTaskType.PEER,
    );
    const rows = resolved.map((entry) =>
      this.submissionPolicy.toItemRow(
        entry,
        participant.formSnapshotId!,
        this.submissionPolicy.calculationScoreOf(entry, ratings),
      ),
    );
    const submittedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      await this.participantEvaluationLockService.lockHumanWrite(
        tx,
        participant.id,
      );
      // 与显式替换竞争同一指派：替换先完成时 count=0，旧评审员不能复活权限。
      const assignmentClaim = await tx.perfReviewerAssignment.updateMany({
        where: {
          id: assignment.id,
          reviewerOpenId,
          status: { not: PerfAssignmentStatus.REPLACED },
        },
        data: { status: PerfAssignmentStatus.SUBMITTED },
      });
      if (assignmentClaim.count !== 1) {
        throw new ConflictException('评审关系已被替换，请刷新任务列表');
      }
      const existing = await tx.perfEvaluationSubmission.findFirst({
        where: {
          participantId: participant.id,
          stage: PerfEvaluationTaskType.PEER,
          reviewerOpenId,
          status: PerfReviewStatus.SUBMITTED,
        },
      });
      let submission: Awaited<
        ReturnType<typeof tx.perfEvaluationSubmission.update>
      >;
      if (existing) {
        submission = await tx.perfEvaluationSubmission.update({
          where: { id: existing.id },
          // 同一评审员重新获指派时，唯一生效提交迁移到当前指派。
          data: {
            reviewerAssignmentId: assignment.id,
            formSnapshotId: participant.formSnapshotId!,
            submittedAt,
            submittedByOpenId: reviewerOpenId,
          },
        });
      } else {
        try {
          submission = await tx.perfEvaluationSubmission.create({
            data: {
              cycleId: participant.cycleId,
              participantId: participant.id,
              stage: PerfEvaluationTaskType.PEER,
              reviewerOpenId,
              reviewerAssignmentId: assignment.id,
              formSnapshotId: participant.formSnapshotId!,
              status: PerfReviewStatus.SUBMITTED,
              submittedAt,
              submittedByOpenId: reviewerOpenId,
            },
          });
        } catch (error) {
          this.submissionPolicy.mapDuplicateSubmissionError(
            error,
            'active_submitted_key',
            '提交冲突：已有并发 360°提交生效，请重试',
          );
        }
      }
      await this.submissionPolicy.replaceItems(tx, submission.id, rows);
      await tx.perfEvaluationSubmission.deleteMany({
        where: {
          participantId: participant.id,
          stage: PerfEvaluationTaskType.PEER,
          reviewerOpenId,
          status: PerfReviewStatus.DRAFT,
        },
      });
      // 答卷与阶段结果同事务生效，任何计算失败都会回滚本次提交/重新提交。
      await this.peerStageResultService.recalculate(participant.id, tx);
      await this.aiReportService.refreshForParticipant(participant.id, tx);
      const pending = await tx.perfReviewerAssignment.count({
        where: {
          participantId: participant.id,
          status: PerfAssignmentStatus.PENDING,
        },
      });
      if (pending === 0) {
        await tx.perfEvaluationTask.update({
          where: {
            participantId_type: {
              participantId: participant.id,
              type: PerfEvaluationTaskType.PEER,
            },
          },
          data: { completedAt: submittedAt },
        });
      }
    });

    await this.auditService.record({
      operatorOpenId: reviewerOpenId,
      action: 'evaluation.peer.submit',
      targetType: 'perf_reviewer_assignment',
      targetId: String(assignment.id),
    });
    return { ok: true };
  }

  private toPublicAssignment(assignment: {
    id: number;
    relation: unknown;
    status: unknown;
  }) {
    return {
      id: assignment.id,
      relation: assignment.relation,
      status: assignment.status,
    };
  }
}
