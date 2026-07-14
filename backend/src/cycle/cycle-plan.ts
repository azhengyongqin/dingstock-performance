import type {
  SchedulePreset,
  ScheduleStage,
} from '../config-template/config-template.contract';

export type CyclePlanStage = {
  stage: ScheduleStage;
  startAt: string;
  reminderDeadlineAt: string;
};

export type CyclePlan = {
  allowStageOverlap: boolean;
  stages: CyclePlanStage[];
};

export type CyclePlanIssue = {
  code:
    | 'SCHEDULE_STAGE_MISSING'
    | 'SCHEDULE_STAGE_DUPLICATED'
    | 'SCHEDULE_TIME_INVALID'
    | 'SCHEDULE_DEADLINE_NOT_AFTER_START'
    | 'SCHEDULE_STAGE_OVERLAP';
  path: string;
  message: string;
};

const REQUIRED_STAGES: ScheduleStage[] = ['SELF', 'PEER', 'MANAGER'];

/** 把配置模板的分钟偏移一次性固化为周期绝对计划。 */
export function generateCyclePlan(
  plannedStartAt: string,
  preset: SchedulePreset,
): CyclePlan {
  // Date 会把无时区字符串解释为服务器本地时间，必须在领域边界提前拒绝。
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(plannedStartAt)) {
    throw new Error('计划启动时间必须包含时区');
  }
  const anchor = new Date(plannedStartAt);
  if (Number.isNaN(anchor.getTime())) {
    throw new Error('计划启动时间格式无效');
  }
  return {
    allowStageOverlap: preset.allowStageOverlap,
    stages: preset.stages.map((row) => ({
      stage: row.stage,
      startAt: new Date(
        anchor.getTime() + row.startOffsetMinutes * 60_000,
      ).toISOString(),
      reminderDeadlineAt: new Date(
        anchor.getTime() + row.reminderDeadlineOffsetMinutes * 60_000,
      ).toISOString(),
    })),
  };
}

/** 校验实际计划并一次返回全部问题，供四步向导定位修复。 */
export function validateCyclePlan(plan: CyclePlan): CyclePlanIssue[] {
  const issues: CyclePlanIssue[] = [];
  for (const stage of REQUIRED_STAGES) {
    const count = plan.stages.filter((row) => row.stage === stage).length;
    if (count === 0) {
      issues.push({
        code: 'SCHEDULE_STAGE_MISSING',
        path: `stages.${stage}`,
        message: `缺少 ${stage} 阶段计划`,
      });
    } else if (count > 1) {
      issues.push({
        code: 'SCHEDULE_STAGE_DUPLICATED',
        path: `stages.${stage}`,
        message: `${stage} 阶段计划只能配置一次`,
      });
    }
  }

  const byStage = new Map<ScheduleStage, { start: number; deadline: number }>();
  plan.stages.forEach((row, index) => {
    const start = Date.parse(row.startAt);
    const deadline = Date.parse(row.reminderDeadlineAt);
    if (!Number.isFinite(start) || !Number.isFinite(deadline)) {
      issues.push({
        code: 'SCHEDULE_TIME_INVALID',
        path: `stages[${index}]`,
        message: `${row.stage} 阶段时间格式无效`,
      });
      return;
    }
    byStage.set(row.stage, { start, deadline });
    if (deadline <= start) {
      issues.push({
        code: 'SCHEDULE_DEADLINE_NOT_AFTER_START',
        path: `stages[${index}].reminderDeadlineAt`,
        message: `${row.stage} 填写提醒时间必须晚于任务开始时间`,
      });
    }
  });

  if (!plan.allowStageOverlap) {
    for (let index = 1; index < REQUIRED_STAGES.length; index += 1) {
      const previous = byStage.get(REQUIRED_STAGES[index - 1]);
      const current = byStage.get(REQUIRED_STAGES[index]);
      if (previous && current && current.start < previous.deadline) {
        issues.push({
          code: 'SCHEDULE_STAGE_OVERLAP',
          path: `stages.${REQUIRED_STAGES[index]}.startAt`,
          message: `${REQUIRED_STAGES[index]} 开始时间早于上一阶段提醒时间`,
        });
      }
    }
  }
  return issues;
}
