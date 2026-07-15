import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PerfAssignmentStatus,
  PerfCycleStatus,
  PerfEvaluationTaskType,
  PerfParticipantStatus,
} from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../shared/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import { assertParticipantTransition } from './participant-state';
import { analyzeParticipantFormMatch } from '../cycle/participant-prefix';
import type {
  NotificationRules,
  SchedulePreset,
} from '../config-template/config-template.contract';
import { buildEvaluationTaskSeeds } from '../cycle/evaluation-task-plan';
import { NotificationEventService } from '../notification/notification-event.service';

@Injectable()
export class ParticipantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly rbacService: RbacService,
    private readonly notificationEventService: NotificationEventService,
  ) {}

  private async requireCycle(cycleId: number) {
    const cycle = await this.prisma.perfCycle.findFirst({
      where: { id: cycleId, deletedAt: null },
    });
    if (!cycle) throw new NotFoundException('绩效周期不存在');
    return cycle;
  }

  /** 参与者写入与周期归档共用 cycle → participant 锁顺序。 */
  private async lockParticipantCycle(
    tx: Prisma.TransactionClient,
    participantId: number,
  ) {
    const rows = await tx.$queryRaw<
      Array<{
        participant_id: number;
        cycle_id: number;
        cycle_status: PerfCycleStatus;
      }>
    >`
      SELECT participant."id" AS participant_id,
        cycle."id" AS cycle_id,
        cycle."status" AS cycle_status
      FROM "performance"."perf_cycles" AS cycle
      JOIN "performance"."perf_participants" AS participant
        ON participant."cycle_id" = cycle."id"
      WHERE participant."id" = ${participantId}
        AND cycle."deleted_at" IS NULL
      FOR UPDATE OF cycle, participant
    `;
    if (rows.length !== 1) throw new NotFoundException('参与者不存在');
    if (rows[0].cycle_status === PerfCycleStatus.ARCHIVED) {
      throw new ConflictException('周期已归档，参与者信息不可修改');
    }
    return rows[0];
  }

  /** 参与者列表：join 员工/部门主数据供前端直接展示 */
  async list(cycleId: number) {
    await this.requireCycle(cycleId);
    const participants = await this.prisma.perfParticipant.findMany({
      where: { cycleId },
      orderBy: { id: 'asc' },
      include: {
        evaluationSubmissions: {
          where: {
            stage: {
              in: [PerfEvaluationTaskType.SELF, PerfEvaluationTaskType.MANAGER],
            },
            status: 'SUBMITTED',
          },
          select: { stage: true, status: true },
          // SELF 与 MANAGER 各需一条；take: 1 会在两者均提交时随机丢失一个阶段。
          take: 2,
        },
        stageResults: {
          where: { stage: PerfEvaluationTaskType.MANAGER, status: 'READY' },
          orderBy: { calculatedAt: 'desc' },
          take: 1,
          select: { stageLevel: true },
        },
        resultVersions: {
          where: { supersededAt: null, invalidatedAt: null },
          orderBy: { version: 'desc' },
          take: 1,
          select: { finalLevel: true, confirmedAt: true },
        },
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
        const selfSubmission = participant.evaluationSubmissions.find(
          (item) => item.stage === PerfEvaluationTaskType.SELF,
        );
        const managerSubmission = participant.evaluationSubmissions.find(
          (item) => item.stage === PerfEvaluationTaskType.MANAGER,
        );
        const managerStageResult = participant.stageResults[0];
        const currentResultVersion = participant.resultVersions[0] ?? null;
        return {
          ...participant,
          // 内部聚合查询不扩散到底层列表响应。
          evaluationSubmissions: undefined,
          stageResults: undefined,
          resultVersions: undefined,
          selfSubmission: selfSubmission
            ? { status: selfSubmission.status }
            : null,
          managerSubmission: managerSubmission
            ? { status: managerSubmission.status }
            : null,
          // 初评等级是 MANAGER 阶段计算产物，不是上级手工录入字段。
          managerInitialLevel: managerStageResult?.stageLevel ?? null,
          resultVersion: currentResultVersion
            ? {
                finalLevel: currentResultVersion.finalLevel,
                confirmedByEmployee: Boolean(currentResultVersion.confirmedAt),
              }
            : null,
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
   * 移除名单校验（角色感知）：
   * - ADMIN：除已归档外的任何状态都可移除考核人员；
   * - 其余（HR）：仅 DRAFT/SCHEDULED 可移除。
   */
  private async assertRemovableByRole(
    cycleStatus: PerfCycleStatus,
    operatorOpenId: string,
  ) {
    if (await this.rbacService.isAdmin(operatorOpenId)) {
      if (cycleStatus === PerfCycleStatus.ARCHIVED) {
        throw new ConflictException('周期已归档，考核人员名单不可移除');
      }
      return;
    }
    if (
      cycleStatus !== PerfCycleStatus.DRAFT &&
      cycleStatus !== PerfCycleStatus.SCHEDULED
    ) {
      throw new ConflictException('周期已启动，HR 不可移除考核人员');
    }
  }

  /** Controller 已限制 HR/Admin；两者均可补加 ACTIVE 参与人，但归档周期永久只读。 */
  private assertAddable(cycleStatus: PerfCycleStatus) {
    if (cycleStatus === PerfCycleStatus.ARCHIVED) {
      throw new ConflictException('周期已归档，考核人员名单不可新增');
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
    if (participants.length === 0) {
      return { participants: [], cycle: null };
    }
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
    const preparedParticipants = participants.map((participant) => {
      const user = userMap.get(participant.employeeOpenId);
      const corehr = corehrMap.get(participant.employeeOpenId);
      const leaderOpenIdSnapshot =
        corehr?.direct_manager_id ?? user?.leader_user_id ?? null;
      const departmentIdSnapshot =
        corehr?.department_id ?? user?.department_ids?.[0] ?? null;
      const formMatch = analyzeParticipantFormMatch(
        {
          id: participant.id,
          employeeOpenId: participant.employeeOpenId,
          jobLevelSnapshot: corehr?.job_level ?? null,
        },
        cycle?.currentConfigVersion?.formSnapshots ?? [],
      );
      return {
        participant,
        corehr,
        leaderOpenIdSnapshot,
        departmentIdSnapshot,
        formMatch,
      };
    });

    if (active) {
      const issues = preparedParticipants.flatMap((item) => {
        const participantIssues: Array<{
          code: string;
          path: string;
          message: string;
          participantId: number;
          employeeOpenId: string;
        }> = [];
        const issueBase = {
          participantId: item.participant.id,
          employeeOpenId: item.participant.employeeOpenId,
        };
        if (!item.corehr?.job_level) {
          participantIssues.push({
            ...issueBase,
            code: 'PARTICIPANT_JOB_LEVEL_MISSING',
            path: `participants.${item.participant.id}.jobLevel`,
            message: '补加参与人时未获取到当前职级',
          });
        } else if (item.formMatch.status !== 'MATCHED') {
          participantIssues.push({
            ...issueBase,
            code: `PARTICIPANT_${item.formMatch.status}`,
            path: `participants.${item.participant.id}.jobLevel`,
            message: item.formMatch.message,
          });
        }
        if (!item.leaderOpenIdSnapshot) {
          participantIssues.push({
            ...issueBase,
            code: 'PARTICIPANT_LEADER_MISSING',
            path: `participants.${item.participant.id}.leader`,
            message: '补加参与人时未获取到当前直属 Leader',
          });
        }
        if (!item.departmentIdSnapshot) {
          participantIssues.push({
            ...issueBase,
            code: 'PARTICIPANT_DEPARTMENT_MISSING',
            path: `participants.${item.participant.id}.department`,
            message: '补加参与人时未获取到当前部门',
          });
        }
        return participantIssues;
      });
      if (issues.length > 0) {
        // ACTIVE 不再有后续启动检查，缺失快照时必须整笔回滚，不能留下无法填写的任务。
        throw new ConflictException({
          code: 'ACTIVE_PARTICIPANT_SNAPSHOT_INVALID',
          message: '补加参与人的组织或表单快照不完整，请先修复主数据',
          issues,
        });
      }
    }

    for (const item of preparedParticipants) {
      await tx.perfParticipant.update({
        where: { id: item.participant.id },
        data: {
          leaderOpenIdSnapshot: item.leaderOpenIdSnapshot,
          departmentIdSnapshot: item.departmentIdSnapshot,
          jobLevelSnapshot: item.corehr?.job_level ?? undefined,
          jobLevelPrefixSnapshot:
            item.formMatch.status === 'MATCHED'
              ? item.formMatch.jobLevelPrefix
              : null,
          formSnapshotId:
            item.formMatch.status === 'MATCHED'
              ? item.formMatch.formSnapshotId
              : null,
          status: active ? PerfParticipantStatus.ACTIVE : undefined,
        },
      });
    }
    return {
      participants: preparedParticipants.map((item) => ({
        id: item.participant.id,
        employeeOpenId: item.participant.employeeOpenId,
        leaderOpenIdSnapshot: item.leaderOpenIdSnapshot,
      })),
      cycle,
    };
  }

  /** ACTIVE 补加参与人的任务与开放通知必须和参与人记录在同一事务提交。 */
  private async createActiveParticipantTasks(
    tx: Prisma.TransactionClient,
    cycleId: number,
    snapshot: Awaited<
      ReturnType<ParticipantService['snapshotNewParticipants']>
    >,
    now: Date,
  ) {
    if (snapshot.participants.length === 0) return;
    const config = snapshot.cycle?.currentConfigVersion;
    const plannedStartAt = snapshot.cycle?.plannedStartAt;
    if (!snapshot.cycle || !config || !plannedStartAt) {
      // ACTIVE 周期按模型必须已有计划与配置快照；异常时整体回滚，避免出现无任务参与人。
      throw new ConflictException('进行中周期缺少任务计划，暂不能补加参与人');
    }
    const tasks = buildEvaluationTaskSeeds({
      cycleId,
      participants: snapshot.participants,
      plannedStartAt,
      schedulePreset: config.schedulePreset as unknown as SchedulePreset,
      now,
    });
    await tx.perfEvaluationTask.createMany({
      data: tasks,
      skipDuplicates: true,
    });

    const openedTasks = await tx.perfEvaluationTask.findMany({
      where: {
        participantId: { in: snapshot.participants.map((item) => item.id) },
        openedAt: now,
        type: { not: PerfEvaluationTaskType.AI },
      },
      include: {
        participant: {
          select: {
            leaderOpenIdSnapshot: true,
            reviewerAssignments: {
              where: { status: { not: PerfAssignmentStatus.REPLACED } },
              select: { reviewerOpenId: true },
            },
          },
        },
      },
    });
    const rules = config.notificationRules as unknown as NotificationRules;
    for (const task of openedTasks) {
      const rule = rules.stages.find(
        (item) => item.stage === task.type,
      )?.taskOpened;
      if (!rule) continue;
      await this.notificationEventService.enqueueTaskOpenedEvents(
        {
          id: task.id,
          cycleId,
          type: task.type,
          assigneeOpenId: task.assigneeOpenId,
          openedAt: task.openedAt,
          reminderDeadlineAt: task.reminderDeadlineAt,
          cycleName: snapshot.cycle.name,
          cycleOwnerOpenId: snapshot.cycle.ownerOpenId,
          leaderOpenId: task.participant.leaderOpenIdSnapshot,
          peerReviewerOpenIds: task.participant.reviewerAssignments.map(
            (assignment) => assignment.reviewerOpenId,
          ),
          rule,
        },
        tx,
      );
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
        this.prisma.perfResultVersion.count({ where: { participantId } }),
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
    const submissions = await this.prisma.perfEvaluationSubmission.count({
      where: { participantId },
    });
    const affectedData = { submissions };
    if (Object.values(affectedData).some((count) => count > 0) && !confirm) {
      throw new ConflictException({
        code: 'DESTRUCTIVE_EDIT_REQUIRES_CONFIRM',
        message: '移除该考核人员会删除其统一评估提交，请确认后继续',
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
    const now = new Date();

    const mutation = await this.prisma.$transaction(async (tx) => {
      // 与 schedule 使用同一周期行锁，保证增员提交时 SCHEDULED 完整性始终成立。
      await tx.$queryRaw`SELECT "id" FROM "performance"."perf_cycles" WHERE "id" = ${cycleId} AND "deleted_at" IS NULL FOR UPDATE`;
      const cycle = await tx.perfCycle.findFirst({
        where: { id: cycleId, deletedAt: null },
      });
      if (!cycle) throw new NotFoundException('绩效周期不存在');
      this.assertAddable(cycle.status);

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
        const snapshot = await this.snapshotNewParticipants(
          tx,
          cycleId,
          freshOpenIds,
          this.isInProgress(cycle.status),
        );
        if (this.isInProgress(cycle.status)) {
          await this.createActiveParticipantTasks(tx, cycleId, snapshot, now);
        }
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
        ? 'HR/Admin 进行中补加参与人'
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
    this.assertAddable(cycle.status);
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
    await this.assertRemovableByRole(cycle.status, operatorOpenId);
    const participant = await this.prisma.perfParticipant.findFirst({
      where: { id: participantId, cycleId },
    });
    if (!participant) throw new NotFoundException('参与者不存在');
    // 进行中删除：Restrict 数据直接拒绝，Cascade 数据需二次确认；启动前过程数据为空可直接删
    if (this.isInProgress(cycle.status)) {
      await this.assertRemovable(participantId, confirm);
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        const locked = await this.lockParticipantCycle(tx, participantId);
        if (locked.cycle_id !== cycleId) {
          throw new NotFoundException('参与者不存在');
        }
        await tx.perfParticipant.delete({
          where: { id: participantId },
        });
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
    const { participant, updated } = await this.prisma.$transaction(
      async (tx) => {
        const locked = await this.lockParticipantCycle(tx, participantId);
        if (locked.cycle_id !== cycleId) {
          throw new NotFoundException('参与者不存在');
        }
        const participant = await tx.perfParticipant.findUnique({
          where: { id: participantId },
        });
        if (!participant) throw new NotFoundException('参与者不存在');
        const updated = await tx.perfParticipant.update({
          where: { id: participantId },
          data: { isPromotionEnabled },
        });
        return { participant, updated };
      },
    );
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
    const { participant, updated } = await this.prisma.$transaction(
      async (tx) => {
        await this.lockParticipantCycle(tx, participantId);
        const participant = await tx.perfParticipant.findUnique({
          where: { id: participantId },
        });
        if (!participant) throw new NotFoundException('参与者不存在');
        assertParticipantTransition(participant.status, to);
        const updated = await tx.perfParticipant.update({
          where: { id: participantId },
          data: { status: to },
        });
        return { participant, updated };
      },
    );
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
