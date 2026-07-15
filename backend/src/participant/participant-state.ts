import { ConflictException } from '@nestjs/common';
import { PerfParticipantStatus } from '../generated/prisma/enums';

/** 参与者状态只描述结果生命周期，评估进度由任务与统一提交派生。 */
const PARTICIPANT_TRANSITIONS: Record<
  PerfParticipantStatus,
  PerfParticipantStatus[]
> = {
  ACTIVE: [
    PerfParticipantStatus.CALIBRATED,
    PerfParticipantStatus.NO_RESULT,
    PerfParticipantStatus.WITHDRAWN,
  ],
  CALIBRATED: [PerfParticipantStatus.RESULT_PUBLISHED],
  RESULT_PUBLISHED: [
    PerfParticipantStatus.CONFIRMED,
    PerfParticipantStatus.APPEALING,
  ],
  APPEALING: [
    PerfParticipantStatus.RESULT_PUBLISHED,
    PerfParticipantStatus.RE_CONFIRMING,
  ],
  RE_CONFIRMING: [PerfParticipantStatus.CONFIRMED],
  NO_RESULT: [PerfParticipantStatus.ACTIVE],
  WITHDRAWN: [],
  CONFIRMED: [],
};

export function assertParticipantTransition(
  from: PerfParticipantStatus,
  to: PerfParticipantStatus,
): void {
  if (!PARTICIPANT_TRANSITIONS[from]?.includes(to)) {
    throw new ConflictException(`参与者状态不允许从 ${from} 流转到 ${to}`);
  }
}
