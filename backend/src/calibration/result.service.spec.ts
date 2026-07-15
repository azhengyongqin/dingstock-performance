import { ResultService } from './result.service';

jest.mock('../shared/database/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('../audit/audit.service', () => ({ AuditService: class {} }));
jest.mock('../participant/participant.service', () => ({
  ParticipantService: class {},
}));
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfParticipantStatus: {
      RESULT_PUSHED: 'RESULT_PUSHED',
      CONFIRMED: 'CONFIRMED',
      APPEALING: 'APPEALING',
      RE_CONFIRMING: 'RE_CONFIRMING',
      ARCHIVED: 'ARCHIVED',
    },
  }),
  { virtual: true },
);

describe('ResultService 员工结果隐私边界', () => {
  it('员工结果查询既不关联也不返回 AI 报告、等级或生成状态', async () => {
    const prisma = {
      perfParticipant: {
        findFirst: jest.fn().mockResolvedValue({
          id: 7,
          cycleId: 1,
          status: 'RESULT_PUSHED',
          isPromotionEnabled: false,
          cycle: { id: 1, name: '2026 上半年绩效', status: 'ACTIVE' },
          result: { id: 19, finalLevel: 'A', promotionResult: null },
          appeals: [],
        }),
      },
      perfDimension: { findFirst: jest.fn() },
    };
    const service = new ResultService(
      prisma as never,
      {} as never,
      {} as never,
    );

    const response = await service.getCurrent('ou_employee', 1);

    expect(prisma.perfParticipant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.not.objectContaining({ aiReport: expect.anything() }),
      }),
    );
    expect(JSON.stringify(response)).not.toMatch(
      /aiReport|aiReference|referenceLevel|generatedAt/,
    );
  });
});
