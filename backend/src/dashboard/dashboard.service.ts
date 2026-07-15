import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PerfAppealStatus,
  PerfAssignmentStatus,
  PerfEvaluationTaskType,
  PerfParticipantStatus,
  PerfReviewStatus,
  PerfRole,
} from '../generated/prisma/enums';
import { PrismaService } from '../shared/database/prisma.service';
import { RbacService } from '../rbac/rbac.service';

/** 已提交自评的参与者状态集合（含后续阶段） */
const SELF_DONE: PerfParticipantStatus[] = [
  PerfParticipantStatus.SELF_SUBMITTED,
  PerfParticipantStatus.REVIEWED,
  PerfParticipantStatus.AI_DONE,
  PerfParticipantStatus.CALIBRATED,
  PerfParticipantStatus.RESULT_PUSHED,
  PerfParticipantStatus.CONFIRMED,
  PerfParticipantStatus.APPEALING,
  PerfParticipantStatus.RE_CONFIRMING,
  PerfParticipantStatus.ARCHIVED,
];
const REVIEW_DONE: PerfParticipantStatus[] = SELF_DONE.filter(
  (status) => status !== PerfParticipantStatus.SELF_SUBMITTED,
);
const CALIBRATION_DONE: PerfParticipantStatus[] = REVIEW_DONE.filter(
  (status) =>
    status !== PerfParticipantStatus.REVIEWED &&
    status !== PerfParticipantStatus.AI_DONE,
);
const CONFIRM_DONE: PerfParticipantStatus[] = [
  PerfParticipantStatus.CONFIRMED,
  PerfParticipantStatus.ARCHIVED,
];

/** 看板统计：内置指标 SQL 聚合（研发文档 §8.8），指标口径集中在本文件复用 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbacService: RbacService,
  ) {}

  private async resolveCycleId(cycleId?: number) {
    if (cycleId) return cycleId;
    const cycle = await this.prisma.perfCycle.findFirst({
      where: { deletedAt: null, status: { notIn: ['DRAFT'] } },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    return cycle?.id;
  }

  /** HR 全局仪表盘（产品 §7.1） */
  async hrDashboard(cycleId?: number) {
    const resolvedCycleId = await this.resolveCycleId(cycleId);
    if (!resolvedCycleId) return { cycle: null, stats: null };
    const cycle = await this.prisma.perfCycle.findUnique({
      where: { id: resolvedCycleId },
      select: {
        id: true,
        name: true,
        status: true,
        startDate: true,
        endDate: true,
      },
    });
    if (!cycle) throw new NotFoundException('绩效周期不存在');

    const where = { cycleId: resolvedCycleId };
    const [
      total,
      selfDone,
      reviewDone,
      calibrated,
      confirmed,
      appeals,
      participants,
    ] = await Promise.all([
      this.prisma.perfParticipant.count({ where }),
      this.prisma.perfParticipant.count({
        where: { ...where, status: { in: SELF_DONE } },
      }),
      this.prisma.perfParticipant.count({
        where: { ...where, status: { in: REVIEW_DONE } },
      }),
      this.prisma.perfParticipant.count({
        where: { ...where, status: { in: CALIBRATION_DONE } },
      }),
      this.prisma.perfParticipant.count({
        where: { ...where, status: { in: CONFIRM_DONE } },
      }),
      this.prisma.perfAppeal.count({
        where: {
          participant: { cycleId: resolvedCycleId },
          invalidatedAt: null,
        },
      }),
      this.prisma.perfParticipant.findMany({
        where,
        select: {
          status: true,
          result: {
            where: { invalidatedAt: null },
            select: { finalLevel: true },
          },
          managerReview: { select: { initialLevel: true } },
          stageResults: {
            where: { stage: PerfEvaluationTaskType.MANAGER, status: 'READY' },
            orderBy: { calculatedAt: 'desc' },
            take: 1,
            select: { stageLevel: true },
          },
          calibrations: {
            where: { invalidatedAt: null },
            orderBy: { id: 'desc' },
            take: 1,
            select: { afterLevel: true },
          },
        },
      }),
    ]);

    // 等级分布（当前口径：结果 > 校准 > 初评）
    const levelDistribution: Record<string, number> = {};
    for (const participant of participants) {
      const level =
        participant.result?.finalLevel ??
        participant.calibrations[0]?.afterLevel ??
        participant.stageResults[0]?.stageLevel ??
        participant.managerReview?.initialLevel;
      if (level) levelDistribution[level] = (levelDistribution[level] ?? 0) + 1;
    }
    const statusDistribution: Record<string, number> = {};
    for (const participant of participants) {
      statusDistribution[participant.status] =
        (statusDistribution[participant.status] ?? 0) + 1;
    }

    const rate = (count: number) =>
      total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
    return {
      cycle,
      stats: {
        total,
        selfReviewRate: rate(selfDone),
        reviewRate: rate(reviewDone),
        calibrationRate: rate(calibrated),
        confirmRate: rate(confirmed),
        appealCount: appeals,
        appealRate: rate(appeals),
        levelDistribution,
        statusDistribution,
      },
    };
  }

  /** Leader 团队看板（产品 §7.2）：以 Leader 快照过滤 */
  async teamDashboard(leaderOpenId: string, cycleId?: number) {
    const resolvedCycleId = await this.resolveCycleId(cycleId);
    if (!resolvedCycleId) return { cycle: null, items: [], total: 0 };

    const members = await this.prisma.perfParticipant.findMany({
      where: { cycleId: resolvedCycleId, leaderOpenIdSnapshot: leaderOpenId },
      include: {
        selfReview: { select: { status: true, submittedAt: true } },
        managerReview: { select: { status: true, initialLevel: true } },
        evaluationSubmissions: {
          where: {
            stage: PerfEvaluationTaskType.MANAGER,
            status: PerfReviewStatus.SUBMITTED,
          },
          select: { status: true },
          take: 1,
        },
        stageResults: {
          where: { stage: PerfEvaluationTaskType.MANAGER, status: 'READY' },
          orderBy: { calculatedAt: 'desc' },
          take: 1,
          select: { stageLevel: true },
        },
        reviewerAssignments: {
          where: { status: { not: PerfAssignmentStatus.REPLACED } },
          select: { status: true },
        },
        result: { select: { finalLevel: true, confirmedByEmployee: true } },
      },
      orderBy: { id: 'asc' },
    });
    const users = await this.prisma.larkUser.findMany({
      where: { open_id: { in: members.map((m) => m.employeeOpenId) } },
      select: { open_id: true, name: true, avatar: true, job_title: true },
    });
    const userMap = new Map(users.map((u) => [u.open_id, u]));
    const cycle = await this.prisma.perfCycle.findUnique({
      where: { id: resolvedCycleId },
      select: { id: true, name: true, status: true },
    });

    return {
      cycle,
      items: members.map((member) => {
        const totalAssignments = member.reviewerAssignments.length;
        const submittedAssignments = member.reviewerAssignments.filter(
          (a) => a.status === PerfAssignmentStatus.SUBMITTED,
        ).length;
        return {
          participantId: member.id,
          employee: userMap.get(member.employeeOpenId) ?? null,
          status: member.status,
          isPromotionEnabled: member.isPromotionEnabled,
          selfReviewStatus: member.selfReview?.status ?? null,
          reviewProgress: {
            submitted: submittedAssignments,
            total: totalAssignments,
          },
          managerReviewStatus:
            member.evaluationSubmissions[0]?.status ??
            member.managerReview?.status ??
            null,
          initialLevel:
            member.stageResults[0]?.stageLevel ??
            member.managerReview?.initialLevel ??
            null,
          finalLevel: member.result?.finalLevel ?? null,
        };
      }),
      total: members.length,
    };
  }

  /** 个人绩效档案（产品 §7.17）：本人/其 Leader/HR 可见；历史结果仅取已归档 */
  async profile(operatorOpenId: string, targetOpenId: string) {
    if (operatorOpenId !== targetOpenId) {
      const isHr = await this.rbacService.hasAnyRole(operatorOpenId, [
        PerfRole.HR,
        PerfRole.ADMIN,
      ]);
      if (!isHr) {
        const isLeader = await this.prisma.perfParticipant.findFirst({
          where: {
            employeeOpenId: targetOpenId,
            leaderOpenIdSnapshot: operatorOpenId,
          },
          select: { id: true },
        });
        if (!isLeader) throw new ForbiddenException('无权查看该员工的绩效档案');
      }
    }

    const employee = await this.prisma.larkUser.findUnique({
      where: { open_id: targetOpenId },
      select: {
        open_id: true,
        name: true,
        avatar: true,
        job_title: true,
        department_ids: true,
      },
    });
    const results = await this.prisma.perfResult.findMany({
      where: {
        participant: { employeeOpenId: targetOpenId },
        archivedAt: { not: null },
      },
      include: {
        participant: {
          select: {
            cycleId: true,
            isPromotionEnabled: true,
            cycle: {
              select: { id: true, name: true, startDate: true, endDate: true },
            },
          },
        },
      },
      orderBy: { id: 'desc' },
    });
    return {
      employee,
      items: results.map((result) => ({
        cycle: result.participant.cycle,
        finalLevel: result.finalLevel,
        promotionResult: result.promotionResult,
        confirmedByEmployee: result.confirmedByEmployee,
        archivedAt: result.archivedAt,
      })),
      total: results.length,
    };
  }

  /** 工作台待办聚合（研发文档 §9.2 workbench） */
  async myTodos(openId: string) {
    const [
      pendingSelfReview,
      pendingReviews,
      pendingManagerReviews,
      pendingConfirm,
      pendingAppeals,
    ] = await Promise.all([
      this.prisma.perfParticipant.count({
        where: {
          employeeOpenId: openId,
          status: {
            in: [
              PerfParticipantStatus.PENDING_SELF_REVIEW,
              PerfParticipantStatus.RETURNED,
            ],
          },
          cycle: {
            deletedAt: null,
            status: 'ACTIVE',
          },
        },
      }),
      this.prisma.perfReviewerAssignment.count({
        where: {
          reviewerOpenId: openId,
          status: PerfAssignmentStatus.PENDING,
          cycle: {
            deletedAt: null,
            status: 'ACTIVE',
          },
        },
      }),
      this.prisma.perfParticipant.count({
        where: {
          leaderOpenIdSnapshot: openId,
          managerReview: { isNot: { status: PerfReviewStatus.SUBMITTED } },
          cycle: {
            deletedAt: null,
            status: 'ACTIVE',
          },
        },
      }),
      this.prisma.perfParticipant.count({
        where: {
          employeeOpenId: openId,
          status: {
            in: [
              PerfParticipantStatus.RESULT_PUSHED,
              PerfParticipantStatus.RE_CONFIRMING,
            ],
          },
        },
      }),
      this.prisma.perfAppeal.count({
        where: {
          status: { not: PerfAppealStatus.RESOLVED },
          invalidatedAt: null,
          handlerOpenId: openId,
        },
      }),
    ]);
    return {
      pendingSelfReview,
      pendingReviews,
      pendingManagerReviews,
      pendingConfirm,
      pendingAppeals,
    };
  }
}
