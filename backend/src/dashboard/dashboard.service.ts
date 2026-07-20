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
import { projectHistoricalPromotion } from '../calibration/result-history-projection';

/** 看板只聚合统一任务、统一提交、阶段结果和不可变结果版本。 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbacService: RbacService,
  ) {}

  private async resolveCycleId(cycleId?: number) {
    if (cycleId) return cycleId;
    const cycle = await this.prisma.perfCycle.findFirst({
      where: { deletedAt: null, status: { not: 'DRAFT' } },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    return cycle?.id;
  }

  async hrDashboard(cycleId?: number) {
    const resolvedCycleId = await this.resolveCycleId(cycleId);
    if (!resolvedCycleId) return { cycle: null, stats: null };
    const cycle = await this.prisma.perfCycle.findUnique({
      where: { id: resolvedCycleId },
      select: { id: true, name: true, status: true, plannedStartAt: true },
    });
    if (!cycle) throw new NotFoundException('绩效周期不存在');
    const [participants, submitted] = await Promise.all([
      this.prisma.perfParticipant.findMany({
        where: { cycleId: resolvedCycleId },
        select: {
          id: true,
          status: true,
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
          resultVersions: {
            where: { supersededAt: null, invalidatedAt: null },
            take: 1,
            select: { finalLevel: true, confirmedAt: true },
          },
        },
      }),
      this.prisma.perfEvaluationSubmission.findMany({
        where: { cycleId: resolvedCycleId, status: PerfReviewStatus.SUBMITTED },
        distinct: ['participantId', 'stage'],
        select: { participantId: true, stage: true },
      }),
    ]);
    const selfIds = new Set(
      submitted
        .filter((row) => row.stage === 'SELF')
        .map((row) => row.participantId),
    );
    const managerIds = new Set(
      submitted
        .filter((row) => row.stage === 'MANAGER')
        .map((row) => row.participantId),
    );
    const levelDistribution: Record<string, number> = {};
    const statusDistribution: Record<string, number> = {};
    for (const participant of participants) {
      const level =
        participant.resultVersions[0]?.finalLevel ??
        participant.calibrations[0]?.afterLevel ??
        participant.stageResults[0]?.stageLevel;
      if (level) levelDistribution[level] = (levelDistribution[level] ?? 0) + 1;
      statusDistribution[participant.status] =
        (statusDistribution[participant.status] ?? 0) + 1;
    }
    const total = participants.length;
    const rate = (count: number) =>
      total ? Math.round((count / total) * 1000) / 10 : 0;
    const calibrated = participants.filter(
      (row) => row.calibrations.length,
    ).length;
    const confirmed = participants.filter(
      (row) => row.resultVersions[0]?.confirmedAt,
    ).length;
    const appeals = await this.prisma.perfAppeal.count({
      where: { participant: { cycleId: resolvedCycleId }, invalidatedAt: null },
    });
    return {
      cycle,
      stats: {
        total,
        selfSubmissionRate: rate(selfIds.size),
        reviewRate: rate(managerIds.size),
        calibrationRate: rate(calibrated),
        confirmRate: rate(confirmed),
        appealCount: appeals,
        appealRate: rate(appeals),
        levelDistribution,
        statusDistribution,
      },
    };
  }

  async teamDashboard(leaderOpenId: string, cycleId?: number) {
    const resolvedCycleId = await this.resolveCycleId(cycleId);
    if (!resolvedCycleId) return { cycle: null, items: [], total: 0 };
    const members = await this.prisma.perfParticipant.findMany({
      where: { cycleId: resolvedCycleId, leaderOpenIdSnapshot: leaderOpenId },
      include: {
        evaluationSubmissions: {
          where: {
            status: {
              in: [PerfReviewStatus.DRAFT, PerfReviewStatus.SUBMITTED],
            },
          },
          select: { stage: true, status: true, submittedAt: true },
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
        resultVersions: {
          where: { supersededAt: null, invalidatedAt: null },
          take: 1,
          select: { finalLevel: true },
        },
      },
      orderBy: { id: 'asc' },
    });
    const users = await this.prisma.larkUser.findMany({
      where: { open_id: { in: members.map((row) => row.employeeOpenId) } },
      select: { open_id: true, name: true, avatar: true, job_title: true },
    });
    const userMap = new Map(users.map((user) => [user.open_id, user]));
    const cycle = await this.prisma.perfCycle.findUnique({
      where: { id: resolvedCycleId },
      select: { id: true, name: true, status: true },
    });
    return {
      cycle,
      items: members.map((member) => {
        const managerSubmissions = member.evaluationSubmissions.filter(
          (row) => row.stage === PerfEvaluationTaskType.MANAGER,
        );
        const hasManagerDraft = managerSubmissions.some(
          (row) => row.status === PerfReviewStatus.DRAFT,
        );
        const hasManagerSubmission = managerSubmissions.some(
          (row) => row.status === PerfReviewStatus.SUBMITTED,
        );

        return {
          participantId: member.id,
          employee: userMap.get(member.employeeOpenId) ?? null,
          status: member.status,
          selfSubmissionStatus: member.evaluationSubmissions.some(
            (row) =>
              row.stage === PerfEvaluationTaskType.SELF &&
              row.status === PerfReviewStatus.SUBMITTED,
          )
            ? 'SUBMITTED'
            : null,
          reviewProgress: {
            submitted: member.reviewerAssignments.filter(
              (row) => row.status === PerfAssignmentStatus.SUBMITTED,
            ).length,
            total: member.reviewerAssignments.length,
          },
          // 更新草稿不替换上一份生效提交，因此状态和完成统计必须分开表达。
          managerEvaluationState: hasManagerSubmission
            ? hasManagerDraft
              ? 'PENDING_RESUBMIT'
              : 'EFFECTIVE'
            : hasManagerDraft
              ? 'DRAFT'
              : 'NOT_STARTED',
          managerSubmissionStatus: hasManagerSubmission ? 'SUBMITTED' : null,
          managerInitialLevel: member.stageResults[0]?.stageLevel ?? null,
          finalLevel: member.resultVersions[0]?.finalLevel ?? null,
        };
      }),
      total: members.length,
    };
  }

  async profile(operatorOpenId: string, targetOpenId: string) {
    if (operatorOpenId !== targetOpenId) {
      const isHr = await this.rbacService.hasAnyRole(operatorOpenId, [
        PerfRole.HR,
        PerfRole.ADMIN,
      ]);
      const isLeader = isHr
        ? true
        : Boolean(
            await this.prisma.perfParticipant.findFirst({
              where: {
                employeeOpenId: targetOpenId,
                leaderOpenIdSnapshot: operatorOpenId,
              },
              select: { id: true },
            }),
          );
      if (!isLeader) throw new ForbiddenException('无权查看该员工的绩效档案');
    }
    const [employee, versions] = await Promise.all([
      this.prisma.larkUser.findUnique({
        where: { open_id: targetOpenId },
        select: {
          open_id: true,
          name: true,
          avatar: true,
          job_title: true,
          department_ids: true,
        },
      }),
      this.prisma.perfResultVersion.findMany({
        where: {
          participant: {
            employeeOpenId: targetOpenId,
            cycle: { status: 'ARCHIVED' },
          },
          supersededAt: null,
          invalidatedAt: null,
        },
        include: {
          participant: {
            select: {
              cycle: { select: { id: true, name: true, plannedStartAt: true } },
            },
          },
        },
        orderBy: { id: 'desc' },
      }),
    ]);
    return {
      employee,
      items: versions.map((version) => ({
        cycle: version.participant.cycle,
        finalLevel: version.finalLevel,
        promotionResult: projectHistoricalPromotion(version.resultSnapshot),
        confirmedByEmployee: Boolean(version.confirmedAt),
        archivedAt: version.participant.cycle.plannedStartAt,
      })),
      total: versions.length,
    };
  }

  async myTodos(openId: string) {
    const [
      pendingSelfReview,
      pendingReviews,
      pendingManagerReviews,
      pendingConfirm,
      pendingAppeals,
    ] = await Promise.all([
      this.prisma.perfEvaluationTask.count({
        where: {
          type: PerfEvaluationTaskType.SELF,
          assigneeOpenId: openId,
          completedAt: null,
          cycle: { status: 'ACTIVE', deletedAt: null },
        },
      }),
      this.prisma.perfReviewerAssignment.count({
        where: {
          reviewerOpenId: openId,
          status: PerfAssignmentStatus.PENDING,
          cycle: { status: 'ACTIVE', deletedAt: null },
        },
      }),
      this.prisma.perfEvaluationTask.count({
        where: {
          type: PerfEvaluationTaskType.MANAGER,
          assigneeOpenId: openId,
          completedAt: null,
          cycle: { status: 'ACTIVE', deletedAt: null },
        },
      }),
      this.prisma.perfParticipant.count({
        where: {
          employeeOpenId: openId,
          status: {
            in: [
              PerfParticipantStatus.RESULT_PUBLISHED,
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
