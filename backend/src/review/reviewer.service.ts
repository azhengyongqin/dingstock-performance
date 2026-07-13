import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PerfAssignmentStatus,
  PerfNotificationChannel,
  PerfReviewerRelation,
  PerfReviewerSource,
  PerfRole,
} from '../generated/prisma/enums';
import { PrismaService } from '../shared/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import type { ReviewerItemDto } from './review.dto';

/** 评审员指派与推荐（产品 §6.4.1）：推荐是建议，指派需 Leader 确认或 HR 补充 */
@Injectable()
export class ReviewerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly rbacService: RbacService,
  ) {}

  private async requireParticipant(participantId: number) {
    const participant = await this.prisma.perfParticipant.findUnique({
      where: { id: participantId },
      include: { cycle: true },
    });
    if (!participant || participant.cycle.deletedAt) {
      throw new NotFoundException('参与者不存在');
    }
    return participant;
  }

  /** 指派操作权限：被评人的 Leader（快照）或 HR/ADMIN */
  private async assertCanManage(
    operatorOpenId: string,
    leaderOpenId: string | null,
  ) {
    if (leaderOpenId === operatorOpenId) return 'LEADER' as const;
    const isHr = await this.rbacService.hasAnyRole(operatorOpenId, [
      PerfRole.HR,
      PerfRole.ADMIN,
    ]);
    if (!isHr)
      throw new ForbiddenException('仅被评人的直属 Leader 或 HR 可管理评审员');
    return 'HR' as const;
  }

  /** 当前指派 + 系统推荐列表 */
  async listWithRecommendations(participantId: number) {
    const participant = await this.requireParticipant(participantId);

    const assignments = await this.prisma.perfReviewerAssignment.findMany({
      where: { participantId },
      orderBy: { id: 'asc' },
    });

    const activeReviewerIds = new Set(
      assignments
        .filter((a) => a.status !== PerfAssignmentStatus.REPLACED)
        .map((a) => a.reviewerOpenId),
    );

    // ---- 推荐来源：直属上级 / 组织负责人 / 同部门同事 / 历史评审关系 ----
    const recommendations: {
      openId: string;
      relation: PerfReviewerRelation;
      reason: string;
    }[] = [];
    const push = (
      openId: string | null | undefined,
      relation: PerfReviewerRelation,
      reason: string,
    ) => {
      if (!openId || openId === participant.employeeOpenId) return;
      if (activeReviewerIds.has(openId)) return;
      if (recommendations.some((r) => r.openId === openId)) return;
      recommendations.push({ openId, relation, reason });
    };

    push(
      participant.leaderOpenIdSnapshot,
      PerfReviewerRelation.LEADER,
      '直属上级',
    );

    if (participant.departmentIdSnapshot) {
      const department = await this.prisma.larkDepartment.findUnique({
        where: { open_department_id: participant.departmentIdSnapshot },
        select: { leader_user_id: true },
      });
      push(
        department?.leader_user_id,
        PerfReviewerRelation.ORG_OWNER,
        '组织负责人',
      );

      const peers = await this.prisma.larkUser.findMany({
        where: {
          department_ids: { has: participant.departmentIdSnapshot },
          open_id: { not: participant.employeeOpenId },
        },
        select: { open_id: true },
        take: 8,
      });
      for (const peer of peers)
        push(peer.open_id, PerfReviewerRelation.PEER, '同部门同事');
    }

    // 历史评审关系：该员工在历史周期的评审员
    const history = await this.prisma.perfReviewerAssignment.findMany({
      where: {
        participant: {
          employeeOpenId: participant.employeeOpenId,
          cycleId: { not: participant.cycleId },
        },
        status: PerfAssignmentStatus.SUBMITTED,
      },
      select: { reviewerOpenId: true, relation: true },
      distinct: ['reviewerOpenId'],
      take: 8,
    });
    for (const item of history)
      push(item.reviewerOpenId, item.relation, '历史评审关系');

    // 统一补充人员主数据
    const allOpenIds = [
      ...new Set([
        ...assignments.map((a) => a.reviewerOpenId),
        ...recommendations.map((r) => r.openId),
      ]),
    ];
    const users = await this.prisma.larkUser.findMany({
      where: { open_id: { in: allOpenIds } },
      select: { open_id: true, name: true, avatar: true, job_title: true },
    });
    const userMap = new Map(users.map((u) => [u.open_id, u]));

    return {
      assignments: assignments.map((a) => ({
        ...a,
        reviewer: userMap.get(a.reviewerOpenId) ?? null,
      })),
      recommendations: recommendations.map((r) => ({
        ...r,
        user: userMap.get(r.openId) ?? null,
      })),
    };
  }

  /**
   * 覆盖式指派：新增创建、移除的未提交指派置 REPLACED（保留痕迹）。
   * 护栏：移除已提交（SUBMITTED）的指派整单拒绝；
   * knownAssignmentIds 为页面加载时的指派快照，加载后他人新增的指派缺席不视为删除。
   */
  async upsertReviewers(
    operatorOpenId: string,
    participantId: number,
    items: ReviewerItemDto[],
    knownAssignmentIds?: number[],
  ) {
    const participant = await this.requireParticipant(participantId);
    const operatorRole = await this.assertCanManage(
      operatorOpenId,
      participant.leaderOpenIdSnapshot,
    );
    const source =
      operatorRole === 'HR'
        ? PerfReviewerSource.HR_ASSIGNED
        : PerfReviewerSource.LEADER_ASSIGNED;

    const current = await this.prisma.perfReviewerAssignment.findMany({
      where: { participantId, status: { not: PerfAssignmentStatus.REPLACED } },
    });
    const wanted = new Map(items.map((item) => [item.reviewerOpenId, item]));

    // 乐观校验：只有操作者加载页面时已见过的指派，缺席才视为删除
    const known = knownAssignmentIds ? new Set(knownAssignmentIds) : null;
    const isRemovalAttempt = (assignment: { id: number }) =>
      !known || known.has(assignment.id);

    // 护栏：已提交评估的评审员不可被覆盖移除，整单拒绝，提示刷新后重试
    const removedSubmitted = current.filter(
      (assignment) =>
        assignment.status === PerfAssignmentStatus.SUBMITTED &&
        !wanted.has(assignment.reviewerOpenId) &&
        isRemovalAttempt(assignment),
    );
    if (removedSubmitted.length > 0) {
      throw new ConflictException(
        '名单中包含已提交评估的评审员，不可移除；请刷新页面后重试',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // 移除：未提交的置 REPLACED
      for (const assignment of current) {
        if (!wanted.has(assignment.reviewerOpenId)) {
          if (!isRemovalAttempt(assignment)) continue; // 他人新增，不动
          await tx.perfReviewerAssignment.update({
            where: { id: assignment.id },
            data: { status: PerfAssignmentStatus.REPLACED },
          });
        }
      }
      // 新增
      const currentIds = new Set(current.map((a) => a.reviewerOpenId));
      const added = items.filter(
        (item) => !currentIds.has(item.reviewerOpenId),
      );
      if (added.length > 0) {
        await tx.perfReviewerAssignment.createMany({
          data: added.map((item) => ({
            cycleId: participant.cycleId,
            participantId,
            reviewerOpenId: item.reviewerOpenId,
            relation: item.relation,
            source,
          })),
        });
        // 评审任务通知：落库 PENDING 由调度器发送
        await tx.perfNotification.createMany({
          data: added.map((item) => ({
            receiverOpenId: item.reviewerOpenId,
            channel: PerfNotificationChannel.BOT_DM,
            template: 'review_task_assigned',
            payload: {
              cycleId: participant.cycleId,
              participantId,
              employeeOpenId: participant.employeeOpenId,
            },
          })),
        });
      }
    });

    await this.auditService.record({
      operatorOpenId,
      action: 'reviewer.upsert',
      targetType: 'perf_participant',
      targetId: String(participantId),
      after: { reviewers: items },
    });
    return this.listWithRecommendations(participantId);
  }

  /** HR 批量为多个参与者补充评审员 */
  async batchAdd(
    operatorOpenId: string,
    cycleId: number,
    participantIds: number[],
    items: ReviewerItemDto[],
  ) {
    const participants = await this.prisma.perfParticipant.findMany({
      where: { id: { in: participantIds }, cycleId },
    });
    if (participants.length === 0) throw new NotFoundException('参与者不存在');

    let added = 0;
    for (const participant of participants) {
      const existing = await this.prisma.perfReviewerAssignment.findMany({
        where: {
          participantId: participant.id,
          status: { not: PerfAssignmentStatus.REPLACED },
        },
        select: { reviewerOpenId: true },
      });
      const existingIds = new Set(existing.map((a) => a.reviewerOpenId));
      const toAdd = items.filter(
        (item) =>
          !existingIds.has(item.reviewerOpenId) &&
          item.reviewerOpenId !== participant.employeeOpenId,
      );
      if (toAdd.length === 0) continue;
      await this.prisma.perfReviewerAssignment.createMany({
        data: toAdd.map((item) => ({
          cycleId,
          participantId: participant.id,
          reviewerOpenId: item.reviewerOpenId,
          relation: item.relation,
          source: PerfReviewerSource.HR_ASSIGNED,
        })),
      });
      added += toAdd.length;
    }

    await this.auditService.record({
      operatorOpenId,
      action: 'reviewer.batch_add',
      targetType: 'perf_cycle',
      targetId: String(cycleId),
      after: { participantIds, items, added },
    });
    return { added };
  }
}
