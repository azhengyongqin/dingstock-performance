import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PerfEvaluationTaskType,
  PerfParticipantStatus,
  PerfRole,
  PerfSelfReviewStatus,
} from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../shared/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ParticipantService } from '../participant/participant.service';
import { RbacService } from '../rbac/rbac.service';
import type { SaveSelfReviewDto } from './review.dto';
import { EvaluationTaskAccessService } from '../cycle/evaluation-task-access.service';

/** 员工自评（产品 §5.3）：员工只能操作"自己在指定周期"的记录 */
@Injectable()
export class SelfReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly participantService: ParticipantService,
    private readonly rbacService: RbacService,
    private readonly taskAccessService: EvaluationTaskAccessService,
  ) {}

  /** 找到我在指定周期（或最近一个进行中周期）的参与记录 */
  private async findMyParticipant(employeeOpenId: string, cycleId?: number) {
    const participant = await this.prisma.perfParticipant.findFirst({
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
        cycle: true,
        selfReview: true,
        evaluationTasks: {
          where: { type: PerfEvaluationTaskType.SELF },
          take: 1,
        },
      },
    });
    return participant;
  }

  /** 当前自评上下文：参与记录 + 自评草稿 + 员工可见/可填维度 + 评估规则 */
  async getCurrent(employeeOpenId: string, cycleId?: number) {
    const participant = await this.findMyParticipant(employeeOpenId, cycleId);
    if (!participant) {
      return {
        participant: null,
        selfReview: null,
        task: null,
        dimensions: [],
        evaluationRule: null,
      };
    }

    // 员工身份已由 participant 查询确认，此后才允许惰性写入开放事实与通知事件。
    const task = await this.taskAccessService.openIfDue(
      participant.id,
      PerfEvaluationTaskType.SELF,
    );
    if (!task?.openedAt) {
      // 开始前只展示任务预告，不下发表单结构与评级规则。
      return {
        participant,
        selfReview: participant.selfReview,
        task,
        dimensions: [],
        evaluationRule: null,
      };
    }

    const dimensions = await this.prisma.perfDimension.findMany({
      where: {
        cycleId: participant.cycleId,
        deletedAt: null,
        editableRoles: { has: PerfRole.EMPLOYEE },
        // 晋升维度仅对启用晋升评估的参与者展示
        ...(participant.isPromotionEnabled
          ? {}
          : { type: { not: 'PROMOTION' } }),
      },
      orderBy: { sortOrder: 'asc' },
    });
    const evaluationRule = await this.prisma.perfEvaluationRule.findUnique({
      where: { cycleId: participant.cycleId },
    });
    return {
      participant,
      selfReview: participant.selfReview,
      task,
      dimensions,
      evaluationRule,
    };
  }

  /** 草稿保存（自动保存调用）；首次校准前允许原填写人持续修改 */
  async saveDraft(employeeOpenId: string, dto: SaveSelfReviewDto) {
    const participant = await this.findMyParticipant(
      employeeOpenId,
      dto.cycleId,
    );
    if (!participant) throw new NotFoundException('你不在本周期考核名单中');
    await this.taskAccessService.ensureWritable(
      participant.id,
      PerfEvaluationTaskType.SELF,
    );

    const data = {
      okrContent: dto.okrContent as Prisma.InputJsonValue | undefined,
      summary: dto.summary as Prisma.InputJsonValue | undefined,
      promotionSelfReview: dto.promotionSelfReview as
        Prisma.InputJsonValue | undefined,
      attachments: dto.attachments as unknown as
        Prisma.InputJsonValue | undefined,
      documentToken: dto.documentToken,
      status: PerfSelfReviewStatus.DRAFT,
    };
    return this.prisma.perfSelfReview.upsert({
      where: { participantId: participant.id },
      create: { ...data, participantId: participant.id },
      update: data,
    });
  }

  /** 提交自评：参与者 → SELF_SUBMITTED（含退回后重新提交） */
  async submit(employeeOpenId: string, cycleId: number) {
    const participant = await this.findMyParticipant(employeeOpenId, cycleId);
    if (!participant) throw new NotFoundException('你不在本周期考核名单中');
    await this.taskAccessService.ensureWritable(
      participant.id,
      PerfEvaluationTaskType.SELF,
    );
    const selfReview = participant.selfReview;
    if (!selfReview) throw new ConflictException('尚未填写自评内容');

    const completedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.perfSelfReview.update({
        where: { id: selfReview.id },
        data: {
          status: PerfSelfReviewStatus.SUBMITTED,
          submittedAt: completedAt,
        },
      }),
      this.prisma.perfEvaluationTask.update({
        where: {
          participantId_type: {
            participantId: participant.id,
            type: PerfEvaluationTaskType.SELF,
          },
        },
        data: { completedAt },
      }),
    ]);
    if (
      participant.status === PerfParticipantStatus.PENDING_SELF_REVIEW ||
      participant.status === PerfParticipantStatus.RETURNED
    ) {
      // 重新提交不能回退已经推进到评审/AI 的参与者进度。
      await this.participantService.transition(
        employeeOpenId,
        participant.id,
        PerfParticipantStatus.SELF_SUBMITTED,
      );
    }
    await this.auditService.record({
      operatorOpenId: employeeOpenId,
      action: 'self_review.submit',
      targetType: 'perf_participant',
      targetId: String(participant.id),
    });
    return { ok: true };
  }

  /** 退回自评（Leader/HR）：自评置 RETURNED，参与者回到可编辑态 */
  async returnSelfReview(
    operatorOpenId: string,
    participantId: number,
    reason: string,
  ) {
    const participant = await this.prisma.perfParticipant.findUnique({
      where: { id: participantId },
      include: { selfReview: true },
    });
    if (!participant?.selfReview) throw new NotFoundException('自评记录不存在');

    const isLeader = participant.leaderOpenIdSnapshot === operatorOpenId;
    const isHr = await this.rbacService.hasAnyRole(operatorOpenId, [
      PerfRole.HR,
      PerfRole.ADMIN,
    ]);
    if (!isLeader && !isHr)
      throw new ForbiddenException('仅直属 Leader 或 HR 可退回自评');

    await this.prisma.perfSelfReview.update({
      where: { id: participant.selfReview.id },
      data: { status: PerfSelfReviewStatus.RETURNED, returnReason: reason },
    });
    await this.participantService.transition(
      operatorOpenId,
      participantId,
      PerfParticipantStatus.RETURNED,
      reason,
    );
    return { ok: true };
  }
}
