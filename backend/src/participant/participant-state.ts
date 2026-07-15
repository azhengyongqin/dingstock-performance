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
  PENDING_SELF_REVIEW: [
    PerfParticipantStatus.SELF_SUBMITTED,
    PerfParticipantStatus.NO_RESULT,
  ],
  SELF_SUBMITTED: [
    PerfParticipantStatus.RETURNED,
    PerfParticipantStatus.REVIEWED,
    // 评估完成度已改由统一答卷派生；旧 SELF_SUBMITTED 状态可直接进入首次校准。
    PerfParticipantStatus.CALIBRATED,
  ],
  RETURNED: [PerfParticipantStatus.SELF_SUBMITTED],
  // AI 不再是参与者阶段；AI_DONE 仅保留给迁移前历史记录继续走向校准。
  REVIEWED: [PerfParticipantStatus.CALIBRATED],
  AI_DONE: [PerfParticipantStatus.CALIBRATED],
  CALIBRATED: [
    PerfParticipantStatus.RESULT_PUSHED,
    PerfParticipantStatus.RESULT_PUBLISHED,
  ],
  RESULT_PUSHED: [
    PerfParticipantStatus.CONFIRMED,
    PerfParticipantStatus.APPEALING,
  ],
  RESULT_PUBLISHED: [
    PerfParticipantStatus.CONFIRMED,
    PerfParticipantStatus.APPEALING,
  ],
  // 维持原等级时回到原版本确认链；改判发布新版本后进入再次确认。
  APPEALING: [
    PerfParticipantStatus.RESULT_PUBLISHED,
    PerfParticipantStatus.RE_CONFIRMING,
  ],
  // 每人每周期限一次申诉，再次确认阶段不能重新进入申诉。
  RE_CONFIRMING: [PerfParticipantStatus.CONFIRMED],
  NO_RESULT: [],
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
