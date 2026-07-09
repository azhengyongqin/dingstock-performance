import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PerfAssignmentStatus,
  PerfParticipantStatus,
  PerfReviewStatus,
  PerfRole,
  PerfSelfReviewStatus,
} from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../shared/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { hasRatingSymbol } from '../cycle/evaluation-rule';
import { ParticipantService } from '../participant/participant.service';
import type { SaveManagerReviewDto, SaveReviewDto } from './review.dto';

/** 我的评审任务条目：360° 与上级评估共用任务模型（研发文档 §8.3），按 taskType 区分 */
export type ReviewTaskItem = {
  taskType: 'REVIEW' | 'MANAGER_REVIEW';
  participantId: number;
  assignmentId?: number;
  relation?: string;
  status: 'PENDING' | 'SUBMITTED';
  submittedAt?: Date | null;
  cycle: { id: number; name: string; status: string };
  employee: {
    open_id: string;
    name?: string;
    avatar?: unknown;
    job_title?: string | null;
  } | null;
};

@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly participantService: ParticipantService,
  ) {}

  // ---------------------------------------------------------------------
  // 我的评审任务
  // ---------------------------------------------------------------------

  async listMyTasks(
    reviewerOpenId: string,
  ): Promise<{ items: ReviewTaskItem[]; total: number }> {
    // 360° 任务：我的有效指派
    const assignments = await this.prisma.perfReviewerAssignment.findMany({
      where: {
        reviewerOpenId,
        status: { not: PerfAssignmentStatus.REPLACED },
        cycle: { deletedAt: null, status: { notIn: ['DRAFT', 'PENDING'] } },
      },
      include: {
        participant: true,
        cycle: { select: { id: true, name: true, status: true } },
      },
      orderBy: { id: 'desc' },
    });

    // 上级评估任务：以我为 Leader 快照的参与者（周期进行中）
    const managed = await this.prisma.perfParticipant.findMany({
      where: {
        leaderOpenIdSnapshot: reviewerOpenId,
        cycle: {
          deletedAt: null,
          status: { notIn: ['DRAFT', 'PENDING', 'ARCHIVED'] },
        },
      },
      include: {
        managerReview: { select: { status: true, submittedAt: true } },
        cycle: { select: { id: true, name: true, status: true } },
      },
      orderBy: { id: 'desc' },
    });

    const employeeIds = [
      ...new Set([
        ...assignments.map((a) => a.participant.employeeOpenId),
        ...managed.map((p) => p.employeeOpenId),
      ]),
    ];
    const users = await this.prisma.larkUser.findMany({
      where: { open_id: { in: employeeIds } },
      select: { open_id: true, name: true, avatar: true, job_title: true },
    });
    const userMap = new Map(users.map((u) => [u.open_id, u]));

    const items: ReviewTaskItem[] = [
      ...assignments.map<ReviewTaskItem>((assignment) => ({
        taskType: 'REVIEW',
        participantId: assignment.participantId,
        assignmentId: assignment.id,
        relation: assignment.relation,
        status:
          assignment.status === PerfAssignmentStatus.SUBMITTED
            ? 'SUBMITTED'
            : 'PENDING',
        cycle: assignment.cycle,
        employee: userMap.get(assignment.participant.employeeOpenId) ?? null,
      })),
      ...managed.map<ReviewTaskItem>((participant) => ({
        taskType: 'MANAGER_REVIEW',
        participantId: participant.id,
        status:
          participant.managerReview?.status === PerfReviewStatus.SUBMITTED
            ? 'SUBMITTED'
            : 'PENDING',
        submittedAt: participant.managerReview?.submittedAt ?? null,
        cycle: participant.cycle,
        employee: userMap.get(participant.employeeOpenId) ?? null,
      })),
    ];
    return { items, total: items.length };
  }

  // ---------------------------------------------------------------------
  // 评估上下文（填写页左侧参考信息聚合，研发文档 §8.3 evaluation-context）
  // ---------------------------------------------------------------------

  async getContext(
    operatorOpenId: string,
    participantId: number,
    taskType: string,
  ) {
    const participant = await this.prisma.perfParticipant.findUnique({
      where: { id: participantId },
      include: {
        cycle: { include: { evaluationRule: true } },
        selfReview: true,
      },
    });
    if (!participant || participant.cycle.deletedAt)
      throw new NotFoundException('参与者不存在');

    const isManager = taskType === 'MANAGER_REVIEW';
    const role = isManager ? PerfRole.LEADER : PerfRole.REVIEWER;

    // 任务关系校验：360° 需有效指派；上级评估需 Leader 快照
    let myDraft: unknown = null;
    if (isManager) {
      if (participant.leaderOpenIdSnapshot !== operatorOpenId) {
        throw new ForbiddenException('你不是该员工的直属 Leader');
      }
      myDraft = await this.prisma.perfManagerReview.findUnique({
        where: { participantId },
      });
    } else {
      const assignment = await this.prisma.perfReviewerAssignment.findFirst({
        where: {
          participantId,
          reviewerOpenId: operatorOpenId,
          status: { not: PerfAssignmentStatus.REPLACED },
        },
      });
      if (!assignment) throw new ForbiddenException('你没有该员工的评审任务');
      myDraft = await this.prisma.perfReview.findUnique({
        where: {
          participantId_reviewerOpenId: {
            participantId,
            reviewerOpenId: operatorOpenId,
          },
        },
      });
    }

    const dimensions = await this.prisma.perfDimension.findMany({
      where: {
        cycleId: participant.cycleId,
        deletedAt: null,
        editableRoles: { has: role },
        ...(participant.isPromotionEnabled
          ? {}
          : { type: { not: 'PROMOTION' } }),
      },
      orderBy: { sortOrder: 'asc' },
    });

    const employee = await this.prisma.larkUser.findUnique({
      where: { open_id: participant.employeeOpenId },
      select: {
        open_id: true,
        name: true,
        avatar: true,
        job_title: true,
        department_ids: true,
      },
    });

    // 自评仅在已提交后对评审人可见
    const selfReview =
      participant.selfReview?.status === PerfSelfReviewStatus.SUBMITTED
        ? participant.selfReview
        : null;

    // 上级评估页额外聚合：已提交的 360° 评估 + 历史绩效
    let peerReviews: unknown[] = [];
    let history: unknown[] = [];
    if (isManager) {
      const reviews = await this.prisma.perfReview.findMany({
        where: { participantId, status: PerfReviewStatus.SUBMITTED },
      });
      const reviewerIds = [...new Set(reviews.map((r) => r.reviewerOpenId))];
      const reviewers = await this.prisma.larkUser.findMany({
        where: { open_id: { in: reviewerIds } },
        select: { open_id: true, name: true, avatar: true },
      });
      const reviewerMap = new Map(reviewers.map((u) => [u.open_id, u]));
      peerReviews = reviews.map((review) => ({
        ...review,
        reviewer: reviewerMap.get(review.reviewerOpenId) ?? null,
      }));

      history = await this.prisma.perfResult.findMany({
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
      });
    }

    return {
      participant: { ...participant, cycle: undefined },
      cycle: {
        id: participant.cycle.id,
        name: participant.cycle.name,
        status: participant.cycle.status,
      },
      employee,
      selfReview,
      dimensions,
      evaluationRule: participant.cycle.evaluationRule,
      myDraft,
      peerReviews,
      history,
    };
  }

  // ---------------------------------------------------------------------
  // 360° 评估
  // ---------------------------------------------------------------------

  private async requireActiveAssignment(
    participantId: number,
    reviewerOpenId: string,
  ) {
    const assignment = await this.prisma.perfReviewerAssignment.findFirst({
      where: {
        participantId,
        reviewerOpenId,
        status: { not: PerfAssignmentStatus.REPLACED },
      },
    });
    if (!assignment) throw new ForbiddenException('你没有该员工的评审任务');
    return assignment;
  }

  async saveReviewDraft(reviewerOpenId: string, dto: SaveReviewDto) {
    const assignment = await this.requireActiveAssignment(
      dto.participantId,
      reviewerOpenId,
    );
    if (assignment.status === PerfAssignmentStatus.SUBMITTED) {
      throw new ConflictException('评估已提交，不可修改');
    }
    const data = {
      dimensionScores: dto.dimensionScores as unknown as
        Prisma.InputJsonValue | undefined,
      comments: dto.comments,
      promotionFeedback: dto.promotionFeedback as
        Prisma.InputJsonValue | undefined,
      status: PerfReviewStatus.DRAFT,
    };
    return this.prisma.perfReview.upsert({
      where: {
        participantId_reviewerOpenId: {
          participantId: dto.participantId,
          reviewerOpenId,
        },
      },
      create: { ...data, participantId: dto.participantId, reviewerOpenId },
      update: data,
    });
  }

  async submitReview(reviewerOpenId: string, participantId: number) {
    const assignment = await this.requireActiveAssignment(
      participantId,
      reviewerOpenId,
    );
    if (assignment.status === PerfAssignmentStatus.SUBMITTED) {
      throw new ConflictException('评估已提交');
    }
    const review = await this.prisma.perfReview.findUnique({
      where: {
        participantId_reviewerOpenId: { participantId, reviewerOpenId },
      },
    });
    if (!review) throw new BadRequestException('尚未填写评估内容');

    await this.prisma.$transaction([
      this.prisma.perfReview.update({
        where: { id: review.id },
        data: { status: PerfReviewStatus.SUBMITTED, submittedAt: new Date() },
      }),
      this.prisma.perfReviewerAssignment.update({
        where: { id: assignment.id },
        data: { status: PerfAssignmentStatus.SUBMITTED },
      }),
    ]);
    await this.auditService.record({
      operatorOpenId: reviewerOpenId,
      action: 'review.submit',
      targetType: 'perf_participant',
      targetId: String(participantId),
    });
    await this.advanceIfReviewed(reviewerOpenId, participantId);
    return { ok: true };
  }

  // ---------------------------------------------------------------------
  // 上级评估
  // ---------------------------------------------------------------------

  private async requireLeaderOf(participantId: number, leaderOpenId: string) {
    const participant = await this.prisma.perfParticipant.findUnique({
      where: { id: participantId },
      include: { cycle: { include: { evaluationRule: true } } },
    });
    if (!participant || participant.cycle.deletedAt)
      throw new NotFoundException('参与者不存在');
    if (participant.leaderOpenIdSnapshot !== leaderOpenId) {
      throw new ForbiddenException('你不是该员工的直属 Leader');
    }
    return participant;
  }

  async saveManagerReviewDraft(
    leaderOpenId: string,
    dto: SaveManagerReviewDto,
  ) {
    const participant = await this.requireLeaderOf(
      dto.participantId,
      leaderOpenId,
    );
    const existing = await this.prisma.perfManagerReview.findUnique({
      where: { participantId: dto.participantId },
    });
    if (existing?.status === PerfReviewStatus.SUBMITTED) {
      throw new ConflictException('上级评估已提交，不可修改');
    }
    // 初评评级取值受周期评估规则约束
    if (dto.initialLevel) {
      if (
        Array.isArray(participant.cycle.evaluationRule?.levels) &&
        !hasRatingSymbol(
          participant.cycle.evaluationRule?.levels,
          dto.initialLevel,
        )
      ) {
        throw new BadRequestException(
          `评级 ${dto.initialLevel} 不在评估规则定义中`,
        );
      }
    }

    const data = {
      leaderOpenId,
      dimensionScores: dto.dimensionScores as unknown as
        Prisma.InputJsonValue | undefined,
      overallComment: dto.overallComment,
      initialLevel: dto.initialLevel,
      promotionConclusion: dto.promotionConclusion,
      status: PerfReviewStatus.DRAFT,
    };
    return this.prisma.perfManagerReview.upsert({
      where: { participantId: dto.participantId },
      create: { ...data, participantId: dto.participantId },
      update: data,
    });
  }

  async submitManagerReview(leaderOpenId: string, participantId: number) {
    await this.requireLeaderOf(participantId, leaderOpenId);
    const review = await this.prisma.perfManagerReview.findUnique({
      where: { participantId },
    });
    if (!review) throw new BadRequestException('尚未填写上级评估');
    if (review.status === PerfReviewStatus.SUBMITTED)
      throw new ConflictException('上级评估已提交');
    if (!review.initialLevel)
      throw new BadRequestException('提交前必须给出初步绩效评级');

    await this.prisma.perfManagerReview.update({
      where: { id: review.id },
      data: { status: PerfReviewStatus.SUBMITTED, submittedAt: new Date() },
    });
    await this.auditService.record({
      operatorOpenId: leaderOpenId,
      action: 'manager_review.submit',
      targetType: 'perf_participant',
      targetId: String(participantId),
    });
    await this.advanceIfReviewed(leaderOpenId, participantId);
    return { ok: true };
  }

  /**
   * 评审进度聚合：360° 全部提交 + 上级评估提交 → 参与者 SELF_SUBMITTED→REVIEWED，
   * 并创建 AI 分析任务记录（AI 开关关闭时由 AI 模块直接跳过）。
   */
  private async advanceIfReviewed(
    operatorOpenId: string,
    participantId: number,
  ) {
    const [pendingCount, managerReview, participant] = await Promise.all([
      this.prisma.perfReviewerAssignment.count({
        where: { participantId, status: PerfAssignmentStatus.PENDING },
      }),
      this.prisma.perfManagerReview.findUnique({ where: { participantId } }),
      this.prisma.perfParticipant.findUnique({ where: { id: participantId } }),
    ]);
    if (
      pendingCount === 0 &&
      managerReview?.status === PerfReviewStatus.SUBMITTED &&
      participant?.status === PerfParticipantStatus.SELF_SUBMITTED
    ) {
      await this.participantService.transition(
        operatorOpenId,
        participantId,
        PerfParticipantStatus.REVIEWED,
      );
      // 评审数据齐备：创建 AI 分析任务（幂等）
      await this.prisma.perfAiReport.upsert({
        where: { participantId },
        create: { participantId },
        update: {},
      });
    }
  }
}
