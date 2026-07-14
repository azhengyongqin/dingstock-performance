import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PerfCycleStatus,
  PerfParticipantStatus,
} from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../shared/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import { assertParticipantTransition } from './participant-state';
import { analyzeParticipantFormMatch } from '../cycle/participant-prefix';

@Injectable()
export class ParticipantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly rbacService: RbacService,
  ) {}

  private async requireCycle(cycleId: number) {
    const cycle = await this.prisma.perfCycle.findFirst({
      where: { id: cycleId, deletedAt: null },
    });
    if (!cycle) throw new NotFoundException('绩效周期不存在');
    return cycle;
  }

  /** 参与者列表：join 员工/部门主数据供前端直接展示 */
  async list(cycleId: number) {
    await this.requireCycle(cycleId);
    const participants = await this.prisma.perfParticipant.findMany({
      where: { cycleId },
      orderBy: { id: 'asc' },
      include: {
        selfReview: { select: { status: true, submittedAt: true } },
        managerReview: { select: { status: true, initialLevel: true } },
        result: { select: { finalLevel: true, confirmedByEmployee: true } },
        _count: { select: { reviewerAssignments: true } },
      },
    });

    const employeeIds = participants.map((p) => p.employeeOpenId);
    const leaderIds = participants
      .map((p) => p.leaderOpenIdSnapshot)
      .filter((id): id is string => Boolean(id));
    const users = await this.prisma.larkUser.findMany({
      where: { open_id: { in: [...new Set([...employeeIds, ...leaderIds])] } },
      select: {
        open_id: true,
        name: true,
        avatar: true,
        job_title: true,
        department_ids: true,
        leader_user_id: true,
        status: true,
      },
    });
    const userMap = new Map(users.map((u) => [u.open_id, u]));

    const departmentIds = new Set<string>();
    for (const participant of participants) {
      const deptId =
        participant.departmentIdSnapshot ??
        userMap.get(participant.employeeOpenId)?.department_ids?.[0];
      if (deptId) departmentIds.add(deptId);
    }
    const departments = await this.prisma.larkDepartment.findMany({
      where: { open_department_id: { in: [...departmentIds] } },
      select: { open_department_id: true, name: true },
    });
    const deptMap = new Map(
      departments.map((d) => [d.open_department_id, d.name]),
    );

    return {
      items: participants.map((participant) => {
        const user = userMap.get(participant.employeeOpenId);
        const leaderOpenId =
          participant.leaderOpenIdSnapshot ?? user?.leader_user_id ?? null;
        const departmentId =
          participant.departmentIdSnapshot ?? user?.department_ids?.[0] ?? null;
        return {
          ...participant,
          employee: user ?? null,
          leader: leaderOpenId
            ? (userMap.get(leaderOpenId) ?? { open_id: leaderOpenId })
            : null,
          departmentName: departmentId
            ? (deptMap.get(departmentId) ?? null)
            : null,
        };
      }),
      total: participants.length,
    };
  }

  /**
   * 名单可增删校验（角色感知）：
   * - ADMIN：除已归档外的任何状态都可增删考核人员；
   * - 其余（HR）：仅 DRAFT/SCHEDULED 可增删。
   */
  private async assertMutable(
    cycleStatus: PerfCycleStatus,
    operatorOpenId: string,
  ) {
    if (await this.rbacService.isAdmin(operatorOpenId)) {
      if (cycleStatus === PerfCycleStatus.ARCHIVED) {
        throw new ConflictException('周期已归档，考核人员名单不可增删');
      }
      return;
    }
    if (
      cycleStatus !== PerfCycleStatus.DRAFT &&
      cycleStatus !== PerfCycleStatus.SCHEDULED
    ) {
      throw new ConflictException('周期已启动，考核人员名单不可增删');
    }
  }

  /** 进行中（可能已产生评估数据）：ACTIVE */
  private isInProgress(status: PerfCycleStatus) {
    return status === PerfCycleStatus.ACTIVE;
  }

  /**
   * 新增名单时立即固化主数据与 D/M 表单匹配。
   * 四步向导第二步因此可以展示真实阻塞项，而不必等到周期启动。
   */
  private async snapshotNewParticipants(
    tx: Prisma.TransactionClient,
    cycleId: number,
    openIds: string[],
    active: boolean,
  ) {
    const participants = await tx.perfParticipant.findMany({
      where: { cycleId, employeeOpenId: { in: openIds } },
    });
    if (participants.length === 0) return;
    const [users, corehrs, cycle] = await Promise.all([
      tx.larkUser.findMany({
        where: { open_id: { in: openIds } },
        select: { open_id: true, leader_user_id: true, department_ids: true },
      }),
      tx.larkCorehrEmployee.findMany({
        where: { open_id: { in: openIds } },
        select: {
          open_id: true,
          direct_manager_id: true,
          department_id: true,
          job_level: true,
        },
      }),
      tx.perfCycle.findUnique({
        where: { id: cycleId },
        include: {
          currentConfigVersion: { include: { formSnapshots: true } },
        },
      }),
    ]);
    const userMap = new Map(users.map((u) => [u.open_id, u]));
    const corehrMap = new Map(corehrs.map((c) => [c.open_id, c]));

    for (const participant of participants) {
      const user = userMap.get(participant.employeeOpenId);
      const corehr = corehrMap.get(participant.employeeOpenId);
      const formMatch = analyzeParticipantFormMatch(
        {
          id: participant.id,
          employeeOpenId: participant.employeeOpenId,
          jobLevelSnapshot: corehr?.job_level ?? null,
        },
        cycle?.currentConfigVersion?.formSnapshots ?? [],
      );
      await tx.perfParticipant.update({
        where: { id: participant.id },
        data: {
          leaderOpenIdSnapshot:
            corehr?.direct_manager_id ?? user?.leader_user_id ?? null,
          departmentIdSnapshot:
            corehr?.department_id ?? user?.department_ids?.[0] ?? null,
          jobLevelSnapshot: corehr?.job_level ?? undefined,
          jobLevelPrefixSnapshot:
            formMatch.status === 'MATCHED' ? formMatch.jobLevelPrefix : null,
          formSnapshotId:
            formMatch.status === 'MATCHED' ? formMatch.formSnapshotId : null,
          status: active
            ? PerfParticipantStatus.PENDING_SELF_REVIEW
            : undefined,
        },
      });
    }
  }

  /**
   * 进行中移除考核人员的守卫：
   * - 已产生结果/校准/AI/申诉/面谈（Restrict 外键）→ 直接拒绝，无法移除；
   * - 仅有自评/评审等 Cascade 数据 → 需二次确认（confirm）。
   */
  private async assertRemovable(participantId: number, confirm?: boolean) {
    const [results, calibrations, aiReports, appeals, interviews] =
      await Promise.all([
        this.prisma.perfResult.count({ where: { participantId } }),
        this.prisma.perfCalibration.count({ where: { participantId } }),
        this.prisma.perfAiReport.count({ where: { participantId } }),
        this.prisma.perfAppeal.count({ where: { participantId } }),
        this.prisma.perfInterview.count({ where: { participantId } }),
      ]);
    if (results + calibrations + aiReports + appeals + interviews > 0) {
      throw new ConflictException(
        '该员工已产生结果/校准/AI分析/申诉/面谈等数据，无法移除',
      );
    }
    const [selfReviews, reviews, managerReviews] = await Promise.all([
      this.prisma.perfSelfReview.count({ where: { participantId } }),
      this.prisma.perfReview.count({ where: { participantId } }),
      this.prisma.perfManagerReview.count({ where: { participantId } }),
    ]);
    const affectedData = { selfReviews, reviews, managerReviews };
    if (Object.values(affectedData).some((count) => count > 0) && !confirm) {
      throw new ConflictException({
        code: 'DESTRUCTIVE_EDIT_REQUIRES_CONFIRM',
        message: '移除该考核人员会删除其已提交的自评/评审数据，请确认后继续',
        impact: { changes: ['移除考核人员'], affectedData },
      });
    }
  }

  /** 按 open_id 名单批量加人（幂等；唯一约束兜底） */
  async addByOpenIds(
    operatorOpenId: string,
    cycleId: number,
    openIds: string[],
  ) {
    if (openIds.length === 0) throw new BadRequestException('人员名单为空');

    const mutation = await this.prisma.$transaction(async (tx) => {
      // 与 schedule 使用同一周期行锁，保证增员提交时 SCHEDULED 完整性始终成立。
      await tx.$queryRaw`SELECT "id" FROM "performance"."perf_cycles" WHERE "id" = ${cycleId} AND "deleted_at" IS NULL FOR UPDATE`;
      const cycle = await tx.perfCycle.findFirst({
        where: { id: cycleId, deletedAt: null },
      });
      if (!cycle) throw new NotFoundException('绩效周期不存在');
      await this.assertMutable(cycle.status, operatorOpenId);

      const users = await tx.larkUser.findMany({
        where: { open_id: { in: openIds } },
        select: { open_id: true },
      });
      const validIds = new Set(users.map((user) => user.open_id));
      const missing = openIds.filter((id) => !validIds.has(id));
      const toAdd = openIds.filter((id) => validIds.has(id));
      const existing = await tx.perfParticipant.findMany({
        where: { cycleId, employeeOpenId: { in: toAdd } },
        select: { employeeOpenId: true },
      });
      const existingSet = new Set(existing.map((row) => row.employeeOpenId));
      const result = await tx.perfParticipant.createMany({
        data: toAdd.map((employeeOpenId) => ({ cycleId, employeeOpenId })),
        skipDuplicates: true,
      });
      const freshOpenIds = toAdd.filter((id) => !existingSet.has(id));
      if (freshOpenIds.length > 0) {
        await this.snapshotNewParticipants(
          tx,
          cycleId,
          freshOpenIds,
          this.isInProgress(cycle.status),
        );
      }
      return { cycle, result, missing };
    });

    await this.auditService.record({
      operatorOpenId,
      action: 'participant.add',
      targetType: 'perf_cycle',
      targetId: String(cycleId),
      after: {
        added: mutation.result.count,
        requested: openIds.length,
        missing: mutation.missing,
      },
      reason: this.isInProgress(mutation.cycle.status)
        ? '管理员进行中编辑'
        : undefined,
    });
    return { added: mutation.result.count, missing: mutation.missing };
  }

  /** 按部门圈人（含子部门） */
  async addByDepartments(
    operatorOpenId: string,
    cycleId: number,
    departmentIds: string[],
  ) {
    const cycle = await this.requireCycle(cycleId);
    await this.assertMutable(cycle.status, operatorOpenId);
    if (departmentIds.length === 0)
      throw new BadRequestException('部门列表为空');

    const expanded =
      await this.rbacService.expandDepartmentSubtree(departmentIds);
    const users = await this.prisma.larkUser.findMany({
      where: { department_ids: { hasSome: expanded } },
      select: { open_id: true },
    });
    if (users.length === 0) return { added: 0, missing: [] };
    return this.addByOpenIds(
      operatorOpenId,
      cycleId,
      users.map((u) => u.open_id),
    );
  }

  async remove(
    operatorOpenId: string,
    cycleId: number,
    participantId: number,
    confirm?: boolean,
  ) {
    const cycle = await this.requireCycle(cycleId);
    await this.assertMutable(cycle.status, operatorOpenId);
    const participant = await this.prisma.perfParticipant.findFirst({
      where: { id: participantId, cycleId },
    });
    if (!participant) throw new NotFoundException('参与者不存在');
    // 进行中删除：Restrict 数据直接拒绝，Cascade 数据需二次确认；启动前过程数据为空可直接删
    if (this.isInProgress(cycle.status)) {
      await this.assertRemovable(participantId, confirm);
    }
    try {
      await this.prisma.perfParticipant.delete({
        where: { id: participantId },
      });
    } catch (error) {
      // 外键约束兜底（P2003）：仍有 Restrict 关系数据时给出友好提示
      if ((error as { code?: string })?.code === 'P2003') {
        throw new ConflictException(
          '该员工已产生结果/校准/申诉等数据，无法移除',
        );
      }
      throw error;
    }
    await this.auditService.record({
      operatorOpenId,
      action: 'participant.remove',
      targetType: 'perf_participant',
      targetId: String(participantId),
      before: participant,
      reason: this.isInProgress(cycle.status) ? '管理员进行中编辑' : undefined,
    });
    return { ok: true };
  }

  /** 标记是否参与晋升评估维度 */
  async update(
    operatorOpenId: string,
    cycleId: number,
    participantId: number,
    isPromotionEnabled: boolean,
  ) {
    const participant = await this.prisma.perfParticipant.findFirst({
      where: { id: participantId, cycleId },
    });
    if (!participant) throw new NotFoundException('参与者不存在');
    const updated = await this.prisma.perfParticipant.update({
      where: { id: participantId },
      data: { isPromotionEnabled },
    });
    await this.auditService.record({
      operatorOpenId,
      action: 'participant.update',
      targetType: 'perf_participant',
      targetId: String(participantId),
      before: { isPromotionEnabled: participant.isPromotionEnabled },
      after: { isPromotionEnabled },
    });
    return updated;
  }

  /** 参与者状态流转（各业务模块统一入口，保证经过状态机 + 审计） */
  async transition(
    operatorOpenId: string,
    participantId: number,
    to: PerfParticipantStatus,
    reason?: string,
  ) {
    const participant = await this.prisma.perfParticipant.findUnique({
      where: { id: participantId },
    });
    if (!participant) throw new NotFoundException('参与者不存在');
    assertParticipantTransition(participant.status, to);
    const updated = await this.prisma.perfParticipant.update({
      where: { id: participantId },
      data: { status: to },
    });
    await this.auditService.record({
      operatorOpenId,
      action: 'participant.transition',
      targetType: 'perf_participant',
      targetId: String(participantId),
      before: { status: participant.status },
      after: { status: to },
      reason,
    });
    return updated;
  }
}
