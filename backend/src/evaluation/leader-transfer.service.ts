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
  PerfParticipantStatus,
  PerfReviewStatus,
  PerfRole,
} from '../generated/prisma/enums';
import { RbacService } from '../rbac/rbac.service';
import { PrismaService } from '../shared/database/prisma.service';
import type { Prisma } from '../generated/prisma/client';

export type TransferLeaderInput = {
  participantId: number;
  /** 页面打开时看到的责任人；用于阻止并发更换静默覆盖。 */
  expectedLeaderOpenId: string;
  newLeaderOpenId: string;
  reason: string;
};

/**
 * 考核 Leader 职责转移：以参与者快照为唯一当前权限边界，在一个事务内同步
 * 待办、冲突的待提交 360°指派、通知与强审计；历史提交和校准记录不改写。
 */
@Injectable()
export class LeaderTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbacService: RbacService,
  ) {}

  /** 先锁周期再改参与人，与归档事务保持同一锁顺序。 */
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
      throw new ConflictException('周期已归档，不能更换考核 Leader');
    }
  }

  async transfer(operatorOpenId: string, input: TransferLeaderInput) {
    const expectedLeaderOpenId = input.expectedLeaderOpenId.trim();
    const newLeaderOpenId = input.newLeaderOpenId.trim();
    const reason = input.reason.trim();
    if (!expectedLeaderOpenId || !newLeaderOpenId) {
      throw new BadRequestException('原 Leader 与新 Leader 均不能为空');
    }
    if (!reason) throw new BadRequestException('更换考核 Leader 必须填写原因');
    if (expectedLeaderOpenId === newLeaderOpenId) {
      throw new BadRequestException('新 Leader 必须与原 Leader 不同');
    }

    const participant = await this.prisma.perfParticipant.findUnique({
      where: { id: input.participantId },
      include: { cycle: true },
    });
    if (!participant || participant.cycle.deletedAt) {
      throw new NotFoundException('参与者不存在');
    }
    if (participant.cycle.status === PerfCycleStatus.ARCHIVED) {
      throw new ConflictException('周期已归档，不能更换考核 Leader');
    }
    if (participant.status === PerfParticipantStatus.WITHDRAWN) {
      throw new ConflictException('参与者已中途退出，不能更换考核 Leader');
    }
    await this.assertCanTransfer(operatorOpenId, participant);
    if (participant.leaderOpenIdSnapshot !== expectedLeaderOpenId) {
      throw new ConflictException('考核 Leader 已变化，请刷新后重试');
    }
    if (participant.employeeOpenId === newLeaderOpenId) {
      throw new BadRequestException('员工本人不能成为自己的考核 Leader');
    }
    const newLeader = await this.prisma.larkUser.findUnique({
      where: { open_id: newLeaderOpenId },
      select: { open_id: true, name: true },
    });
    if (!newLeader) throw new NotFoundException('新 Leader 不存在');

    return this.prisma.$transaction(async (tx) => {
      await this.lockWritableCycle(tx, participant.id);
      // 条件更新既是乐观并发检查，也会锁住参与者行；与 MANAGER 提交争用同一权限边界。
      const claimed = await tx.perfParticipant.updateMany({
        where: {
          id: participant.id,
          leaderOpenIdSnapshot: expectedLeaderOpenId,
        },
        data: { leaderOpenIdSnapshot: newLeaderOpenId },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('考核 Leader 已被并发更换，请刷新后重试');
      }

      const [calibration, effectiveManagerSubmission, removedDrafts] =
        await Promise.all([
          tx.perfCalibration.findFirst({
            where: { participantId: participant.id, invalidatedAt: null },
            select: { id: true },
            orderBy: { id: 'desc' },
          }),
          tx.perfEvaluationSubmission.findFirst({
            where: {
              participantId: participant.id,
              stage: PerfEvaluationTaskType.MANAGER,
              status: PerfReviewStatus.SUBMITTED,
            },
            select: { id: true, reviewerOpenId: true, submittedAt: true },
          }),
          // 草稿从未生效且可能含旧 Leader 的敏感临时内容；转移后清除，生效答卷保持不变。
          tx.perfEvaluationSubmission.deleteMany({
            where: {
              participantId: participant.id,
              stage: PerfEvaluationTaskType.MANAGER,
              status: PerfReviewStatus.DRAFT,
            },
          }),
        ]);

      const [taskUpdate, replacedPendingPeer] = await Promise.all([
        tx.perfEvaluationTask.updateMany({
          where: {
            participantId: participant.id,
            type: PerfEvaluationTaskType.MANAGER,
          },
          // 不改 completedAt：旧生效提交继续有效；已校准任务也保持历史完成事实。
          data: { assigneeOpenId: newLeaderOpenId },
        }),
        // 新 Leader 若曾是未提交 360°评审员则自动撤销；已提交指派按领域规则保留。
        tx.perfReviewerAssignment.updateMany({
          where: {
            participantId: participant.id,
            reviewerOpenId: newLeaderOpenId,
            status: PerfAssignmentStatus.PENDING,
          },
          data: { status: PerfAssignmentStatus.REPLACED },
        }),
      ]);
      const postCalibration = Boolean(calibration);
      const notificationPayload = {
        cycleId: participant.cycleId,
        cycleName: participant.cycle.name,
        participantId: participant.id,
        employeeOpenId: participant.employeeOpenId,
        oldLeaderOpenId: expectedLeaderOpenId,
        newLeaderOpenId,
        postCalibration,
      };
      await tx.perfNotification.createMany({
        data: [
          {
            receiverOpenId: newLeaderOpenId,
            channel: PerfNotificationChannel.BOT_DM,
            template: 'manager_responsibility_transferred_in',
            payload: notificationPayload,
          },
          {
            receiverOpenId: expectedLeaderOpenId,
            channel: PerfNotificationChannel.BOT_DM,
            template: 'manager_responsibility_transferred_out',
            payload: notificationPayload,
          },
        ],
      });
      // 权限变更审计属于事务成功条件，不能走失败不阻断的普通 AuditService。
      await tx.auditLog.create({
        data: {
          operatorOpenId,
          action: 'participant.leader.transfer',
          targetType: 'perf_participant',
          targetId: String(participant.id),
          before: { leaderOpenId: expectedLeaderOpenId },
          after: {
            leaderOpenId: newLeaderOpenId,
            effectiveManagerSubmissionId:
              effectiveManagerSubmission?.id ?? null,
            effectiveManagerSubmissionOwnerOpenId:
              effectiveManagerSubmission?.reviewerOpenId ?? null,
            postCalibration,
            removedDraftCount: removedDrafts.count,
            reassignedTaskCount: taskUpdate.count,
            replacedPendingPeerAssignmentCount: replacedPendingPeer.count,
          },
          reason,
        },
      });
      return {
        participantId: participant.id,
        oldLeaderOpenId: expectedLeaderOpenId,
        newLeaderOpenId,
        newLeader,
        postCalibration,
        effectiveManagerSubmission,
      };
    });
  }

  private async assertCanTransfer(
    operatorOpenId: string,
    participant: { departmentIdSnapshot: string | null },
  ) {
    const allowed = await this.rbacService.hasAnyRole(operatorOpenId, [
      PerfRole.HR,
      PerfRole.ADMIN,
    ]);
    if (!allowed) {
      throw new ForbiddenException('仅 HR 或 Admin 可更换考核 Leader');
    }
    const scope = await this.rbacService.getOrgScope(operatorOpenId);
    if (
      scope !== null &&
      (!participant.departmentIdSnapshot ||
        !scope.includes(participant.departmentIdSnapshot))
    ) {
      throw new ForbiddenException('该参与者不在你的 HR 授权组织范围内');
    }
  }
}
