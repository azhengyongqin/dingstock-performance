import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PerfAssignmentStatus,
  PerfCycleStatus,
  PerfEvaluationTaskType,
  PerfNotificationChannel,
  PerfReviewerRelation,
  PerfReviewerSource,
  PerfRole,
  PerfParticipantStatus,
} from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../shared/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import { PeerStageResultService } from '../evaluation/peer-stage-result.service';
import { ParticipantEvaluationLockService } from '../participant/participant-evaluation-lock.service';
import type { ReviewerItemDto } from './review.dto';

/** 直属上级由 MANAGER 阶段承载，不属于 360°计算关系。 */
const CALCULATION_RELATIONS = new Set<PerfReviewerRelation>([
  PerfReviewerRelation.ORG_OWNER,
  PerfReviewerRelation.PROJECT_OWNER,
  PerfReviewerRelation.PEER,
  PerfReviewerRelation.CROSS_DEPT,
]);

/** 评审员指派与推荐（产品 §6.4.1）：推荐是建议，指派需 Leader 确认或 HR 补充 */
@Injectable()
export class ReviewerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly rbacService: RbacService,
    private readonly peerStageResultService: PeerStageResultService,
    private readonly participantEvaluationLockService: ParticipantEvaluationLockService,
  ) {}

  /** 与周期归档共用 cycle -> participant 锁顺序，防止子对象写在 ARCHIVED 后提交。 */
  private async lockWritableCycle(
    tx: Prisma.TransactionClient,
    participantId: number,
  ) {
    const cycles = await tx.$queryRaw<Array<{ status: PerfCycleStatus }>>`
      SELECT cycle."status"
      FROM "performance"."perf_cycles" AS cycle
      JOIN "performance"."perf_participants" AS participant
        ON participant."cycle_id" = cycle."id"
      WHERE participant."id" = ${participantId}
      FOR UPDATE OF cycle
    `;
    if (cycles.length !== 1) throw new NotFoundException('参与者不存在');
    if (cycles[0].status === PerfCycleStatus.ARCHIVED) {
      throw new ConflictException('周期已归档，评审员指派不可修改');
    }
  }

  private async requireParticipant(participantId: number) {
    const participant = await this.prisma.perfParticipant.findUnique({
      where: { id: participantId },
      include: { cycle: true },
    });
    if (!participant || participant.cycle.deletedAt) {
      throw new NotFoundException('参与者不存在');
    }
    if (participant.cycle.status === PerfCycleStatus.ARCHIVED) {
      throw new ConflictException('周期已归档，评审员指派不可修改');
    }
    if (participant.status === PerfParticipantStatus.WITHDRAWN) {
      throw new ConflictException('参与者已中途退出，评审员指派不可修改');
    }
    return participant;
  }

  /** 指派操作权限：被评人的 Leader（快照）或 HR/ADMIN */
  private async assertCanManage(
    operatorOpenId: string,
    participant: {
      leaderOpenIdSnapshot: string | null;
      departmentIdSnapshot: string | null;
    },
  ) {
    if (participant.leaderOpenIdSnapshot === operatorOpenId)
      return 'LEADER' as const;
    const isHr = await this.rbacService.hasAnyRole(operatorOpenId, [
      PerfRole.HR,
      PerfRole.ADMIN,
    ]);
    if (!isHr) {
      throw new ForbiddenException('仅被评人的直属 Leader 或 HR 可管理评审员');
    }
    const scope = await this.rbacService.getOrgScope(operatorOpenId);
    if (
      scope !== null &&
      (!participant.departmentIdSnapshot ||
        !scope.includes(participant.departmentIdSnapshot))
    ) {
      throw new ForbiddenException('该参与者不在你的 HR 授权组织范围内');
    }
    return 'HR' as const;
  }

  private assertAllowedItems(
    participant: {
      employeeOpenId: string;
      leaderOpenIdSnapshot: string | null;
    },
    items: ReviewerItemDto[],
  ) {
    const reviewerIds = new Set<string>();
    for (const item of items) {
      if (!CALCULATION_RELATIONS.has(item.relation)) {
        throw new BadRequestException(
          '360°评审关系仅支持组织负责人、项目负责人、同部门同事、跨部门协作方',
        );
      }
      if (item.reviewerOpenId === participant.employeeOpenId) {
        throw new BadRequestException('员工本人不可成为自己的 360°评审员');
      }
      if (item.reviewerOpenId === participant.leaderOpenIdSnapshot) {
        throw new BadRequestException(
          '考核 Leader 不可被指派为 360°评审员：上级的评价由上级评估环节承载',
        );
      }
      if (reviewerIds.has(item.reviewerOpenId)) {
        throw new BadRequestException('同一评审员不能在多个关系中重复指派');
      }
      reviewerIds.add(item.reviewerOpenId);
    }
  }

  /** 当前指派 + 系统推荐列表 */
  async listWithRecommendations(operatorOpenId: string, participantId: number) {
    const participant = await this.requireParticipant(participantId);
    await this.assertCanManage(operatorOpenId, participant);

    const assignments = await this.prisma.perfReviewerAssignment.findMany({
      where: { participantId },
      orderBy: { id: 'asc' },
    });

    const activeReviewerIds = new Set(
      assignments
        .filter((a) => a.status !== PerfAssignmentStatus.REPLACED)
        .map((a) => a.reviewerOpenId),
    );

    // ---- 推荐来源：组织负责人 / 同部门同事 / 历史评审关系 ----
    // 考核 Leader 快照不进候选：上级视角由上级评估环节承载（CONTEXT.md「评审员指派」）
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
      if (openId === participant.leaderOpenIdSnapshot) return;
      if (activeReviewerIds.has(openId)) return;
      if (recommendations.some((r) => r.openId === openId)) return;
      recommendations.push({ openId, relation, reason });
    };

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

    // 统一补充人员主数据（含被评估人，供指派页展示「为谁邀请」）
    const allOpenIds = [
      ...new Set([
        participant.employeeOpenId,
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
      // 供前端选人时即时拦截：考核 Leader 快照不可被指派为 360° 评审员
      leaderOpenId: participant.leaderOpenIdSnapshot,
      employee: userMap.get(participant.employeeOpenId) ?? {
        open_id: participant.employeeOpenId,
      },
      cycle: {
        id: participant.cycle.id,
        name: participant.cycle.name,
      },
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
      participant,
    );
    const source =
      operatorRole === 'HR'
        ? PerfReviewerSource.HR_ASSIGNED
        : PerfReviewerSource.LEADER_ASSIGNED;

    const current = await this.prisma.perfReviewerAssignment.findMany({
      where: { participantId, status: { not: PerfAssignmentStatus.REPLACED } },
    });
    const wanted = new Map(items.map((item) => [item.reviewerOpenId, item]));

    this.assertAllowedItems(participant, items);

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
      await this.lockWritableCycle(tx, participantId);
      // 评审关系会改变 PEER 的有效人工输入，必须与首次校准竞争同一参与人行锁。
      await this.participantEvaluationLockService.lockHumanWrite(
        tx,
        participantId,
      );
      // 移除：未提交的置 REPLACED
      for (const assignment of current) {
        if (!wanted.has(assignment.reviewerOpenId)) {
          if (!isRemovalAttempt(assignment)) continue; // 他人新增，不动
          // 与评审提交竞争同一行：只有仍为 PENDING 才允许覆盖保存直接移除。
          const removed = await tx.perfReviewerAssignment.updateMany({
            where: {
              id: assignment.id,
              status: PerfAssignmentStatus.PENDING,
            },
            data: { status: PerfAssignmentStatus.REPLACED },
          });
          if (removed.count !== 1) {
            throw new ConflictException(
              '评审员状态已变化，已提交关系不可直接移除；请刷新后使用显式替换',
            );
          }
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
        // 新增评审责任后，PEER 协调任务重新进入未完成；启动前尚无任务时 updateMany 安全跳过。
        await tx.perfEvaluationTask.updateMany({
          where: { participantId, type: PerfEvaluationTaskType.PEER },
          data: { completedAt: null },
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
    return this.listWithRecommendations(operatorOpenId, participantId);
  }

  /**
   * 显式替换评审员：旧指派保留为 REPLACED，新指派从 PENDING 开始。
   * 审计和权限变更在同一事务内完成，旧评审员随即失去有效指派权限。
   */
  async replaceReviewer(
    operatorOpenId: string,
    participantId: number,
    assignmentId: number,
    input: ReviewerItemDto & { reason: string },
  ) {
    const participant = await this.requireParticipant(participantId);
    const operatorRole = await this.assertCanManage(
      operatorOpenId,
      participant,
    );
    this.assertAllowedItems(participant, [input]);
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException('替换评审员必须填写原因');

    const previous = await this.prisma.perfReviewerAssignment.findUnique({
      where: { id: assignmentId },
    });
    if (
      !previous ||
      previous.participantId !== participantId ||
      previous.status === PerfAssignmentStatus.REPLACED
    ) {
      throw new NotFoundException('待替换的有效评审员指派不存在');
    }
    if (previous.reviewerOpenId === input.reviewerOpenId) {
      throw new BadRequestException('新评审员必须与原评审员不同');
    }
    const duplicate = await this.prisma.perfReviewerAssignment.findMany({
      where: {
        participantId,
        reviewerOpenId: input.reviewerOpenId,
        status: { not: PerfAssignmentStatus.REPLACED },
      },
      take: 1,
    });
    if (duplicate.length > 0) {
      throw new ConflictException('新评审员已在当前有效名单中');
    }

    const source =
      operatorRole === 'HR'
        ? PerfReviewerSource.HR_ASSIGNED
        : PerfReviewerSource.LEADER_ASSIGNED;
    return this.prisma.$transaction(async (tx) => {
      await this.lockWritableCycle(tx, participantId);
      await this.participantEvaluationLockService.lockHumanWrite(
        tx,
        participantId,
      );
      // 条件更新同时承担行锁；并发替换只有一个请求能撤销当前有效指派。
      const replacementClaim = await tx.perfReviewerAssignment.updateMany({
        where: {
          id: previous.id,
          participantId,
          status: { not: PerfAssignmentStatus.REPLACED },
        },
        data: { status: PerfAssignmentStatus.REPLACED },
      });
      if (replacementClaim.count !== 1) {
        throw new ConflictException('评审员指派已被替换，请刷新后重试');
      }
      const created = await tx.perfReviewerAssignment.create({
        data: {
          cycleId: participant.cycleId,
          participantId,
          reviewerOpenId: input.reviewerOpenId,
          relation: input.relation,
          source,
        },
      });
      await tx.perfEvaluationTask.updateMany({
        where: { participantId, type: PerfEvaluationTaskType.PEER },
        data: { completedAt: null },
      });
      await tx.perfNotification.create({
        data: {
          receiverOpenId: input.reviewerOpenId,
          channel: PerfNotificationChannel.BOT_DM,
          template: 'review_task_assigned',
          payload: {
            cycleId: participant.cycleId,
            participantId,
            employeeOpenId: participant.employeeOpenId,
          },
        },
      });
      // 只有已提交指派进入阶段结果；替换待提交指派不触碰结果，也兼容尚未启用新版快照的旧周期。
      if (previous.status === PerfAssignmentStatus.SUBMITTED) {
        await this.peerStageResultService.recalculate(participantId, tx);
      }
      // 敏感权限变更的审计不能采用失败不阻断策略，必须与替换一同提交或回滚。
      await tx.auditLog.create({
        data: {
          operatorOpenId,
          action: 'reviewer.replace',
          targetType: 'perf_reviewer_assignment',
          targetId: String(previous.id),
          before: {
            assignmentId: previous.id,
            reviewerOpenId: previous.reviewerOpenId,
            relation: previous.relation,
            status: previous.status,
          },
          after: {
            assignmentId: created.id,
            reviewerOpenId: created.reviewerOpenId,
            relation: created.relation,
            status: created.status,
          },
          reason,
        },
      });
      return created;
    });
  }

  /** HR 批量为多个参与者补充评审员 */
  async batchAdd(
    operatorOpenId: string,
    cycleId: number,
    participantIds: number[],
    items: ReviewerItemDto[],
  ) {
    const isHr = await this.rbacService.hasAnyRole(operatorOpenId, [
      PerfRole.HR,
      PerfRole.ADMIN,
    ]);
    if (!isHr) throw new ForbiddenException('仅 HR 或 Admin 可批量补充评审员');
    const participants = await this.prisma.perfParticipant.findMany({
      where: { id: { in: participantIds }, cycleId },
    });
    if (participants.length === 0) throw new NotFoundException('参与者不存在');
    const scope = await this.rbacService.getOrgScope(operatorOpenId);
    for (const participant of participants) {
      if (
        scope !== null &&
        (!participant.departmentIdSnapshot ||
          !scope.includes(participant.departmentIdSnapshot))
      ) {
        throw new ForbiddenException(
          `参与者 ${participant.id} 不在你的 HR 授权组织范围内`,
        );
      }
      this.assertAllowedItems(participant, items);
    }

    // 一次预取全部现存指派，再一次批量写入，避免参与者数量放大数据库往返。
    const existing = await this.prisma.perfReviewerAssignment.findMany({
      where: {
        participantId: { in: participants.map((item) => item.id) },
        status: { not: PerfAssignmentStatus.REPLACED },
      },
      select: { participantId: true, reviewerOpenId: true },
    });
    const existingKeys = new Set(
      existing.map((item) => `${item.participantId}:${item.reviewerOpenId}`),
    );
    const rows = participants.flatMap((participant) =>
      items
        .filter(
          (item) =>
            !existingKeys.has(`${participant.id}:${item.reviewerOpenId}`),
        )
        .map((item) => ({
          cycleId,
          participantId: participant.id,
          reviewerOpenId: item.reviewerOpenId,
          relation: item.relation,
          source: PerfReviewerSource.HR_ASSIGNED,
        })),
    );
    const result =
      rows.length > 0
        ? await this.prisma.$transaction(async (tx) => {
            // 固定参与人加锁顺序，既阻止校准后改关系，也降低批量操作互锁风险。
            const orderedParticipantIds = [
              ...new Set(rows.map((row) => row.participantId)),
            ].sort((left, right) => left - right);
            for (const participantId of orderedParticipantIds) {
              await this.participantEvaluationLockService.lockHumanWrite(
                tx,
                participantId,
              );
            }
            return tx.perfReviewerAssignment.createMany({
              data: rows,
              // 数据库部分唯一索引兜底并发批量补充；重复行直接跳过。
              skipDuplicates: true,
            });
          })
        : { count: 0 };
    const added = result.count;

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
