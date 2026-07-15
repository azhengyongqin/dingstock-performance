import { ConflictException } from '@nestjs/common';
import { PerfParticipantStatus } from '../generated/prisma/enums';
import { assertParticipantTransition } from './participant-state';

describe('切换后的参与者结果生命周期', () => {
  const legal: [PerfParticipantStatus, PerfParticipantStatus][] = [
    [PerfParticipantStatus.ACTIVE, PerfParticipantStatus.CALIBRATED],
    [PerfParticipantStatus.ACTIVE, PerfParticipantStatus.NO_RESULT],
    [PerfParticipantStatus.ACTIVE, PerfParticipantStatus.WITHDRAWN],
    [PerfParticipantStatus.CALIBRATED, PerfParticipantStatus.RESULT_PUBLISHED],
    [PerfParticipantStatus.RESULT_PUBLISHED, PerfParticipantStatus.CONFIRMED],
    [PerfParticipantStatus.RESULT_PUBLISHED, PerfParticipantStatus.APPEALING],
    [PerfParticipantStatus.APPEALING, PerfParticipantStatus.RESULT_PUBLISHED],
    [PerfParticipantStatus.APPEALING, PerfParticipantStatus.RE_CONFIRMING],
    [PerfParticipantStatus.RE_CONFIRMING, PerfParticipantStatus.CONFIRMED],
    [PerfParticipantStatus.NO_RESULT, PerfParticipantStatus.ACTIVE],
  ];

  it.each(legal)('允许 %s → %s', (from, to) => {
    expect(() => assertParticipantTransition(from, to)).not.toThrow();
  });

  it('拒绝映射之外的流转', () => {
    expect(() =>
      assertParticipantTransition(
        PerfParticipantStatus.CONFIRMED,
        PerfParticipantStatus.APPEALING,
      ),
    ).toThrow(ConflictException);
  });
});
