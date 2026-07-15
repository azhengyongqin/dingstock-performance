import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { CalibrationDecisionService } from './calibration-decision.service';

jest.mock('../shared/database/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('../audit/audit.service', () => ({ AuditService: class {} }));
jest.mock('../participant/participant.service', () => ({
  ParticipantService: class {},
}));
jest.mock('../rbac/rbac.service', () => ({ RbacService: class {} }));
jest.mock('../participant/participant-no-result.service', () => ({
  ParticipantNoResultService: class {},
}));
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfCalibrationDecision: { KEEP: 'KEEP', ADJUST: 'ADJUST' },
    PerfCycleStatus: { ACTIVE: 'ACTIVE', ARCHIVED: 'ARCHIVED' },
    PerfEvaluationTaskType: {
      SELF: 'SELF',
      PEER: 'PEER',
      MANAGER: 'MANAGER',
    },
    PerfParticipantStatus: {
      SELF_SUBMITTED: 'SELF_SUBMITTED',
      REVIEWED: 'REVIEWED',
      AI_DONE: 'AI_DONE',
      CALIBRATED: 'CALIBRATED',
      RESULT_PUSHED: 'RESULT_PUSHED',
      RESULT_PUBLISHED: 'RESULT_PUBLISHED',
      CONFIRMED: 'CONFIRMED',
      APPEALING: 'APPEALING',
      RE_CONFIRMING: 'RE_CONFIRMING',
      NO_RESULT: 'NO_RESULT',
      WITHDRAWN: 'WITHDRAWN',
      ARCHIVED: 'ARCHIVED',
    },
    PerfRatingSymbol: { S: 'S', A: 'A', B: 'B', C: 'C' },
    PerfRedLineAction: { CONFIRM: 'CONFIRM', REVOKE: 'REVOKE' },
    PerfRole: { HR: 'HR', ADMIN: 'ADMIN' },
  }),
  { virtual: true },
);

describe('CalibrationDecisionService 逐员工校准决定', () => {
  const participant = {
    id: 7,
    cycleId: 1,
    employeeOpenId: 'ou_employee',
    leaderOpenIdSnapshot: 'ou_leader',
    departmentIdSnapshot: 'od_product',
    status: 'REVIEWED',
    evaluationLockedAt: null,
    cycle: {
      status: 'ACTIVE',
      deletedAt: null,
      currentConfigVersionId: 88,
      evaluationRule: null,
    },
    stageResults: [{ id: 301, stageLevel: 'B' }],
    managerReview: null,
    calibrations: [],
    appeals: [],
    result: null,
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
    perfParticipant: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    perfEvaluationSubmission: { findMany: jest.fn() },
    perfStageResult: { findMany: jest.fn() },
    perfCalibration: { create: jest.fn(), findMany: jest.fn() },
    perfRedLineFinding: { findMany: jest.fn() },
    perfResult: { findUnique: jest.fn() },
    larkUser: { findMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const audit = { record: jest.fn() };
  const rbac = { hasAnyRole: jest.fn(), getOrgScope: jest.fn() };
  const requiredEvaluation = { assertCalibrationReady: jest.fn() };
  let service: CalibrationDecisionService;

  beforeEach(() => {
    jest.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([{ id: 7 }]);
    tx.perfParticipant.findUnique.mockResolvedValue(participant);
    tx.perfParticipant.update.mockResolvedValue({
      ...participant,
      status: 'CALIBRATED',
      evaluationLockedAt: new Date('2026-07-15T10:00:00.000Z'),
    });
    tx.perfEvaluationSubmission.findMany.mockResolvedValue([
      {
        id: 101,
        stage: 'SELF',
        reviewerOpenId: 'ou_employee',
        updatedAt: new Date('2026-07-15T08:00:00.000Z'),
      },
      {
        id: 102,
        stage: 'MANAGER',
        reviewerOpenId: 'ou_leader',
        updatedAt: new Date('2026-07-15T09:00:00.000Z'),
      },
    ]);
    tx.perfStageResult.findMany.mockResolvedValue([
      {
        id: 301,
        stage: 'MANAGER',
        status: 'READY',
        stageLevel: 'B',
        dimensions: [],
        updatedAt: new Date('2026-07-15T09:01:00.000Z'),
      },
    ]);
    tx.perfCalibration.findMany.mockResolvedValue([]);
    tx.perfCalibration.create.mockResolvedValue({
      id: 401,
      participantId: 7,
      decision: 'KEEP',
      beforeLevel: 'B',
      afterLevel: 'B',
      reason: null,
      operatorOpenId: 'ou_leader',
    });
    tx.perfRedLineFinding.findMany.mockResolvedValue([]);
    tx.perfResult.findUnique.mockResolvedValue(null);
    rbac.hasAnyRole.mockResolvedValue(false);
    rbac.getOrgScope.mockResolvedValue([]);
    requiredEvaluation.assertCalibrationReady.mockResolvedValue({
      ready: true,
    });
    service = new CalibrationDecisionService(
      prisma as never,
      audit as never,
      rbac as never,
      requiredEvaluation as never,
    );
  });

  it('首次 KEEP 显式追加决定，并在同一事务锁定人工评估与进入 CALIBRATED', async () => {
    const context = await service.getContext('ou_leader', 7);

    const decision = await service.decide('ou_leader', 7, {
      decision: 'KEEP',
      expectedCalibrationRevision: context.calibrationRevision,
      expectedInputRevision: context.inputRevision,
    });

    expect(decision).toMatchObject({
      id: 401,
      decision: 'KEEP',
      beforeLevel: 'B',
      afterLevel: 'B',
    });
    expect(tx.perfCalibration.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        participantId: 7,
        decision: 'KEEP',
        beforeLevel: 'B',
        afterLevel: 'B',
        reason: null,
        operatorOpenId: 'ou_leader',
        inputRevision: context.inputRevision,
      }),
    });
    expect(tx.perfParticipant.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        evaluationLockedAt: expect.any(Date),
        status: 'CALIBRATED',
      },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('ADJUST 必须填写原因并且不能伪装成与校准前等级相同的调整', async () => {
    const context = await service.getContext('ou_leader', 7);

    await expect(
      service.decide('ou_leader', 7, {
        decision: 'ADJUST',
        afterLevel: 'A',
        expectedCalibrationRevision: context.calibrationRevision,
        expectedInputRevision: context.inputRevision,
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.decide('ou_leader', 7, {
        decision: 'ADJUST',
        afterLevel: 'B',
        reason: '没有实际变化',
        expectedCalibrationRevision: context.calibrationRevision,
        expectedInputRevision: context.inputRevision,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(tx.perfCalibration.create).not.toHaveBeenCalled();
  });

  it('已有 ADJUST 后的 KEEP 回到当前 MANAGER 权威等级，而不是沿用上次调整等级', async () => {
    tx.perfParticipant.findUnique.mockResolvedValue({
      ...participant,
      evaluationLockedAt: new Date('2026-07-15T09:30:00.000Z'),
      calibrations: [{ id: 400, afterLevel: 'A' }],
    });
    tx.perfCalibration.create.mockResolvedValueOnce({
      id: 401,
      participantId: 7,
      decision: 'KEEP',
      beforeLevel: 'A',
      afterLevel: 'B',
      reason: null,
      operatorOpenId: 'ou_leader',
    });
    const context = await service.getContext('ou_leader', 7);

    await service.decide('ou_leader', 7, {
      decision: 'KEEP',
      expectedCalibrationRevision: 400,
      expectedInputRevision: context.inputRevision,
    });

    expect(tx.perfCalibration.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        decision: 'KEEP',
        beforeLevel: 'A',
        afterLevel: 'B',
      }),
    });
  });

  it('拒绝过期的最新校准决定修订，避免并发决定静默覆盖', async () => {
    tx.perfParticipant.findUnique.mockResolvedValue({
      ...participant,
      evaluationLockedAt: new Date('2026-07-15T09:30:00.000Z'),
      calibrations: [{ id: 400, afterLevel: 'A' }],
    });

    await expect(
      service.decide('ou_leader', 7, {
        decision: 'KEEP',
        expectedCalibrationRevision: null,
        expectedInputRevision: 'irrelevant-after-calibration-conflict',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CALIBRATION_REVISION_STALE' }),
    });
    expect(tx.perfCalibration.create).not.toHaveBeenCalled();
  });

  it('人工有效提交、关系阶段结果或红线修订变化后拒绝旧输入，AI 变化不参与修订', async () => {
    const context = await service.getContext('ou_leader', 7);
    tx.perfStageResult.findMany.mockResolvedValue([
      {
        id: 301,
        stage: 'MANAGER',
        status: 'READY',
        stageLevel: 'B',
        dimensions: [],
        updatedAt: new Date('2026-07-15T09:02:00.000Z'),
      },
    ]);

    await expect(
      service.decide('ou_leader', 7, {
        decision: 'KEEP',
        expectedCalibrationRevision: null,
        expectedInputRevision: context.inputRevision,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CALIBRATION_INPUT_STALE' }),
    });
    expect(tx.perfCalibration.create).not.toHaveBeenCalled();
    expect(tx).not.toHaveProperty('perfAiReport');
  });

  it('有效红线存在时拒绝 ADJUST 到非 C，并提示先撤销红线', async () => {
    tx.perfRedLineFinding.findMany.mockResolvedValue([
      {
        id: 501,
        action: 'CONFIRM',
        revokeOfId: null,
        findingType: 'SERIOUS_VIOLATION',
        facts: '重大违规事实',
        evidence: [{ fileToken: 'evidence' }],
        reason: '严重违规已核实',
        operatorOpenId: 'ou_hr',
        createdAt: new Date('2026-07-15T09:10:00.000Z'),
      },
    ]);
    const context = await service.getContext('ou_leader', 7);
    expect(context.activeRedLineFindings).toEqual([
      expect.objectContaining({
        findingType: 'SERIOUS_VIOLATION',
        facts: '重大违规事实',
        evidence: [{ fileToken: 'evidence' }],
        reason: '严重违规已核实',
      }),
    ]);

    await expect(
      service.decide('ou_leader', 7, {
        decision: 'ADJUST',
        afterLevel: 'A',
        reason: '仍希望评为 A',
        expectedCalibrationRevision: null,
        expectedInputRevision: context.inputRevision,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ACTIVE_RED_LINE_FORCES_C' }),
    });
    expect(tx.perfCalibration.create).not.toHaveBeenCalled();
  });

  it('同一旧修订并发提交时只有先进入临界区的一次可以成功', async () => {
    let latestCalibration: { id: number; afterLevel: string } | null = null;
    let serialized = Promise.resolve<unknown>(undefined);
    prisma.$transaction.mockImplementation(
      (callback: (client: typeof tx) => Promise<unknown>) => {
        // 单测用串行队列模拟 PostgreSQL participant FOR UPDATE 临界区。
        const result = serialized.then(() => callback(tx));
        serialized = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      },
    );
    tx.perfParticipant.findUnique.mockImplementation(() =>
      Promise.resolve({
        ...participant,
        evaluationLockedAt: latestCalibration
          ? new Date('2026-07-15T10:00:00.000Z')
          : null,
        calibrations: latestCalibration ? [latestCalibration] : [],
      }),
    );
    tx.perfCalibration.create.mockImplementation(() => {
      latestCalibration = { id: 401, afterLevel: 'B' };
      return Promise.resolve({
        id: 401,
        participantId: 7,
        decision: 'KEEP',
        beforeLevel: 'B',
        afterLevel: 'B',
        reason: null,
        operatorOpenId: 'ou_leader',
      });
    });
    const context = await service.getContext('ou_leader', 7);

    const results = await Promise.allSettled([
      service.decide('ou_leader', 7, {
        decision: 'KEEP',
        expectedCalibrationRevision: null,
        expectedInputRevision: context.inputRevision,
      }),
      service.decide('ou_leader', 7, {
        decision: 'KEEP',
        expectedCalibrationRevision: null,
        expectedInputRevision: context.inputRevision,
      }),
    ]);

    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    const rejection = results.find(
      (item): item is PromiseRejectedResult => item.status === 'rejected',
    );
    expect(rejection?.reason).toBeInstanceOf(ConflictException);
    expect(rejection?.reason.response).toMatchObject({
      code: 'CALIBRATION_REVISION_STALE',
    });
    expect(tx.perfCalibration.create).toHaveBeenCalledTimes(1);
  });

  it('权限只允许当前 Leader、范围 HR 与全局 Admin', async () => {
    tx.perfParticipant.findUnique.mockResolvedValue({
      ...participant,
      leaderOpenIdSnapshot: 'ou_other_leader',
    });
    rbac.hasAnyRole.mockResolvedValue(true);
    rbac.getOrgScope.mockResolvedValue(['od_sales']);

    await expect(service.getContext('ou_hr', 7)).rejects.toThrow(
      ForbiddenException,
    );

    rbac.getOrgScope.mockResolvedValue(null);
    await expect(service.getContext('ou_admin', 7)).resolves.toMatchObject({
      participantId: 7,
    });
  });

  it('授权校准上下文一次返回人工阶段、AI、红线和等级差异摘要', async () => {
    tx.perfParticipant.findUnique.mockResolvedValue({
      ...participant,
      aiReport: {
        status: 'SUCCESS',
        referenceLevel: 'A',
        summary: '交付表现稳定',
      },
    });
    tx.perfEvaluationSubmission.findMany.mockResolvedValue([
      {
        id: 101,
        stage: 'SELF',
        reviewerOpenId: 'ou_employee',
        submittedAt: new Date('2026-07-15T08:00:00.000Z'),
        updatedAt: new Date('2026-07-15T08:00:00.000Z'),
        items: [
          {
            dimensionKey: 'delivery',
            itemKey: 'delivery-result',
            rawLevel: 'A',
          },
        ],
      },
    ]);
    tx.perfStageResult.findMany.mockResolvedValue([
      {
        id: 201,
        stage: 'SELF',
        status: 'READY',
        compositeScore: null,
        stageLevel: 'A',
        dimensions: [{ dimensionKey: 'delivery', level: 'A' }],
        updatedAt: new Date('2026-07-15T08:01:00.000Z'),
      },
      {
        id: 301,
        stage: 'MANAGER',
        status: 'READY',
        compositeScore: '82.00',
        stageLevel: 'B',
        dimensions: [{ dimensionKey: 'delivery', level: 'B' }],
        updatedAt: new Date('2026-07-15T09:01:00.000Z'),
      },
    ]);

    const context = await service.getContext('ou_leader', 7);

    expect(context.humanEvaluations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: 'SELF',
          submissions: [expect.objectContaining({ id: 101 })],
          stageResult: expect.objectContaining({ stageLevel: 'A' }),
        }),
        expect.objectContaining({
          stage: 'PEER',
          submissions: [],
          stageResult: null,
        }),
        expect.objectContaining({
          stage: 'MANAGER',
          stageResult: expect.objectContaining({
            compositeScore: '82.00',
            stageLevel: 'B',
          }),
        }),
      ]),
    );
    expect(context.aiReport).toMatchObject({ referenceLevel: 'A' });
    expect(context.levelComparison).toMatchObject({
      managerLevel: 'B',
      references: expect.arrayContaining([
        { source: 'SELF', level: 'A', differsFromManager: true },
        { source: 'PEER', level: null, differsFromManager: false },
        { source: 'AI', level: 'A', differsFromManager: true },
      ]),
      calibration: { beforeLevel: 'B', currentLevel: 'B', changed: false },
    });
  });

  it('结果已发布后允许追加重新校准决定，由结果服务判断是否产生新版本', async () => {
    tx.perfParticipant.findUnique.mockResolvedValue({
      ...participant,
      status: 'RESULT_PUBLISHED',
      evaluationLockedAt: new Date('2026-07-15T10:00:00.000Z'),
      calibrations: [{ id: 400, afterLevel: 'B' }],
    });
    const context = await service.getContext('ou_leader', 7);

    await expect(
      service.decide('ou_leader', 7, {
        decision: 'KEEP',
        expectedCalibrationRevision: 400,
        expectedInputRevision: context.inputRevision,
      }),
    ).resolves.toMatchObject({ decision: 'KEEP', afterLevel: 'B' });
    expect(tx.perfCalibration.create).toHaveBeenCalled();
    expect(tx.perfParticipant.update).not.toHaveBeenCalled();
  });

  it('申诉处理中仅在存在未关闭申诉时允许按双修订追加重新校准决定', async () => {
    tx.perfParticipant.findUnique.mockResolvedValue({
      ...participant,
      status: 'APPEALING',
      evaluationLockedAt: new Date('2026-07-15T10:00:00.000Z'),
      calibrations: [{ id: 400, afterLevel: 'B' }],
      appeals: [{ id: 501, status: 'PENDING' }],
    });
    const context = await service.getContext('ou_leader', 7);
    tx.perfCalibration.create.mockResolvedValueOnce({
      id: 401,
      participantId: 7,
      decision: 'ADJUST',
      beforeLevel: 'B',
      afterLevel: 'A',
      reason: '申诉证据支持改判',
      operatorOpenId: 'ou_leader',
    });

    await expect(
      service.decide('ou_leader', 7, {
        decision: 'ADJUST',
        afterLevel: 'A',
        reason: '申诉证据支持改判',
        expectedCalibrationRevision: 400,
        expectedInputRevision: context.inputRevision,
      }),
    ).resolves.toMatchObject({ decision: 'ADJUST', afterLevel: 'A' });
    expect(tx.perfCalibration.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        participantId: 7,
        decision: 'ADJUST',
        afterLevel: 'A',
      }),
    });
  });

  it('SELF_SUBMITTED 仍按有效提交门槛派生完成度并允许决定', async () => {
    tx.perfParticipant.findUnique.mockResolvedValue({
      ...participant,
      status: 'SELF_SUBMITTED',
    });
    const context = await service.getContext('ou_leader', 7);

    await expect(
      service.decide('ou_leader', 7, {
        decision: 'KEEP',
        expectedCalibrationRevision: null,
        expectedInputRevision: context.inputRevision,
      }),
    ).resolves.toMatchObject({ decision: 'KEEP' });
    expect(requiredEvaluation.assertCalibrationReady).toHaveBeenCalledWith(
      7,
      tx,
    );
  });
});
