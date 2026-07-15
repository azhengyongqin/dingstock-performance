jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfEvaluationTaskType: {
      SELF: 'SELF',
      PEER: 'PEER',
      MANAGER: 'MANAGER',
      AI: 'AI',
    },
  }),
  { virtual: true },
);

import type { SchedulePreset } from '../config-template/config-template.contract';
import { buildEvaluationTaskSeeds } from './evaluation-task-plan';

const schedulePreset: SchedulePreset = {
  allowStageOverlap: true,
  stages: [
    {
      stage: 'SELF',
      startOffsetMinutes: 0,
      reminderDeadlineOffsetMinutes: 60,
    },
    {
      stage: 'PEER',
      startOffsetMinutes: 180,
      reminderDeadlineOffsetMinutes: 240,
    },
    {
      stage: 'MANAGER',
      startOffsetMinutes: -60,
      reminderDeadlineOffsetMinutes: 120,
    },
  ],
};

describe('buildEvaluationTaskSeeds', () => {
  it('为参与人生成四类任务，已到点的人工任务立即开放', () => {
    const now = new Date('2026-07-14T03:00:00.000Z');
    const tasks = buildEvaluationTaskSeeds({
      cycleId: 100,
      participants: [
        {
          id: 9,
          employeeOpenId: 'ou_employee',
          leaderOpenIdSnapshot: 'ou_leader',
        },
      ],
      plannedStartAt: new Date('2026-07-14T01:00:00.000Z'),
      schedulePreset,
      now,
    });

    expect(tasks).toHaveLength(4);
    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'SELF',
          assigneeOpenId: 'ou_employee',
          openedAt: now,
        }),
        expect.objectContaining({
          type: 'PEER',
          assigneeOpenId: null,
          openedAt: null,
        }),
        expect.objectContaining({
          type: 'MANAGER',
          assigneeOpenId: 'ou_leader',
          openedAt: now,
        }),
        expect.objectContaining({
          type: 'AI',
          assigneeOpenId: null,
          startAt: null,
          reminderDeadlineAt: null,
          openedAt: null,
        }),
      ]),
    );
  });
});
