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
import { PrismaService } from '../shared/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import { assertParticipantTransition } from './participant-state';

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

  private assertMutable(cycleStatus: PerfCycleStatus) {
    if (
      cycleStatus !== PerfCycleStatus.DRAFT &&
      cycleStatus !== PerfCycleStatus.PENDING
    ) {
      throw new ConflictException('周期已启动，考核人员名单不可增删');
    }
  }

  /** 按 open_id 名单批量加人（幂等；唯一约束兜底） */
  async addByOpenIds(
    operatorOpenId: string,
    cycleId: number,
    openIds: string[],
  ) {
    const cycle = await this.requireCycle(cycleId);
    this.assertMutable(cycle.status);
    if (openIds.length === 0) throw new BadRequestException('人员名单为空');

    const users = await this.prisma.larkUser.findMany({
      where: { open_id: { in: openIds } },
      select: { open_id: true },
    });
    const validIds = new Set(users.map((u) => u.open_id));
    const missing = openIds.filter((id) => !validIds.has(id));

    const result = await this.prisma.perfParticipant.createMany({
      data: openIds
        .filter((id) => validIds.has(id))
        .map((employeeOpenId) => ({ cycleId, employeeOpenId })),
      skipDuplicates: true,
    });

    await this.auditService.record({
      operatorOpenId,
      action: 'participant.add',
      targetType: 'perf_cycle',
      targetId: String(cycleId),
      after: { added: result.count, requested: openIds.length, missing },
    });
    return { added: result.count, missing };
  }

  /** 按部门圈人（含子部门） */
  async addByDepartments(
    operatorOpenId: string,
    cycleId: number,
    departmentIds: string[],
  ) {
    const cycle = await this.requireCycle(cycleId);
    this.assertMutable(cycle.status);
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

  async remove(operatorOpenId: string, cycleId: number, participantId: number) {
    const cycle = await this.requireCycle(cycleId);
    this.assertMutable(cycle.status);
    const participant = await this.prisma.perfParticipant.findFirst({
      where: { id: participantId, cycleId },
    });
    if (!participant) throw new NotFoundException('参与者不存在');
    // 启动前删除：过程数据为空，Cascade 清理不会伤害历史
    await this.prisma.perfParticipant.delete({ where: { id: participantId } });
    await this.auditService.record({
      operatorOpenId,
      action: 'participant.remove',
      targetType: 'perf_participant',
      targetId: String(participantId),
      before: participant,
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
