import { PerfLegacyMigrationRunStatus } from '../generated/prisma/enums';
import type { PrismaService } from '../shared/database/prisma.service';
import { buildLegacyFormSnapshot } from './legacy-migration-domain';
import { LegacyMigrationReadinessService } from './legacy-migration-readiness.service';
import {
  LegacyMigrationService,
  rebuildSubmissionItems,
} from './legacy-migration.service';

jest.mock('../generated/prisma/client', () => ({ PrismaClient: class {} }), {
  virtual: true,
});
jest.mock('../shared/database/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfConfigTemplateVersionStatus: { DRAFT: 'DRAFT', PUBLISHED: 'PUBLISHED' },
    PerfEvaluationTaskType: {
      SELF: 'SELF',
      PEER: 'PEER',
      MANAGER: 'MANAGER',
      AI: 'AI',
    },
    PerfFormDimensionKind: {
      REGULAR: 'REGULAR',
      TEXT: 'TEXT',
      PROMOTION: 'PROMOTION',
    },
    PerfFormItemType: {
      RATING: 'RATING',
      SCORE: 'SCORE',
      LONG_TEXT: 'LONG_TEXT',
      MARKDOWN: 'MARKDOWN',
      ATTACHMENT: 'ATTACHMENT',
      LINK: 'LINK',
    },
    PerfFormTemplateVersionStatus: { DRAFT: 'DRAFT', PUBLISHED: 'PUBLISHED' },
    PerfLegacyMigrationItemStatus: {
      MIGRATED: 'MIGRATED',
      FAILED: 'FAILED',
      ROLLED_BACK: 'ROLLED_BACK',
    },
    PerfLegacyMigrationRunStatus: {
      RUNNING: 'RUNNING',
      COMPLETED: 'COMPLETED',
      FAILED: 'FAILED',
      ROLLED_BACK: 'ROLLED_BACK',
    },
    PerfRatingSymbol: { S: 'S', A: 'A', B: 'B', C: 'C' },
    PerfReviewStatus: {
      DRAFT: 'DRAFT',
      SUBMITTED: 'SUBMITTED',
    },
    PerfStageResultMode: {
      DIRECT_RATING: 'DIRECT_RATING',
      WEIGHTED_RATING: 'WEIGHTED_RATING',
      WEIGHTED_SCORE: 'WEIGHTED_SCORE',
    },
  }),
  { virtual: true },
);

describe('LegacyMigrationService public workflow', () => {
  const runRow = {
    id: 11,
    runKey: 'ticket20-empty',
    cycleId: null,
    dryRun: true,
    status: PerfLegacyMigrationRunStatus.RUNNING,
    readinessReport: null,
    validationReport: null,
    shadowReport: null,
  };

  function createHarness() {
    let storedRun: typeof runRow | null = null;
    const tx = {
      perfLegacyMigrationRun: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      perfLegacyMigrationItem: { updateMany: jest.fn() },
    };
    const prisma = {
      perfLegacyMigrationRun: {
        create: jest.fn().mockImplementation(({ data }) => {
          storedRun = { ...runRow, ...data, cycleId: data.cycleId ?? null };
          return Promise.resolve(storedRun);
        }),
        updateMany: jest.fn().mockImplementation(({ data }) => {
          if (!storedRun) return Promise.resolve({ count: 0 });
          storedRun = { ...storedRun, ...data };
          return Promise.resolve({ count: 1 });
        }),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve(
            (storedRun = {
              ...runRow,
              ...storedRun,
              dryRun: data.dryRun ?? storedRun?.dryRun ?? runRow.dryRun,
              status: data.status,
              validationReport: data.validationReport ?? null,
              shadowReport: data.shadowReport ?? null,
              readinessReport: data.readinessReport ?? null,
            }),
          ),
        ),
        findUnique: jest
          .fn()
          .mockImplementation(() => Promise.resolve(storedRun)),
      },
      perfLegacyMigrationItem: { findMany: jest.fn().mockResolvedValue([]) },
      perfEvaluationSubmission: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      perfEvaluationItemResult: { count: jest.fn().mockResolvedValue(0) },
      perfStageDimensionResult: { count: jest.fn().mockResolvedValue(0) },
      perfPeerRelationAggregate: { count: jest.fn().mockResolvedValue(0) },
      perfCycle: { findMany: jest.fn().mockResolvedValue([]) },
      perfCycleConfigVersion: { findUnique: jest.fn() },
      perfCycleFormSnapshot: { findMany: jest.fn() },
      perfStageResult: { findUnique: jest.fn() },
      $transaction: jest
        .fn()
        .mockImplementation(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
    };
    return {
      tx,
      prisma,
      stageRebuilder: { rebuild: jest.fn() },
      ledger: {
        migrateItem: jest.fn(),
        recordFailure: jest.fn(),
      },
      service: new LegacyMigrationService(
        prisma as unknown as PrismaService,
        { rebuild: jest.fn() } as never,
        {
          migrateItem: jest.fn(),
          recordFailure: jest.fn(),
        } as never,
        new LegacyMigrationReadinessService(prisma as unknown as PrismaService),
      ),
    };
  }

  it('plan 只写批次报告，不开启业务目标事务，且 readiness 明确标记 DRY_RUN_ONLY', async () => {
    const { prisma, service } = createHarness();
    const result = await service.run({
      runKey: 'ticket20-empty',
      dryRun: true,
    });

    expect(result.readiness).toEqual(
      expect.objectContaining({
        ready: false,
        blockers: [expect.objectContaining({ code: 'DRY_RUN_ONLY' })],
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.perfLegacyMigrationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PerfLegacyMigrationRunStatus.COMPLETED,
        }),
      }),
    );
  });

  it('apply 对空来源可重复使用同一 run-key，计数不增长且 readiness 通过', async () => {
    const { prisma, service } = createHarness();
    const first = await service.run({
      runKey: 'ticket20-empty',
      dryRun: false,
    });
    const second = await service.run({
      runKey: 'ticket20-empty',
      dryRun: false,
    });

    expect(first.readiness.ready).toBe(true);
    expect(second.readiness.ready).toBe(true);
    expect(prisma.perfLegacyMigrationRun.create).toHaveBeenCalledTimes(1);
    // 已完成的同 run-key 直接复用已存报告，不重复扫描/创建目标。
    expect(prisma.perfLegacyMigrationItem.findMany).toHaveBeenCalledTimes(2);
  });

  it('report 返回批次与按状态/类型排序的来源账本', async () => {
    const { prisma, service } = createHarness();
    prisma.perfLegacyMigrationRun.findUnique.mockResolvedValue({
      ...runRow,
      items: [],
    });

    await expect(service.getReport('ticket20-empty')).resolves.toEqual(
      expect.objectContaining({ runKey: 'ticket20-empty', items: [] }),
    );
    expect(prisma.perfLegacyMigrationRun.findUnique).toHaveBeenCalledWith({
      where: { runKey: 'ticket20-empty' },
      include: {
        items: { orderBy: [{ status: 'asc' }, { sourceType: 'asc' }] },
      },
    });
  });

  it('assert-ready 对未完成或有 blocker 的报告拒绝切读', async () => {
    const { prisma, service } = createHarness();
    prisma.perfLegacyMigrationRun.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...runRow,
        status: PerfLegacyMigrationRunStatus.COMPLETED,
        readinessReport: {
          ready: false,
          blockers: [{ code: 'COUNT_MISMATCH', count: 1 }],
        },
      });

    await expect(service.assertReady('missing')).rejects.toThrow(
      '不存在或未成功完成',
    );
    await expect(service.assertReady('ticket20-empty')).rejects.toThrow(
      '未达到切读门槛',
    );
  });

  it('rollback 在单事务内只标记账本与批次，不删除不可变迁移产物', async () => {
    const { tx, service } = createHarness();
    tx.perfLegacyMigrationRun.findUnique.mockResolvedValue({
      ...runRow,
      status: PerfLegacyMigrationRunStatus.COMPLETED,
    });
    tx.perfLegacyMigrationRun.update.mockResolvedValue({
      ...runRow,
      status: PerfLegacyMigrationRunStatus.ROLLED_BACK,
    });

    await expect(service.rollback('ticket20-empty')).resolves.toEqual(
      expect.objectContaining({
        status: PerfLegacyMigrationRunStatus.ROLLED_BACK,
      }),
    );
    expect(tx.perfLegacyMigrationItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ROLLED_BACK' }),
      }),
    );
    expect(tx.perfLegacyMigrationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PerfLegacyMigrationRunStatus.ROLLED_BACK,
        }),
      }),
    );
  });

  it('已回滚 run-key 或改变执行范围时拒绝复用', async () => {
    const { prisma, service } = createHarness();
    prisma.perfLegacyMigrationRun.findUnique.mockResolvedValueOnce({
      ...runRow,
      status: PerfLegacyMigrationRunStatus.ROLLED_BACK,
    });
    await expect(
      service.run({ runKey: 'ticket20-empty', dryRun: true }),
    ).rejects.toThrow('已回滚批次不可复用');

    prisma.perfLegacyMigrationRun.findUnique.mockResolvedValueOnce({
      ...runRow,
      status: PerfLegacyMigrationRunStatus.FAILED,
      dryRun: true,
      cycleId: 17,
    });
    await expect(
      service.run({ runKey: 'ticket20-empty', dryRun: false, cycleId: 17 }),
    ).rejects.toThrow('不允许改变 dry-run 或 cycle 范围');
  });

  it('RUNNING 批次拒绝并发启动，FAILED 批次用条件更新领取执行权', async () => {
    const running = createHarness();
    running.prisma.perfLegacyMigrationRun.findUnique.mockResolvedValueOnce({
      ...runRow,
      status: PerfLegacyMigrationRunStatus.RUNNING,
    });
    await expect(
      running.service.run({ runKey: 'ticket20-empty', dryRun: true }),
    ).rejects.toThrow('正在执行');
    expect(running.prisma.perfLegacyMigrationRun.create).not.toHaveBeenCalled();

    const failed = createHarness();
    failed.prisma.perfLegacyMigrationRun.findUnique.mockResolvedValueOnce({
      ...runRow,
      status: PerfLegacyMigrationRunStatus.FAILED,
    });
    failed.prisma.perfLegacyMigrationRun.updateMany.mockResolvedValueOnce({
      count: 0,
    });
    await expect(
      failed.service.run({ runKey: 'ticket20-empty', dryRun: true }),
    ).rejects.toThrow('已被其他执行器领取');
  });

  it('草稿允许维度 JSON 不完整，但 SUBMITTED 仍进入严格校验', () => {
    const snapshot = buildLegacyFormSnapshot('D', []);
    expect(rebuildSubmissionItems('PEER', 'DRAFT', null, snapshot)).toEqual({
      items: [],
      issues: [],
    });
    expect(
      rebuildSubmissionItems('PEER', 'SUBMITTED', null, snapshot).issues,
    ).toEqual([expect.objectContaining({ code: 'INVALID_DIMENSION_JSON' })]);
  });
});
