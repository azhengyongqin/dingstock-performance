import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpsertCyclePlanDto } from './cycle.dto';

const validNotification = (stage: 'SELF' | 'PEER' | 'MANAGER') => ({
  stage,
  taskOpened: {
    enabled: true,
    recipient: 'ASSIGNEE',
    ccLeader: false,
    ccHr: true,
  },
  reminder: {
    enabled: true,
    recipient: 'ASSIGNEE',
    ccLeader: true,
    ccHr: true,
    frequency: { type: 'ONCE_AT_DEADLINE' },
  },
});

describe('UpsertCyclePlanDto', () => {
  const valid = {
    allowStageOverlap: false,
    stages: ['SELF', 'PEER', 'MANAGER'].map((stage, index) => ({
      stage,
      startAt: `2026-07-14T0${index + 1}:00:00.000Z`,
      reminderDeadlineAt: `2026-07-14T0${index + 2}:00:00.000Z`,
    })),
    notificationRules: {
      stages: [
        validNotification('SELF'),
        validNotification('PEER'),
        validNotification('MANAGER'),
      ],
    },
  };

  it('接受完整三阶段计划和通知规则', async () => {
    expect(
      await validate(plainToInstance(UpsertCyclePlanDto, valid)),
    ).toHaveLength(0);
  });

  it('拒绝只有阶段名的残缺通知规则', async () => {
    const input = structuredClone(valid);
    input.notificationRules.stages = [
      { stage: 'SELF' },
      { stage: 'PEER' },
      { stage: 'MANAGER' },
    ] as never;

    const errors = await validate(plainToInstance(UpsertCyclePlanDto, input));

    expect(errors.some((error) => error.property === 'notificationRules')).toBe(
      true,
    );
  });

  it('拒绝不带时区的阶段时间', async () => {
    const input = structuredClone(valid);
    input.stages[0].startAt = '2026-07-14T09:00:00';

    const errors = await validate(plainToInstance(UpsertCyclePlanDto, input));

    expect(errors.some((error) => error.property === 'stages')).toBe(true);
  });
});
