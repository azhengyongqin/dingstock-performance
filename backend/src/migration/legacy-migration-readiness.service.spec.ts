import type { PrismaService } from '../shared/database/prisma.service';
import { LegacyMigrationReadinessService } from './legacy-migration-readiness.service';

jest.mock('../generated/prisma/client', () => ({ PrismaClient: class {} }), {
  virtual: true,
});
jest.mock('../shared/database/prisma.service', () => ({
  PrismaService: class {},
}));

describe('LegacyMigrationReadinessService', () => {
  it('按业务键、有效 item/维度/关系/结果版本和状态闭合形成 readiness', async () => {
    const prisma = {
      perfLegacyMigrationItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            sourceType: 'CYCLE_CONFIGURATION',
            sourceBusinessKey: 'perf_cycles:17',
          },
        ]),
      },
    };
    const service = new LegacyMigrationReadinessService(
      prisma as unknown as PrismaService,
    );

    const result = await service.build({
      runId: 20,
      dryRun: false,
      sourceCounts: {
        cycles: 1,
        submittedReviews: 1,
        itemResults: 2,
        dimensionResults: 1,
        relationResults: 1,
        results: 1,
      },
      targetCounts: {
        cycles: 1,
        submittedReviews: 1,
        itemResults: 1,
        dimensionResults: 1,
        relationResults: 0,
        results: 1,
      },
      expectedBusinessKeys: [
        'CYCLE_CONFIGURATION|perf_cycles:17',
        'PEER_SUBMISSION|perf_reviews:9',
      ],
      issues: [],
      shadows: [],
      statusMappings: [
        {
          businessKey: 'cycle:17/employee:ou_1',
          sourceStatus: 'ARCHIVED',
          targetStatus: null,
          closed: false,
        },
      ],
    });

    expect(result.readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'COUNT_MISMATCH', count: 2 }),
        expect.objectContaining({ code: 'MISSING_BUSINESS_KEY', count: 1 }),
        expect.objectContaining({ code: 'UNCLOSED_STATUS', count: 1 }),
      ]),
    );
    expect(result.validationReport).toEqual(
      expect.objectContaining({
        businessKeys: expect.objectContaining({ expected: 2, migrated: 1 }),
      }),
    );
  });
});
