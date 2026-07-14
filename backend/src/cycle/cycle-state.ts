import { ConflictException } from '@nestjs/common';
import { PerfCycleStatus } from '../generated/prisma/enums';

/**
 * 周期只表达粗粒度生命周期，细阶段由任务和参与人事实派生。
 */
const CYCLE_TRANSITIONS: Record<PerfCycleStatus, PerfCycleStatus[]> = {
  DRAFT: [PerfCycleStatus.SCHEDULED],
  SCHEDULED: [PerfCycleStatus.DRAFT, PerfCycleStatus.ACTIVE],
  ACTIVE: [PerfCycleStatus.ARCHIVED],
  ARCHIVED: [],
};

/** 校验周期状态流转，非法流转抛 409 */
export function assertCycleTransition(
  from: PerfCycleStatus,
  to: PerfCycleStatus,
): void {
  if (!CYCLE_TRANSITIONS[from]?.includes(to)) {
    throw new ConflictException(`周期状态不允许从 ${from} 流转到 ${to}`);
  }
}
