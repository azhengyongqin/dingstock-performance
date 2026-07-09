import { ConflictException } from '@nestjs/common';
import { PerfCycleStatus } from '../generated/prisma/enums';

/**
 * 周期状态机（研发文档 §8.2）：
 * DRAFT → PENDING → SELF_REVIEW → REVIEWING → AI_ANALYZING → CALIBRATING → CONFIRMING → ARCHIVED
 * 映射表即文档；AI_ANALYZING 在 AI 开关关闭时允许跳过（REVIEWING 直达 CALIBRATING）。
 */
const CYCLE_TRANSITIONS: Record<PerfCycleStatus, PerfCycleStatus[]> = {
  DRAFT: [PerfCycleStatus.PENDING],
  PENDING: [PerfCycleStatus.SELF_REVIEW, PerfCycleStatus.DRAFT],
  SELF_REVIEW: [PerfCycleStatus.REVIEWING],
  REVIEWING: [PerfCycleStatus.AI_ANALYZING, PerfCycleStatus.CALIBRATING],
  AI_ANALYZING: [PerfCycleStatus.CALIBRATING],
  CALIBRATING: [PerfCycleStatus.CONFIRMING],
  CONFIRMING: [PerfCycleStatus.ARCHIVED],
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
