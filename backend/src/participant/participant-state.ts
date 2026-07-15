import { ConflictException } from '@nestjs/common';
import { PerfParticipantStatus } from '../generated/prisma/enums';

/**
 * 参与者状态机（研发文档 §8.2）。映射表即文档，非法流转抛 409。
 * 归档（周期 close）走批量 updateMany，不经过本状态机。
 */
const PARTICIPANT_TRANSITIONS: Record<
  PerfParticipantStatus,
  PerfParticipantStatus[]
> = {
  PENDING_SELF_REVIEW: [PerfParticipantStatus.SELF_SUBMITTED],
  SELF_SUBMITTED: [
    PerfParticipantStatus.RETURNED,
    PerfParticipantStatus.REVIEWED,
  ],
  RETURNED: [PerfParticipantStatus.SELF_SUBMITTED],
  // AI 不再是参与者阶段；AI_DONE 仅保留给迁移前历史记录继续走向校准。
  REVIEWED: [PerfParticipantStatus.CALIBRATED],
  AI_DONE: [PerfParticipantStatus.CALIBRATED],
  CALIBRATED: [PerfParticipantStatus.RESULT_PUSHED],
  RESULT_PUSHED: [
    PerfParticipantStatus.CONFIRMED,
    PerfParticipantStatus.APPEALING,
  ],
  APPEALING: [PerfParticipantStatus.RE_CONFIRMING],
  RE_CONFIRMING: [
    PerfParticipantStatus.CONFIRMED,
    PerfParticipantStatus.APPEALING,
  ],
  CONFIRMED: [PerfParticipantStatus.ARCHIVED],
  ARCHIVED: [],
};

export function assertParticipantTransition(
  from: PerfParticipantStatus,
  to: PerfParticipantStatus,
): void {
  if (!PARTICIPANT_TRANSITIONS[from]?.includes(to)) {
    throw new ConflictException(`参与者状态不允许从 ${from} 流转到 ${to}`);
  }
}
