import { generateCyclePlan, validateCyclePlan } from './cycle-plan';

describe('cycle-plan', () => {
  const preset = {
    allowStageOverlap: false,
    stages: [
      {
        stage: 'SELF' as const,
        startOffsetMinutes: 0,
        reminderDeadlineOffsetMinutes: 60,
      },
      {
        stage: 'PEER' as const,
        startOffsetMinutes: 60,
        reminderDeadlineOffsetMinutes: 120,
      },
      {
        stage: 'MANAGER' as const,
        startOffsetMinutes: 120,
        reminderDeadlineOffsetMinutes: 180,
      },
    ],
  };

  it('基于带时区的计划启动时间生成绝对时间，不依赖服务器本地时区', () => {
    const result = generateCyclePlan('2026-07-14T09:00:00+08:00', preset);

    expect(result.stages).toEqual([
      {
        stage: 'SELF',
        startAt: '2026-07-14T01:00:00.000Z',
        reminderDeadlineAt: '2026-07-14T02:00:00.000Z',
      },
      {
        stage: 'PEER',
        startAt: '2026-07-14T02:00:00.000Z',
        reminderDeadlineAt: '2026-07-14T03:00:00.000Z',
      },
      {
        stage: 'MANAGER',
        startAt: '2026-07-14T03:00:00.000Z',
        reminderDeadlineAt: '2026-07-14T04:00:00.000Z',
      },
    ]);
    expect(validateCyclePlan(result)).toEqual([]);
  });

  it('一次返回缺阶段、提醒早于开始和禁止重叠等全部问题', () => {
    const issues = validateCyclePlan({
      allowStageOverlap: false,
      stages: [
        {
          stage: 'SELF',
          startAt: '2026-07-14T01:00:00.000Z',
          reminderDeadlineAt: '2026-07-14T03:00:00.000Z',
        },
        {
          stage: 'PEER',
          startAt: '2026-07-14T02:00:00.000Z',
          reminderDeadlineAt: '2026-07-14T01:00:00.000Z',
        },
      ],
    });

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'SCHEDULE_STAGE_MISSING',
        'SCHEDULE_DEADLINE_NOT_AFTER_START',
        'SCHEDULE_STAGE_OVERLAP',
      ]),
    );
  });

  it('拒绝不带时区的计划启动时间', () => {
    expect(() => generateCyclePlan('2026-07-14T09:00:00', preset)).toThrow(
      '计划启动时间必须包含时区',
    );
  });
});
