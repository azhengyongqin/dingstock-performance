import { Injectable } from '@nestjs/common';
import {
  PerfAssignmentStatus,
  PerfEvaluationTaskType,
  PerfReviewStatus,
} from '../generated/prisma/enums';
import { PrismaService } from '../shared/database/prisma.service';

export type ReviewTaskItem = {
  taskType: 'REVIEW' | 'MANAGER_REVIEW';
  participantId: number;
  assignmentId?: number;
  relation?: string;
  status: 'PENDING' | 'SUBMITTED';
  submittedAt?: Date | null;
  task: {
    id: number;
    startAt: Date | null;
    reminderDeadlineAt: Date | null;
    openedAt: Date | null;
    completedAt: Date | null;
  } | null;
  cycle: { id: number; name: string; status: string };
  employee: {
    open_id: string;
    name?: string;
    avatar?: unknown;
    job_title?: string | null;
  } | null;
};

/** 旧答卷入口移除后，仅保留基于统一提交的评审任务查询。 */
@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async listMyTasks(reviewerOpenId: string) {
    const assignments = await this.prisma.perfReviewerAssignment.findMany({
      where: {
        reviewerOpenId,
        status: { not: PerfAssignmentStatus.REPLACED },
        cycle: { deletedAt: null, status: 'ACTIVE' },
      },
      include: {
        participant: true,
        cycle: { select: { id: true, name: true, status: true } },
        submissions: {
          where: {
            stage: PerfEvaluationTaskType.PEER,
            status: PerfReviewStatus.SUBMITTED,
          },
          select: { submittedAt: true },
          take: 1,
        },
      },
      orderBy: { id: 'desc' },
    });
    const managed = await this.prisma.perfParticipant.findMany({
      where: {
        leaderOpenIdSnapshot: reviewerOpenId,
        cycle: { deletedAt: null, status: 'ACTIVE' },
      },
      include: {
        evaluationSubmissions: {
          where: {
            stage: PerfEvaluationTaskType.MANAGER,
            status: PerfReviewStatus.SUBMITTED,
          },
          select: { submittedAt: true },
          take: 1,
        },
        cycle: { select: { id: true, name: true, status: true } },
      },
      orderBy: { id: 'desc' },
    });
    const participantIds = [
      ...assignments.map((item) => item.participantId),
      ...managed.map((item) => item.id),
    ];
    const [taskFacts, users] = await Promise.all([
      this.prisma.perfEvaluationTask.findMany({
        where: {
          participantId: { in: participantIds },
          type: {
            in: [PerfEvaluationTaskType.PEER, PerfEvaluationTaskType.MANAGER],
          },
        },
        select: {
          id: true,
          participantId: true,
          type: true,
          startAt: true,
          reminderDeadlineAt: true,
          openedAt: true,
          completedAt: true,
        },
      }),
      this.prisma.larkUser.findMany({
        where: {
          open_id: {
            in: [
              ...new Set([
                ...assignments.map((item) => item.participant.employeeOpenId),
                ...managed.map((item) => item.employeeOpenId),
              ]),
            ],
          },
        },
        select: { open_id: true, name: true, avatar: true, job_title: true },
      }),
    ]);
    const taskMap = new Map(
      taskFacts.map((task) => [`${task.participantId}:${task.type}`, task]),
    );
    const userMap = new Map(users.map((user) => [user.open_id, user]));
    const items: ReviewTaskItem[] = [
      ...assignments.map((assignment): ReviewTaskItem => ({
        taskType: 'REVIEW',
        participantId: assignment.participantId,
        assignmentId: assignment.id,
        relation: assignment.relation,
        status: assignment.submissions.length ? 'SUBMITTED' : 'PENDING',
        submittedAt: assignment.submissions[0]?.submittedAt ?? null,
        task: taskMap.get(`${assignment.participantId}:PEER`) ?? null,
        cycle: assignment.cycle,
        employee: userMap.get(assignment.participant.employeeOpenId) ?? null,
      })),
      ...managed.map((participant): ReviewTaskItem => ({
        taskType: 'MANAGER_REVIEW',
        participantId: participant.id,
        status: participant.evaluationSubmissions.length
          ? 'SUBMITTED'
          : 'PENDING',
        submittedAt: participant.evaluationSubmissions[0]?.submittedAt ?? null,
        task: taskMap.get(`${participant.id}:MANAGER`) ?? null,
        cycle: participant.cycle,
        employee: userMap.get(participant.employeeOpenId) ?? null,
      })),
    ];
    return { items, total: items.length };
  }
}
