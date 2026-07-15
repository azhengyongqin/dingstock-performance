import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../shared/database/prisma.service';

type TaskFactStatus = 'WAITING' | 'OPEN' | 'COMPLETED';

/** 周期进度只聚合任务与参与人事实，不再把细粒度阶段塞回周期状态。 */
@Injectable()
export class CycleProgressService {
  constructor(private readonly prisma: PrismaService) {}

  async getProgress(cycleId: number) {
    const cycle = await this.prisma.perfCycle.findFirst({
      where: { id: cycleId, deletedAt: null },
      select: {
        id: true,
        name: true,
        status: true,
        plannedStartAt: true,
      },
    });
    if (!cycle) throw new NotFoundException('绩效周期不存在');
    const latestStartFailure =
      cycle.status === 'SCHEDULED'
        ? await this.prisma.perfNotificationEvent.findFirst({
            where: { cycleId, type: 'CYCLE_START_FAILED' },
            select: { payload: true, createdAt: true },
            orderBy: { id: 'desc' },
          })
        : null;
    const [participants, taskRows] = await Promise.all([
      this.prisma.perfParticipant.findMany({
        where: { cycleId },
        select: { id: true, employeeOpenId: true, status: true },
        orderBy: { id: 'asc' },
      }),
      this.prisma.perfEvaluationTask.findMany({
        where: { cycleId },
        select: {
          id: true,
          participantId: true,
          type: true,
          startAt: true,
          reminderDeadlineAt: true,
          openedAt: true,
          completedAt: true,
        },
        orderBy: [{ type: 'asc' }, { participantId: 'asc' }],
      }),
    ]);
    const employees = await this.prisma.larkUser.findMany({
      where: {
        open_id: {
          in: participants.map((participant) => participant.employeeOpenId),
        },
      },
      select: { open_id: true, name: true },
    });
    const employeeNameMap = new Map(
      employees.map((employee) => [employee.open_id, employee.name]),
    );
    const statusOf = (task: (typeof taskRows)[number]): TaskFactStatus =>
      task.completedAt ? 'COMPLETED' : task.openedAt ? 'OPEN' : 'WAITING';
    const tasks = taskRows.map((task) => ({ ...task, status: statusOf(task) }));
    const participantMap = new Map(
      participants.map((participant) => [participant.id, participant]),
    );
    const lockedStatuses = new Set([
      'CALIBRATED',
      'RESULT_PUBLISHED',
      'CONFIRMED',
      'APPEALING',
      'RE_CONFIRMING',
      'NO_RESULT',
      'WITHDRAWN',
    ]);
    const totals = {
      participants: participants.length,
      tasks: tasks.length,
      notStarted: tasks.filter((task) => task.status === 'WAITING').length,
      open: tasks.filter((task) => task.status === 'OPEN').length,
      submitted: tasks.filter((task) => task.status === 'COMPLETED').length,
      locked: participants.filter((participant) =>
        lockedStatuses.has(participant.status),
      ).length,
    };
    const stages = [...new Set(tasks.map((task) => task.type))].map((stage) => {
      const rows = tasks.filter((task) => task.type === stage);
      return {
        stage,
        total: rows.length,
        notStarted: rows.filter((task) => task.status === 'WAITING').length,
        open: rows.filter((task) => task.status === 'OPEN').length,
        submitted: rows.filter((task) => task.status === 'COMPLETED').length,
        failed: 0,
      };
    });
    // AI 是独立非阻塞参考，不列入“缺失项”；人工任务未完成才需要运营跟进。
    const missingItems = tasks
      .filter((task) => task.type !== 'AI' && task.status !== 'COMPLETED')
      .map((task) => ({
        code: task.status === 'WAITING' ? 'TASK_NOT_OPEN' : 'TASK_INCOMPLETE',
        participantId: task.participantId,
        employeeOpenId:
          participantMap.get(task.participantId)?.employeeOpenId ?? null,
        employeeName: (() => {
          const openId = participantMap.get(task.participantId)?.employeeOpenId;
          return openId ? (employeeNameMap.get(openId) ?? null) : null;
        })(),
        stage: task.type,
        message:
          task.status === 'WAITING'
            ? `${task.type} 任务尚未开放`
            : `${task.type} 任务尚未完成`,
        action: task.status === 'WAITING' ? '查看计划' : '催办',
      }));
    const nextActions =
      cycle.status === 'SCHEDULED'
        ? [
            {
              code: 'WAIT_FOR_ACTIVATION',
              label: '等待计划时间自动启动',
              href: `/cycles/${cycleId}`,
            },
          ]
        : missingItems.length > 0
          ? [
              {
                code: 'FOLLOW_UP_TASKS',
                label: '跟进未完成任务',
                href: `/cycles/${cycleId}?tab=participants`,
              },
            ]
          : [
              {
                code: 'REVIEW_NEXT_STEP',
                label: '检查后续校准条件',
                href: `/calibration?cycleId=${cycleId}`,
              },
            ];
    const schedules = [...new Set(tasks.map((task) => task.type))].map(
      (stage) => {
        const task = tasks.find((item) => item.type === stage);
        return {
          stage,
          startAt: task?.startAt ?? null,
          reminderDeadlineAt: task?.reminderDeadlineAt ?? null,
        };
      },
    );

    const failurePayload = latestStartFailure?.payload;
    const activationIssues =
      failurePayload &&
      typeof failurePayload === 'object' &&
      !Array.isArray(failurePayload) &&
      'issues' in failurePayload &&
      Array.isArray(failurePayload.issues)
        ? failurePayload.issues
        : null;
    const startFailure = latestStartFailure
      ? {
          occurredAt: latestStartFailure.createdAt,
          issues: activationIssues ?? [],
        }
      : null;

    return {
      generatedAt: new Date(),
      cycle,
      totals,
      stages,
      tasks,
      missingItems,
      nextActions,
      // 只在仍为 SCHEDULED 时展示最近一次失败；成功 ACTIVE 后自然清空。
      startFailure,
      activationIssues,
      schedules,
    };
  }
}
