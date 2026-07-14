import { ConflictException } from '@nestjs/common';
import { PerfCycleStatus } from '../generated/prisma/enums';
import { assertCycleTransition } from './cycle-state';

describe('周期状态机', () => {
  const legal: [PerfCycleStatus, PerfCycleStatus][] = [
    [PerfCycleStatus.DRAFT, PerfCycleStatus.PENDING],
    [PerfCycleStatus.PENDING, PerfCycleStatus.SELF_REVIEW],
    [PerfCycleStatus.PENDING, PerfCycleStatus.DRAFT],
    [PerfCycleStatus.SELF_REVIEW, PerfCycleStatus.REVIEWING],
    [PerfCycleStatus.REVIEWING, PerfCycleStatus.AI_ANALYZING],
    [PerfCycleStatus.REVIEWING, PerfCycleStatus.CALIBRATING],
    [PerfCycleStatus.AI_ANALYZING, PerfCycleStatus.CALIBRATING],
    [PerfCycleStatus.CALIBRATING, PerfCycleStatus.CONFIRMING],
    [PerfCycleStatus.CONFIRMING, PerfCycleStatus.ARCHIVED],
  ];

  it.each(legal)('允许 %s → %s', (from, to) => {
    expect(() => assertCycleTransition(from, to)).not.toThrow();
  });

  it('拒绝所有映射表之外的流转', () => {
    const all = Object.values(PerfCycleStatus);
    const legalSet = new Set(legal.map(([from, to]) => `${from}->${to}`));
    for (const from of all) {
      for (const to of all) {
        if (legalSet.has(`${from}->${to}`)) continue;
        expect(() => assertCycleTransition(from, to)).toThrow(
          ConflictException,
        );
      }
    }
  });

  it('已归档周期不允许任何流转', () => {
    for (const to of Object.values(PerfCycleStatus)) {
      expect(() => assertCycleTransition(PerfCycleStatus.ARCHIVED, to)).toThrow(
        ConflictException,
      );
    }
  });
});
