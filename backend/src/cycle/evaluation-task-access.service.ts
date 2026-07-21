import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PerfCycleStatus,
  PerfEvaluationTaskType,
  PerfAssignmentStatus,
  PerfParticipantStatus,
} from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../shared/database/prisma.service';
import type { NotificationRules } from '../config-template/config-template.contract';
import { NotificationEventService } from '../notification/notification-event.service';

/**
 * 统一任务写入门槛。
 * 所有人工评估保存/提交都必须先通过这里，避免各业务 service 各自解释时间规则。
 */
@Injectable()
export class EvaluationTaskAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationEventService: NotificationEventService,
  ) {}

  /**
   * 读取填写页时的惰性开放入口。
   * 调用方必须先完成对象级鉴权；开始时间未到时仅返回任务预告，不抛写入门槛错误。
   */
  async openIfDue(
    participantId: number,
    type: PerfEvaluationTaskType,
    now = new Date(),
  ) {
    if (type === PerfEvaluationTaskType.AI) return null;
    return this.prisma.$transaction(async (tx) => {
      const task = await this.findTask(tx, participantId, type);
      if (
        !task ||
        task.cycle.deletedAt ||
        task.cycle.status !== PerfCycleStatus.ACTIVE ||
        task.openedAt ||
        task.completedAt ||
        task.participant.status !== PerfParticipantStatus.ACTIVE ||
        !task.startAt ||
        task.startAt.getTime() > now.getTime()
      ) {
        return task;
      }
      return this.openTask(tx, task, now);
    });
  }

  async ensureWritable(
    participantId: number,
    type: PerfEvaluationTaskType,
    now = new Date(),
  ) {
    if (type === PerfEvaluationTaskType.AI) {
      throw new ConflictException('AI 任务不接受人工填写');
    }
    return this.prisma.$transaction(async (tx) => {
      const task = await this.findTask(tx, participantId, type);
      if (!task) throw new NotFoundException('评估任务不存在或周期尚未启动');
      if (
        task.cycle.deletedAt ||
        task.cycle.status !== PerfCycleStatus.ACTIVE
      ) {
        throw new ConflictException('周期当前不允许填写评估任务');
      }
      if (this.isParticipantLocked(task.participant.status)) {
        throw new ConflictException({
          code: 'EVALUATION_PARTICIPANT_LOCKED',
          message: '该员工的评估已收口，不能再修改或重新提交',
        });
      }
      // openedAt 是不可逆事实；已经开放的任务不会因后来调整计划而重新关闭。
      if (task.openedAt) return task;
      if (!task.startAt || task.startAt.getTime() > now.getTime()) {
        throw new ConflictException({
          code: 'EVALUATION_TASK_NOT_OPEN',
          message: '任务尚未到开始时间，暂不能保存或提交',
          startAt: task.startAt,
        });
      }
      return this.openTask(tx, task, now);
    });
  }

  private findTask(
    tx: Prisma.TransactionClient,
    participantId: number,
    type: PerfEvaluationTaskType,
  ) {
    return tx.perfEvaluationTask.findUnique({
      where: { participantId_type: { participantId, type } },
      include: {
        cycle: {
          select: {
            status: true,
            deletedAt: true,
            name: true,
            ownerOpenId: true,
            currentConfigVersion: { select: { notificationRules: true } },
          },
        },
        participant: {
          select: {
            status: true,
            leaderOpenIdSnapshot: true,
            reviewerAssignments: {
              where: { status: { not: PerfAssignmentStatus.REPLACED } },
              select: { reviewerOpenId: true },
            },
          },
        },
      },
    });
  }

  private async openTask(
    tx: Prisma.TransactionClient,
    task: NonNullable<
      Awaited<ReturnType<EvaluationTaskAccessService['findTask']>>
    >,
    now: Date,
  ) {
    // 条件更新只允许一个并发请求成为开放者，避免重复发出任务开放通知。
    const result = await tx.perfEvaluationTask.updateMany({
      where: {
        id: task.id,
        openedAt: null,
        completedAt: null,
        // 防止查询任务后、写入 openedAt 前恰好发生中途退出。
        participant: { status: PerfParticipantStatus.ACTIVE },
      },
      data: { openedAt: now },
    });
    if (result.count === 0) {
      return tx.perfEvaluationTask.findUniqueOrThrow({
        where: { id: task.id },
        include: {
          cycle: {
            select: {
              status: true,
              deletedAt: true,
              name: true,
              ownerOpenId: true,
              currentConfigVersion: {
                select: { notificationRules: true },
              },
            },
          },
          participant: {
            select: {
              status: true,
              leaderOpenIdSnapshot: true,
              reviewerAssignments: {
                where: { status: { not: PerfAssignmentStatus.REPLACED } },
                select: { reviewerOpenId: true },
              },
            },
          },
        },
      });
    }
    const rules = task.cycle.currentConfigVersion
      ?.notificationRules as unknown as NotificationRules | undefined;
    const rule = rules?.stages.find(
      (item) => item.stage === task.type,
    )?.taskOpened;
    if (rule) {
      await this.notificationEventService.enqueueTaskOpenedEvents(
        {
          id: task.id,
          cycleId: task.cycleId,
          type: task.type,
          assigneeOpenId: task.assigneeOpenId,
          openedAt: now,
          reminderDeadlineAt: task.reminderDeadlineAt,
          cycleName: task.cycle.name,
          cycleOwnerOpenId: task.cycle.ownerOpenId,
          leaderOpenId: task.participant.leaderOpenIdSnapshot,
          peerReviewerOpenIds: task.participant.reviewerAssignments.map(
            (assignment) => assignment.reviewerOpenId,
          ),
          rule,
        },
        tx,
      );
    }
    // reminderDeadlineAt 只供通知使用，这里刻意不做截止判断。
    return { ...task, openedAt: now };
  }

  private isParticipantLocked(status: string) {
    // 参与者状态只描述结果生命周期；进入校准后人工任务统一只读。
    return new Set([
      'CALIBRATED',
      'RESULT_PUBLISHED',
      'CONFIRMED',
      'APPEALING',
      'RE_CONFIRMING',
      'NO_RESULT',
      'WITHDRAWN',
    ]).has(status);
  }
}
