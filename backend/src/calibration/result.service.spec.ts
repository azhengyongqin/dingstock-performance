import { ConflictException } from '@nestjs/common';
import { ResultService } from './result.service';

jest.mock('../shared/database/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('../audit/audit.service', () => ({ AuditService: class {} }));
jest.mock('../notification/notification-event.service', () => ({
  NotificationEventService: class {},
}));
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfCycleStatus: { ACTIVE: 'ACTIVE' },
    PerfEvaluationTaskType: {
      SELF: 'SELF',
      MANAGER: 'MANAGER',
    },
    PerfNotificationChannel: { BOT_DM: 'BOT_DM' },
    PerfParticipantStatus: {
      CALIBRATED: 'CALIBRATED',
      RESULT_PUBLISHED: 'RESULT_PUBLISHED',
      RESULT_PUSHED: 'RESULT_PUSHED',
      CONFIRMED: 'CONFIRMED',
      APPEALING: 'APPEALING',
      RE_CONFIRMING: 'RE_CONFIRMING',
    },
    PerfRatingSymbol: { S: 'S', A: 'A', B: 'B', C: 'C' },
    PerfRedLineAction: { CONFIRM: 'CONFIRM' },
    PerfReviewStatus: { SUBMITTED: 'SUBMITTED' },
  }),
  { virtual: true },
);

describe('ResultService 不可变结果版本', () => {
  const tx = {
    $queryRaw: jest.fn(),
    perfParticipant: { findUnique: jest.fn(), update: jest.fn() },
    perfResultVersion: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    perfResult: { upsert: jest.fn(), updateMany: jest.fn() },
    perfNotificationEvent: { upsert: jest.fn() },
  };
  const prisma = {
    perfParticipant: { findMany: jest.fn(), findFirst: jest.fn() },
    perfResultVersion: { findFirst: jest.fn() },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const audit = { record: jest.fn() };
  const notifications = {
    enqueueResultPublishedEvent: jest.fn().mockResolvedValue({ id: 1 }),
  };
  let service: ResultService;

  const participant = {
    id: 7,
    cycleId: 1,
    employeeOpenId: 'ou_employee',
    isPromotionEnabled: true,
    status: 'CALIBRATED',
    cycle: {
      id: 1,
      name: '2026 上半年绩效',
      status: 'ACTIVE',
      deletedAt: null,
      currentConfigVersionId: 11,
      currentConfigVersion: {
        ratings: [
          { symbol: 'A', name: '优秀', description: '持续交付高质量结果' },
        ],
      },
      dimensions: [{ type: 'PROMOTION', employeeVisible: true }],
    },
    calibrations: [
      {
        id: 31,
        afterLevel: 'A',
        reason: '内部敏感校准备注，不应向员工公开',
      },
    ],
    redLineFindings: [],
    stageResults: [
      {
        stage: 'MANAGER',
        cycleConfigVersionId: 11,
        status: 'READY',
        compositeScore: { toString: () => '91.50' },
        stageLevel: 'A',
        dimensions: [
          {
            dimensionKey: 'manager:delivery',
            name: '核心业绩',
            score: { toString: () => '92.00' },
            level: 'A',
          },
        ],
      },
      {
        stage: 'SELF',
        cycleConfigVersionId: 11,
        status: 'READY',
        compositeScore: null,
        stageLevel: 'A',
        dimensions: [],
      },
    ],
    evaluationSubmissions: [
      {
        stage: 'SELF',
        items: [
          {
            subformKey: 'subform:SELF',
            dimensionKey: 'self:summary',
            itemKey: 'self:summary:text',
            itemType: 'LONG_TEXT',
            rawLevel: null,
            rawScore: null,
            value: '完成重点项目交付',
          },
          {
            subformKey: 'subform:PROMOTION',
            dimensionKey: 'promotion:self',
            itemKey: 'promotion:self:text',
            itemType: 'LONG_TEXT',
            rawLevel: null,
            rawScore: null,
            value: '晋升自述',
          },
        ],
      },
      {
        stage: 'MANAGER',
        items: [
          {
            subformKey: 'subform:MANAGER',
            dimensionKey: 'manager:comment',
            itemKey: 'manager:comment:text',
            itemType: 'LONG_TEXT',
            rawLevel: null,
            rawScore: null,
            value: 'Leader 公开评语',
          },
          {
            subformKey: 'subform:PROMOTION',
            dimensionKey: 'promotion:leader',
            itemKey: 'promotion:leader:conclusion',
            itemType: 'SINGLE_SELECT',
            rawLevel: null,
            rawScore: null,
            value: '推荐晋升',
          },
        ],
      },
    ],
    formSnapshot: {
      content: {
        subforms: [
          {
            key: 'subform:SELF',
            type: 'SELF',
            dimensions: [
              {
                key: 'self:summary',
                audience: 'EMPLOYEE',
                name: '工作总结',
                items: [
                  {
                    key: 'self:summary:text',
                    title: '本期工作总结',
                    type: 'LONG_TEXT',
                  },
                ],
              },
            ],
          },
          {
            key: 'subform:MANAGER',
            type: 'MANAGER',
            dimensions: [
              {
                key: 'manager:comment',
                audience: 'LEADER',
                name: '综合评语',
                items: [
                  {
                    key: 'manager:comment:text',
                    title: 'Leader 评语',
                    type: 'LONG_TEXT',
                  },
                ],
              },
            ],
          },
          {
            key: 'subform:PROMOTION',
            type: 'PROMOTION',
            dimensions: [],
          },
        ],
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ResultService(
      prisma as never,
      audit as never,
      notifications as never,
    );
    prisma.perfParticipant.findMany.mockResolvedValue([{ id: 7 }]);
    tx.$queryRaw.mockResolvedValue([{ id: 7 }]);
    tx.perfParticipant.findUnique.mockResolvedValue(participant);
    tx.perfResultVersion.findFirst.mockResolvedValue(null);
    tx.perfResultVersion.create.mockResolvedValue({
      id: 41,
      participantId: 7,
      version: 1,
      finalLevel: 'A',
      publishedAt: new Date('2026-07-16T10:00:00.000Z'),
    });
    tx.perfResultVersion.updateMany.mockResolvedValue({ count: 1 });
  });

  it('首次发布冻结员工可见快照，并在同一事务切状态和入幂等通知 outbox', async () => {
    await expect(service.publishCycle('ou_hr', 1, [7])).resolves.toEqual({
      published: 1,
      unchanged: 0,
    });

    expect(tx.perfResultVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        participantId: 7,
        version: 1,
        finalLevel: 'A',
        employeeExplanation: '持续交付高质量结果',
        sourceCalibrationId: 31,
        publishedByOpenId: 'ou_hr',
        resultSnapshot: expect.objectContaining({
          manager: expect.objectContaining({
            compositeScore: '91.50',
            dimensions: [
              expect.objectContaining({ name: '核心业绩', score: '92.00' }),
            ],
            comments: [expect.objectContaining({ value: 'Leader 公开评语' })],
          }),
          self: expect.objectContaining({
            level: 'A',
            items: [expect.objectContaining({ value: '完成重点项目交付' })],
          }),
          promotion: expect.objectContaining({ visible: true }),
        }),
      }),
    });
    expect(tx.perfParticipant.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { status: 'RESULT_PUBLISHED' },
    });
    expect(notifications.enqueueResultPublishedEvent).toHaveBeenCalledWith(
      expect.objectContaining({ resultVersionId: 41, version: 1 }),
      tx,
    );
    expect(JSON.stringify(tx.perfResultVersion.create.mock.calls)).not.toMatch(
      /内部敏感校准|PEER|aiReport|reviewerOpenId|relationAggregates/,
    );
  });

  it('同等级后续校准只保留决定审计，不创建版本、不通知也不重开确认', async () => {
    tx.perfResultVersion.findFirst.mockResolvedValue({
      id: 41,
      version: 1,
      finalLevel: 'A',
      confirmedAt: new Date('2026-07-16T12:00:00.000Z'),
    });
    tx.perfParticipant.findUnique.mockResolvedValue({
      ...participant,
      status: 'CONFIRMED',
      calibrations: [{ ...participant.calibrations[0], id: 32 }],
    });

    await expect(service.publishCycle('ou_hr', 1, [7])).resolves.toEqual({
      published: 0,
      unchanged: 1,
    });

    expect(tx.perfResultVersion.create).not.toHaveBeenCalled();
    expect(tx.perfParticipant.update).not.toHaveBeenCalled();
    expect(notifications.enqueueResultPublishedEvent).not.toHaveBeenCalled();
  });

  it('员工可见等级变化时替代旧版本并发布递增的新版本', async () => {
    tx.perfResultVersion.findFirst.mockResolvedValue({
      id: 41,
      version: 1,
      finalLevel: 'B',
      confirmedAt: new Date('2026-07-16T12:00:00.000Z'),
    });
    tx.perfResultVersion.create.mockResolvedValue({
      id: 42,
      participantId: 7,
      version: 2,
      finalLevel: 'A',
      publishedAt: new Date('2026-07-17T10:00:00.000Z'),
    });

    await service.publishCycle('ou_hr', 1, [7]);

    expect(tx.perfResultVersion.updateMany).toHaveBeenCalledWith({
      where: { id: 41, supersededAt: null },
      data: { supersededAt: expect.any(Date) },
    });
    expect(tx.perfResultVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ version: 2, finalLevel: 'A' }),
    });
  });

  it('申诉处理后同级决定保留原版本并回到原确认链，不产生通知', async () => {
    tx.perfParticipant.findUnique.mockResolvedValue({
      ...participant,
      status: 'APPEALING',
    });
    tx.perfResultVersion.findFirst.mockResolvedValue({
      id: 41,
      version: 1,
      finalLevel: 'A',
      supersededAt: null,
    });

    await expect(
      service.resolveAppeal(
        {
          appealId: 51,
          participantId: 7,
          appealedResultVersionId: 41,
          expectedCalibrationRevision: 31,
          operatorOpenId: 'ou_leader',
        },
        tx as never,
      ),
    ).resolves.toEqual({
      changed: false,
      resultVersionId: 41,
      resolutionCalibrationId: 31,
    });

    expect(tx.perfParticipant.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { status: 'RESULT_PUBLISHED' },
    });
    expect(tx.perfResultVersion.create).not.toHaveBeenCalled();
    expect(notifications.enqueueResultPublishedEvent).not.toHaveBeenCalled();
  });

  it('申诉改判时追加新版本、进入 RE_CONFIRMING 并发送变更通知', async () => {
    tx.perfParticipant.findUnique.mockResolvedValue({
      ...participant,
      status: 'APPEALING',
    });
    tx.perfResultVersion.findFirst.mockResolvedValue({
      id: 41,
      version: 1,
      finalLevel: 'B',
      sourceCalibrationId: 30,
      supersededAt: null,
    });
    tx.perfResultVersion.create.mockResolvedValue({ id: 42, version: 2 });

    await expect(
      service.resolveAppeal(
        {
          appealId: 51,
          participantId: 7,
          appealedResultVersionId: 41,
          expectedCalibrationRevision: 31,
          operatorOpenId: 'ou_leader',
        },
        tx as never,
      ),
    ).resolves.toEqual({
      changed: true,
      resultVersionId: 42,
      resolutionCalibrationId: 31,
    });

    expect(tx.perfResultVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        participantId: 7,
        version: 2,
        finalLevel: 'A',
        sourceCalibrationId: 31,
      }),
    });
    expect(tx.perfParticipant.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { status: 'RE_CONFIRMING' },
    });
    expect(notifications.enqueueResultPublishedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        resultVersionId: 42,
        previousFinalLevel: 'B',
        isReconfirmation: true,
      }),
      tx,
    );
  });

  it('申诉处理引用的校准修订过期时拒绝发布或关闭结果链', async () => {
    tx.perfParticipant.findUnique.mockResolvedValue({
      ...participant,
      status: 'APPEALING',
      calibrations: [{ ...participant.calibrations[0], id: 32 }],
    });

    await expect(
      service.resolveAppeal(
        {
          appealId: 51,
          participantId: 7,
          appealedResultVersionId: 41,
          expectedCalibrationRevision: 31,
          operatorOpenId: 'ou_leader',
        },
        tx as never,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CALIBRATION_REVISION_STALE' }),
    });
    expect(tx.perfResultVersion.create).not.toHaveBeenCalled();
    expect(tx.perfParticipant.update).not.toHaveBeenCalled();
  });

  it('申诉等级变化但仍引用原版本来源决定时，要求先追加显式重新校准', async () => {
    tx.perfParticipant.findUnique.mockResolvedValue({
      ...participant,
      status: 'APPEALING',
    });
    tx.perfResultVersion.findFirst.mockResolvedValue({
      id: 41,
      version: 1,
      finalLevel: 'B',
      sourceCalibrationId: 31,
      supersededAt: null,
    });

    await expect(
      service.resolveAppeal(
        {
          appealId: 51,
          participantId: 7,
          appealedResultVersionId: 41,
          expectedCalibrationRevision: 31,
          operatorOpenId: 'ou_leader',
        },
        tx as never,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'APPEAL_ADJUSTMENT_REQUIRES_NEW_CALIBRATION',
      }),
    });
    expect(tx.perfResultVersion.create).not.toHaveBeenCalled();
  });

  it('员工结果查询只返回当前结果版本的隐私收敛快照', async () => {
    prisma.perfParticipant.findFirst.mockResolvedValue({
      id: 7,
      status: 'RESULT_PUBLISHED',
      cycle: { id: 1, name: '2026 上半年绩效', status: 'ACTIVE' },
      resultVersions: [
        {
          id: 41,
          version: 1,
          finalLevel: 'A',
          employeeExplanation: '持续交付高质量结果',
          resultSnapshot: {
            manager: { dimensions: [], comments: [] },
            self: { items: [] },
            promotion: null,
            peer: { reviewerOpenId: 'ou_secret_reviewer' },
            aiReport: { referenceLevel: 'S' },
            calibrationNote: '内部敏感讨论',
          },
          publishedAt: new Date('2026-07-16T10:00:00.000Z'),
          confirmedAt: null,
          supersededAt: null,
        },
        {
          id: 40,
          version: 0,
          finalLevel: 'B',
          employeeExplanation: null,
          resultSnapshot: {},
          publishedAt: new Date('2026-07-15T10:00:00.000Z'),
          confirmedAt: new Date('2026-07-15T12:00:00.000Z'),
          supersededAt: new Date('2026-07-16T10:00:00.000Z'),
        },
      ],
    });

    const response = await service.getCurrent('ou_employee', 1);

    expect(response).toMatchObject({
      participant: { id: 7, status: 'RESULT_PUBLISHED' },
      result: {
        id: 41,
        version: 1,
        finalLevel: 'A',
        previousFinalLevel: 'B',
        confirmedAt: null,
      },
    });
    expect(prisma.perfParticipant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          cycle: expect.anything(),
          resultVersions: expect.objectContaining({ take: 2 }),
        },
      }),
    );
    expect(JSON.stringify(response)).not.toMatch(
      /appeals|aiReport|peer|reviewer|calibration|relation|内部敏感/i,
    );
  });

  it('确认必须精确命中员工当前看到的 Result Version', async () => {
    tx.perfParticipant.findUnique.mockResolvedValue({
      id: 7,
      employeeOpenId: 'ou_employee',
      status: 'RESULT_PUBLISHED',
      resultVersions: [{ id: 42, version: 2 }],
    });

    await expect(service.confirm('ou_employee', 7, 41)).rejects.toThrow(
      ConflictException,
    );
    expect(tx.perfResultVersion.updateMany).not.toHaveBeenCalled();

    await expect(service.confirm('ou_employee', 7, 42)).resolves.toEqual({
      ok: true,
      resultVersionId: 42,
    });
    expect(tx.perfResultVersion.updateMany).toHaveBeenCalledWith({
      where: {
        id: 42,
        participantId: 7,
        supersededAt: null,
        confirmedAt: null,
      },
      data: {
        confirmedAt: expect.any(Date),
        confirmedByOpenId: 'ou_employee',
      },
    });
    expect(tx.perfParticipant.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { status: 'CONFIRMED' },
    });
  });

  it('员工确认申诉改判后的当前版本会从 RE_CONFIRMING 收口到 CONFIRMED', async () => {
    tx.perfParticipant.findUnique.mockResolvedValue({
      id: 7,
      employeeOpenId: 'ou_employee',
      status: 'RE_CONFIRMING',
      resultVersions: [{ id: 42, version: 2 }],
    });

    await expect(service.confirm('ou_employee', 7, 42)).resolves.toEqual({
      ok: true,
      resultVersionId: 42,
    });
    expect(tx.perfResultVersion.updateMany).toHaveBeenCalledWith({
      where: {
        id: 42,
        participantId: 7,
        supersededAt: null,
        confirmedAt: null,
      },
      data: {
        confirmedAt: expect.any(Date),
        confirmedByOpenId: 'ou_employee',
      },
    });
    expect(tx.perfParticipant.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { status: 'CONFIRMED' },
    });
  });
});
