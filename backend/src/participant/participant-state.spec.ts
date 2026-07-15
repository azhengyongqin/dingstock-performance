import { ConflictException } from '@nestjs/common';
import { PerfParticipantStatus } from '../generated/prisma/enums';
import { assertParticipantTransition } from './participant-state';

describe('参与者状态机', () => {
  const legal: [PerfParticipantStatus, PerfParticipantStatus][] = [
    [
      PerfParticipantStatus.PENDING_SELF_REVIEW,
      PerfParticipantStatus.SELF_SUBMITTED,
    ],
    [PerfParticipantStatus.SELF_SUBMITTED, PerfParticipantStatus.RETURNED],
    [PerfParticipantStatus.SELF_SUBMITTED, PerfParticipantStatus.REVIEWED],
    [PerfParticipantStatus.RETURNED, PerfParticipantStatus.SELF_SUBMITTED],
    [PerfParticipantStatus.REVIEWED, PerfParticipantStatus.CALIBRATED],
    [PerfParticipantStatus.AI_DONE, PerfParticipantStatus.CALIBRATED],
    [PerfParticipantStatus.CALIBRATED, PerfParticipantStatus.RESULT_PUSHED],
    [PerfParticipantStatus.RESULT_PUSHED, PerfParticipantStatus.CONFIRMED],
    [PerfParticipantStatus.RESULT_PUSHED, PerfParticipantStatus.APPEALING],
    [PerfParticipantStatus.APPEALING, PerfParticipantStatus.RE_CONFIRMING],
    [PerfParticipantStatus.RE_CONFIRMING, PerfParticipantStatus.CONFIRMED],
    [PerfParticipantStatus.RE_CONFIRMING, PerfParticipantStatus.APPEALING],
    [PerfParticipantStatus.CONFIRMED, PerfParticipantStatus.ARCHIVED],
  ];

  it.each(legal)('允许 %s → %s', (from, to) => {
    expect(() => assertParticipantTransition(from, to)).not.toThrow();
  });

  it('拒绝所有映射表之外的流转', () => {
    const all = Object.values(PerfParticipantStatus);
    const legalSet = new Set(legal.map(([from, to]) => `${from}->${to}`));
    for (const from of all) {
      for (const to of all) {
        if (legalSet.has(`${from}->${to}`)) continue;
        expect(() => assertParticipantTransition(from, to)).toThrow(
          ConflictException,
        );
      }
    }
  });

  it('员工确认结果后不允许再申诉（确认/申诉互斥的终态保证）', () => {
    expect(() =>
      assertParticipantTransition(
        PerfParticipantStatus.CONFIRMED,
        PerfParticipantStatus.APPEALING,
      ),
    ).toThrow(ConflictException);
  });

  it('AI 完成不再推动参与者状态，REVIEWED 不能进入遗留 AI_DONE', () => {
    expect(() =>
      assertParticipantTransition(
        PerfParticipantStatus.REVIEWED,
        PerfParticipantStatus.AI_DONE,
      ),
    ).toThrow(ConflictException);
  });
});
