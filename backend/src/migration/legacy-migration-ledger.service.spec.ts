import { PerfLegacyMigrationItemStatus } from '../generated/prisma/enums';
import type { PrismaService } from '../shared/database/prisma.service';
import { LegacyMigrationLedgerService } from './legacy-migration-ledger.service';

jest.mock('../generated/prisma/client', () => ({ PrismaClient: class {} }), {
  virtual: true,
});
jest.mock('../shared/database/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfLegacyMigrationItemStatus: {
      MIGRATED: 'MIGRATED',
      SKIPPED: 'SKIPPED',
      FAILED: 'FAILED',
      ROLLED_BACK: 'ROLLED_BACK',
    },
  }),
  { virtual: true },
);

describe('LegacyMigrationLedgerService', () => {
  function createHarness() {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      perfLegacyMigrationItem: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 9 }),
        update: jest.fn().mockResolvedValue({ id: 9 }),
      },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
    };
    return {
      tx,
      service: new LegacyMigrationLedgerService(
        prisma as unknown as PrismaService,
      ),
    };
  }

  it('在创建目标前先取得来源锁并写入 claim，成功后再升级为 MIGRATED', async () => {
    const { tx, service } = createHarness();
    const createTarget = jest.fn().mockResolvedValue(31);

    await expect(
      service.migrateItem(
        17,
        'PEER_SUBMISSION',
        'perf_reviews:9',
        { id: 9 },
        'PerfEvaluationSubmission',
        createTarget,
      ),
    ).resolves.toBe(31);

    expect(tx.perfLegacyMigrationItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: PerfLegacyMigrationItemStatus.SKIPPED,
        }),
      }),
    );
    const claim = tx.perfLegacyMigrationItem.upsert.mock.calls[0][0] as {
      create: Record<string, unknown>;
    };
    expect(claim.create).not.toHaveProperty('targetId');
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.perfLegacyMigrationItem.upsert.mock.invocationCallOrder[0],
    );
    expect(
      tx.perfLegacyMigrationItem.upsert.mock.invocationCallOrder[0],
    ).toBeLessThan(createTarget.mock.invocationCallOrder[0]);
    expect(createTarget.mock.invocationCallOrder[0]).toBeLessThan(
      tx.perfLegacyMigrationItem.update.mock.invocationCallOrder[0],
    );
    expect(tx.perfLegacyMigrationItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PerfLegacyMigrationItemStatus.MIGRATED,
          targetId: 31,
        }),
      }),
    );
  });

  it('并发失败记录看到已成功来源时不覆盖 MIGRATED', async () => {
    const { tx, service } = createHarness();
    tx.perfLegacyMigrationItem.findUnique.mockResolvedValue({
      id: 9,
      status: PerfLegacyMigrationItemStatus.MIGRATED,
    });

    await service.recordFailure(
      18,
      'PEER_SUBMISSION',
      'perf_reviews:9',
      { id: 9 },
      new Error('late failure'),
    );

    expect(tx.perfLegacyMigrationItem.upsert).not.toHaveBeenCalled();
  });

  it('来源 checksum 冲突失败时保留首次 checksum，后续重跑仍会报告冲突', async () => {
    const { tx, service } = createHarness();
    tx.perfLegacyMigrationItem.findUnique.mockResolvedValue({
      id: 9,
      checksum: 'a'.repeat(64),
      status: PerfLegacyMigrationItemStatus.ROLLED_BACK,
    });

    await service.recordFailure(
      18,
      'PEER_SUBMISSION',
      'perf_reviews:9',
      { id: 9, changed: true },
      new Error('SOURCE_CHANGED_AFTER_MIGRATION'),
    );

    expect(tx.perfLegacyMigrationItem.upsert).not.toHaveBeenCalled();
  });
});
