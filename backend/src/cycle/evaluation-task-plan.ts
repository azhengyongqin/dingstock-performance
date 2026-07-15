import type { SchedulePreset } from '../config-template/config-template.contract';
import { PerfEvaluationTaskType } from '../generated/prisma/enums';
import { generateCyclePlan } from './cycle-plan';

export type EvaluationTaskPlanParticipant = {
  id: number;
  employeeOpenId: string;
  leaderOpenIdSnapshot: string | null;
};

export type EvaluationTaskSeed = {
  cycleId: number;
  participantId: number;
  type: PerfEvaluationTaskType;
  assigneeOpenId: string | null;
  startAt: Date | null;
  reminderDeadlineAt: Date | null;
  openedAt: Date | null;
};

/**
 * 从周期快照生成四类任务事实。
 * 周期启动与进行中补加参与人共用此函数，避免两条写路径产生不同开放语义。
 */
export function buildEvaluationTaskSeeds(input: {
  cycleId: number;
  participants: readonly EvaluationTaskPlanParticipant[];
  plannedStartAt: Date;
  schedulePreset: SchedulePreset;
  now: Date;
}): EvaluationTaskSeed[] {
  const plan = generateCyclePlan(
    input.plannedStartAt.toISOString(),
    input.schedulePreset,
  );
  const byStage = new Map(plan.stages.map((stage) => [stage.stage, stage]));

  const humanTask = (
    participant: EvaluationTaskPlanParticipant,
    type: 'SELF' | 'PEER' | 'MANAGER',
  ): EvaluationTaskSeed => {
    const stage = byStage.get(type);
    if (!stage) throw new Error(`周期计划缺少 ${type} 阶段`);
    const startAt = new Date(stage.startAt);
    return {
      cycleId: input.cycleId,
      participantId: participant.id,
      type: PerfEvaluationTaskType[type],
      assigneeOpenId:
        type === 'SELF'
          ? participant.employeeOpenId
          : type === 'MANAGER'
            ? participant.leaderOpenIdSnapshot
            : null,
      startAt,
      reminderDeadlineAt: new Date(stage.reminderDeadlineAt),
      // openedAt 是不可逆事实；补加时已到点的任务必须立刻开放。
      openedAt: startAt.getTime() <= input.now.getTime() ? input.now : null,
    };
  };

  return input.participants.flatMap((participant) => [
    humanTask(participant, 'SELF'),
    humanTask(participant, 'PEER'),
    humanTask(participant, 'MANAGER'),
    {
      cycleId: input.cycleId,
      participantId: participant.id,
      type: PerfEvaluationTaskType.AI,
      assigneeOpenId: null,
      startAt: null,
      reminderDeadlineAt: null,
      openedAt: null,
    },
  ]);
}
