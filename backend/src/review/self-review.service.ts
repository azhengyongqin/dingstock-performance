import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
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

/** 员工自评（产品 §5.3）：员工只能操作"自己在指定周期"的记录 */
@Injectable()
export class SelfReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly participantService: ParticipantService,
    private readonly rbacService: RbacService,
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
      include: { cycle: true, selfReview: true },
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
      dimensions,
      evaluationRule,
    };
  }

  /** 草稿保存（自动保存调用）；提交后仅在被退回时可再编辑 */
  async saveDraft(employeeOpenId: string, dto: SaveSelfReviewDto) {
    const participant = await this.findMyParticipant(
      employeeOpenId,
      dto.cycleId,
    );
    if (!participant) throw new NotFoundException('你不在本周期考核名单中');
    if (
      participant.status !== PerfParticipantStatus.PENDING_SELF_REVIEW &&
      participant.status !== PerfParticipantStatus.RETURNED
    ) {
      throw new ConflictException('自评已提交，不可修改');
    }

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
    const selfReview = participant.selfReview;
    if (!selfReview) throw new ConflictException('尚未填写自评内容');

    await this.prisma.perfSelfReview.update({
      where: { id: selfReview.id },
      data: { status: PerfSelfReviewStatus.SUBMITTED, submittedAt: new Date() },
    });
    await this.participantService.transition(
      employeeOpenId,
      participant.id,
      PerfParticipantStatus.SELF_SUBMITTED,
    );
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
