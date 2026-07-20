import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AiReportService } from './ai-report.service';
import { AiReportInputBuilder } from './ai-report-input.builder';

jest.mock(
  '../generated/prisma/client',
  () => ({
    PrismaClient: class {},
    Prisma: { DbNull: 'DbNull' },
  }),
  { virtual: true },
);

jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfAiReportStatus: {
      PENDING: 'PENDING',
      GENERATING: 'GENERATING',
      SUCCESS: 'SUCCESS',
      FAILED: 'FAILED',
    },
    PerfCycleStatus: { ACTIVE: 'ACTIVE', ARCHIVED: 'ARCHIVED' },
    PerfEvaluationTaskType: {
      SELF: 'SELF',
      PEER: 'PEER',
      MANAGER: 'MANAGER',
      AI: 'AI',
    },
    PerfReviewStatus: { DRAFT: 'DRAFT', SUBMITTED: 'SUBMITTED' },
    PerfRatingSymbol: { S: 'S', A: 'A', B: 'B', C: 'C' },
    PerfRole: { HR: 'HR', ADMIN: 'ADMIN' },
  }),
  { virtual: true },
);

const submitted = (id: number, stage: string, value: unknown) => ({
  id,
  stage,
  reviewerOpenId: `ou_${stage.toLowerCase()}`,
  formSnapshotId: 88,
  status: 'SUBMITTED',
  submittedAt: new Date(`2026-07-15T0${id}:00:00.000Z`),
  updatedAt: new Date(`2026-07-15T0${id}:00:00.000Z`),
  dimensionAnswers: [
    {
      id: id * 10,
      subformKey: `subform:${stage}`,
      dimensionKey: `dimension:${stage}`,
      scoringMethod: 'RATING',
      rawLevel: null,
      rawScore: null,
      calculationScore: null,
      derivedLevel: null,
      fields: [
        {
          id: id * 100,
          fieldKey: `field:${stage}`,
          fieldType: 'LONG_TEXT',
          value,
        },
      ],
    },
  ],
});

describe('AiReportService 独立异步参考', () => {
  const prisma = {
    perfParticipant: { findUnique: jest.fn() },
    perfEvaluationSubmission: { findMany: jest.fn() },
    perfStageResult: { findMany: jest.fn() },
    perfAiReport: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    perfEvaluationTask: { updateMany: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  const rbac = {
    hasAnyRole: jest.fn(),
    getOrgScope: jest.fn(),
  };
  let service: AiReportService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) =>
        Promise.resolve(callback(prisma)),
    );
    prisma.$queryRaw.mockResolvedValue([{ id: 7 }]);
    prisma.perfParticipant.findUnique.mockResolvedValue({
      id: 7,
      cycleId: 1,
      leaderOpenIdSnapshot: 'ou_leader',
      departmentIdSnapshot: 'od_1',
      cycle: { deletedAt: null, status: 'ACTIVE', currentConfigVersionId: 3 },
    });
    prisma.perfEvaluationSubmission.findMany.mockResolvedValue([
      submitted(1, 'SELF', { text: '已生效自评' }),
      submitted(2, 'PEER', { text: '已生效 360°' }),
      submitted(3, 'MANAGER', { text: '已生效上级评估' }),
    ]);
    prisma.perfStageResult.findMany.mockResolvedValue([
      {
        id: 31,
        stage: 'PEER',
        status: 'READY',
        compositeScore: '86.00',
        initialLevel: 'A',
        stageLevel: 'A',
        updatedAt: new Date('2026-07-15T03:00:00.000Z'),
        dimensions: [],
      },
      {
        id: 32,
        stage: 'MANAGER',
        status: 'READY',
        compositeScore: '88.00',
        initialLevel: 'A',
        stageLevel: 'A',
        updatedAt: new Date('2026-07-15T04:00:00.000Z'),
        dimensions: [],
      },
    ]);
    prisma.perfAiReport.findUnique.mockResolvedValue(null);
    prisma.perfAiReport.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 9, ...data }),
    );
    service = new AiReportService(
      prisma as never,
      rbac as never,
      new AiReportInputBuilder(),
    );
  });

  it('只用当前有效人工提交和当前配置阶段结果排队，并保存稳定输入修订', async () => {
    const report = await service.refreshForParticipant(7);

    expect(prisma.perfEvaluationSubmission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'SUBMITTED' }),
        include: {
          dimensionAnswers: {
            include: { fields: { orderBy: { id: 'asc' } } },
            orderBy: { id: 'asc' },
          },
        },
      }),
    );
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.perfStageResult.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cycleConfigVersionId: 3,
          stage: { in: ['SELF', 'PEER', 'MANAGER'] },
        }),
      }),
    );
    expect(prisma.perfAiReport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        participantId: 7,
        status: 'PENDING',
        inputRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
        inputSnapshot: expect.objectContaining({
          submissions: expect.arrayContaining([
            expect.objectContaining({
              id: 1,
              stage: 'SELF',
              dimensionAnswers: [
                expect.objectContaining({
                  dimensionKey: 'dimension:SELF',
                  fields: [expect.objectContaining({ fieldKey: 'field:SELF' })],
                }),
              ],
            }),
            expect.objectContaining({ id: 3, stage: 'MANAGER' }),
          ]),
        }),
      }),
    });
    expect(JSON.stringify(prisma.perfAiReport.create.mock.calls)).not.toMatch(
      /itemKey|itemType|"items"/,
    );
    expect(report).toEqual(
      expect.objectContaining({ id: 9, status: 'PENDING' }),
    );
  });

  it('相同输入修订幂等，不重复把成功报告改回等待', async () => {
    const first = await service.refreshForParticipant(7);
    prisma.perfAiReport.findUnique.mockResolvedValue({
      ...first,
      status: 'SUCCESS',
      inputRevision: first?.inputRevision,
    });

    const second = await service.refreshForParticipant(7);

    expect(second).toEqual(expect.objectContaining({ status: 'SUCCESS' }));
    expect(prisma.perfAiReport.update).not.toHaveBeenCalled();
  });

  it('正式输入变化会清空旧输出并重新排队，草稿不在查询范围内', async () => {
    prisma.perfAiReport.findUnique.mockResolvedValue({
      id: 9,
      inputRevision: 'old-revision',
      status: 'SUCCESS',
    });
    prisma.perfAiReport.update.mockResolvedValue({ id: 9, status: 'PENDING' });

    await service.refreshForParticipant(7);

    expect(prisma.perfAiReport.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: expect.objectContaining({
        status: 'PENDING',
        referenceLevel: null,
        summary: null,
        generatedAt: null,
        processingRevision: null,
      }),
    });
  });

  it('领取任务使用状态条件更新，旧输入任务不得覆盖新修订', async () => {
    prisma.perfAiReport.findFirst.mockResolvedValue({
      id: 9,
      status: 'PENDING',
      inputRevision: 'revision-1',
      inputSnapshot: { submissions: [] },
      attemptCount: 0,
    });
    prisma.perfAiReport.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const job = await service.claimNext();

    expect(job).toEqual(
      expect.objectContaining({ id: 9, revision: 'revision-1' }),
    );
    await expect(
      service.complete(9, 'revision-1', {
        referenceLevel: 'A',
        summary: '参考报告',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('失败任务保留失败态并可按原输入修订重试，超时运行任务可恢复', async () => {
    prisma.perfAiReport.findUnique.mockResolvedValue({
      id: 9,
      status: 'GENERATING',
      inputRevision: 'revision-1',
      processingRevision: 'revision-1',
      attemptCount: 1,
    });
    prisma.perfAiReport.updateMany.mockResolvedValue({ count: 1 });

    await service.fail(9, 'revision-1', new Error('模型超时'));
    await service.recoverTimedOut(60_000);

    expect(prisma.perfAiReport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          errorMessage: '模型超时',
        }),
      }),
    );
    expect(prisma.perfAiReport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'GENERATING' }),
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });

  it('仅当前 Leader 或授权范围内 HR/Admin 可读取，员工本人也不能读取', async () => {
    prisma.perfAiReport.findUnique.mockResolvedValue({
      id: 9,
      participantId: 7,
      status: 'SUCCESS',
      referenceLevel: 'A',
      summary: '仅管理端可见',
    });

    await expect(service.getForManager('ou_leader', 7)).resolves.toEqual(
      expect.objectContaining({ referenceLevel: 'A' }),
    );

    rbac.hasAnyRole.mockResolvedValue(false);
    await expect(
      service.getForManager('ou_employee', 7),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('只有 FAILED 任务可人工重试，且重试会清空旧输出', async () => {
    prisma.perfAiReport.findUnique.mockResolvedValue({
      id: 9,
      participantId: 7,
      status: 'FAILED',
      inputRevision: 'revision-1',
      inputSnapshot: { submissions: [] },
    });
    prisma.perfAiReport.update.mockResolvedValue({
      id: 9,
      participantId: 7,
      status: 'PENDING',
      inputRevision: 'revision-1',
    });

    await expect(service.retry('ou_leader', 7)).resolves.toEqual(
      expect.objectContaining({ status: 'PENDING' }),
    );
    expect(prisma.perfAiReport.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: expect.objectContaining({
        status: 'PENDING',
        referenceLevel: null,
        summary: null,
        generatedAt: null,
      }),
    });

    prisma.perfAiReport.findUnique.mockResolvedValue({
      id: 9,
      participantId: 7,
      status: 'SUCCESS',
      inputRevision: 'revision-1',
      inputSnapshot: { submissions: [] },
    });
    await expect(service.retry('ou_leader', 7)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('归档周期的 AI 报告保持历史只读，不能刷新或人工重试', async () => {
    prisma.perfParticipant.findUnique.mockResolvedValue({
      id: 7,
      cycleId: 1,
      leaderOpenIdSnapshot: 'ou_leader',
      departmentIdSnapshot: 'od_1',
      cycle: {
        deletedAt: null,
        status: 'ARCHIVED',
        currentConfigVersionId: 3,
      },
    });
    prisma.perfAiReport.findUnique.mockResolvedValue({
      id: 9,
      participantId: 7,
      status: 'SUCCESS',
      referenceLevel: 'A',
      summary: '归档前生成的历史参考',
    });

    await expect(service.getForManager('ou_leader', 7)).resolves.toMatchObject({
      status: 'SUCCESS',
      referenceLevel: 'A',
    });

    await expect(
      service.requestGeneration('ou_leader', 7),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(service.retry('ou_leader', 7)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.perfAiReport.update).not.toHaveBeenCalled();
  });
});
