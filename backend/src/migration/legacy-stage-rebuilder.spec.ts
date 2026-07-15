import { LegacyStageRebuilder } from './legacy-stage-rebuilder';

describe('LegacyStageRebuilder', () => {
  it('MANAGER 没有已提交答卷时直接写 NO_DATA，不读取空 submissions[0]', async () => {
    const tx = {
      perfCycleConfigVersion: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 20,
          peerStageMode: 'WEIGHTED_SCORE',
          managerStageMode: 'WEIGHTED_SCORE',
        }),
      },
      perfCycleFormSnapshot: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ content: {} }),
      },
      perfEvaluationSubmission: { findMany: jest.fn().mockResolvedValue([]) },
      perfRedLineFinding: { findFirst: jest.fn().mockResolvedValue(null) },
      perfStageResult: { upsert: jest.fn().mockResolvedValue({ id: 31 }) },
    };

    await expect(
      new LegacyStageRebuilder().rebuild(tx as never, {
        cycleId: 17,
        participantId: 9,
        artifacts: { configVersionId: 20, formSnapshotIds: { D: 7, M: 8 } },
        prefix: 'M',
        stage: 'MANAGER',
      }),
    ).resolves.toBe(31);
    expect(tx.perfStageResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'NO_DATA',
          reviewerCount: 0,
        }),
      }),
    );
  });
});
