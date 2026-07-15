import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ParticipantNoResultService } from './participant-no-result.service';

jest.mock('../shared/database/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('../audit/audit.service', () => ({ AuditService: class {} }));
jest.mock('../rbac/rbac.service', () => ({ RbacService: class {} }));
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfCycleStatus: { ACTIVE: 'ACTIVE', ARCHIVED: 'ARCHIVED' },
    PerfAssignmentStatus: { PENDING: 'PENDING' },
    PerfEvaluationTaskType: {
      SELF: 'SELF',
      PEER: 'PEER',
      MANAGER: 'MANAGER',
      AI: 'AI',
    },
    PerfParticipantStatus: {
      PENDING_SELF_REVIEW: 'PENDING_SELF_REVIEW',
      NO_RESULT: 'NO_RESULT',
      WITHDRAWN: 'WITHDRAWN',
    },
    PerfReviewStatus: { SUBMITTED: 'SUBMITTED' },
    PerfSelfReviewStatus: { SUBMITTED: 'SUBMITTED' },
    PerfRole: { HR: 'HR', ADMIN: 'ADMIN' },
    PerfStageResultMode: { DIRECT_RATING: 'DIRECT_RATING' },
    PerfStageResultStatus: { NO_DATA: 'NO_DATA' },
  }),
  { virtual: true },
);

describe('ParticipantNoResultService 必交评估与当前周期无绩效结果', () => {
  const participant = {
    id: 7,
    cycleId: 1,
    employeeOpenId: 'ou_employee',
    departmentIdSnapshot: 'od_product',
    status: 'PENDING_SELF_REVIEW',
    cycle: {
      status: 'ACTIVE',
      deletedAt: null,
      currentConfigVersionId: 88,
      currentConfigVersion: { id: 88, selfStageMode: 'DIRECT_RATING' },
    },
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
    perfParticipant: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    perfEvaluationSubmission: { findMany: jest.fn() },
    perfEvaluationTask: { updateMany: jest.fn() },
    perfReviewerAssignment: { count: jest.fn() },
    perfStageResult: { upsert: jest.fn(), deleteMany: jest.fn() },
    perfResult: { count: jest.fn() },
    perfCalibration: { count: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
    perfEvaluationSubmission: { findMany: jest.fn() },
  };
  const audit = { record: jest.fn() };
  const rbac = {
    hasAnyRole: jest.fn(),
    getOrgScope: jest.fn(),
  };
  let service: ParticipantNoResultService;

  beforeEach(() => {
    jest.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([{ id: 7 }]);
    tx.perfParticipant.findUnique.mockResolvedValue(participant);
    tx.perfParticipant.update.mockResolvedValue({
      ...participant,
      status: 'NO_RESULT',
    });
    tx.perfEvaluationSubmission.findMany.mockResolvedValue([
      { id: 10, stage: 'SELF', status: 'DRAFT' },
      { id: 11, stage: 'MANAGER', status: 'SUBMITTED' },
    ]);
    tx.perfEvaluationTask.updateMany.mockResolvedValue({ count: 3 });
    tx.perfReviewerAssignment.count.mockResolvedValue(1);
    tx.perfResult.count.mockResolvedValue(0);
    tx.perfCalibration.count.mockResolvedValue(0);
    rbac.hasAnyRole.mockResolvedValue(true);
    rbac.getOrgScope.mockResolvedValue(['od_product']);
    service = new ParticipantNoResultService(
      prisma as never,
      audit as never,
      rbac as never,
    );
  });

  it('SELF 与 MANAGER 都有当前有效提交即可校准，PEER/AI 缺失和更新草稿均不阻塞', async () => {
    prisma.perfEvaluationSubmission.findMany.mockResolvedValue([
      { participantId: 7, stage: 'SELF', status: 'SUBMITTED' },
      { participantId: 7, stage: 'SELF', status: 'DRAFT' },
      { participantId: 7, stage: 'MANAGER', status: 'SUBMITTED' },
      { participantId: 7, stage: 'MANAGER', status: 'DRAFT' },
    ]);

    await expect(service.assertCalibrationReady(7)).resolves.toMatchObject({
      ready: true,
      self: 'EFFECTIVE',
      manager: 'EFFECTIVE',
    });
  });

  it('批量派生多名参与者门槛时只查询一次有效答卷', async () => {
    prisma.perfEvaluationSubmission.findMany.mockResolvedValue([
      { participantId: 7, stage: 'SELF' },
      { participantId: 7, stage: 'MANAGER' },
      { participantId: 8, stage: 'SELF' },
    ]);

    const gates = await service.getRequiredEvaluationGates([7, 8]);

    expect(prisma.perfEvaluationSubmission.findMany).toHaveBeenCalledTimes(1);
    expect(gates.get(7)).toMatchObject({ ready: true });
    expect(gates.get(8)).toMatchObject({
      ready: false,
      manager: 'MISSING',
    });
  });

  it('缺失 MANAGER 时返回持续阻塞和催办或更换考核 Leader 指引', async () => {
    prisma.perfEvaluationSubmission.findMany.mockResolvedValue([
      { participantId: 7, stage: 'SELF', status: 'SUBMITTED' },
    ]);

    await expect(service.assertCalibrationReady(7)).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'REQUIRED_EVALUATION_MISSING',
        blockers: [
          expect.objectContaining({
            stage: 'MANAGER',
            action: 'REMIND_OR_TRANSFER_LEADER',
          }),
        ],
      }),
    });
  });

  it('授权 HR 可因始终缺失 SELF 标记 NO_RESULT，保留草稿并固化 SELF 无数据结果', async () => {
    const result = await service.markNoResult(
      'ou_hr',
      1,
      7,
      '员工长期未提交自评',
    );

    expect(result).toMatchObject({ status: 'NO_RESULT' });
    expect(tx.perfStageResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          participantId: 7,
          stage: 'SELF',
          status: 'NO_DATA',
          reviewerCount: 0,
          compositeScore: null,
          stageLevel: null,
          calculationDetail: expect.objectContaining({
            reason: 'SELF_NEVER_SUBMITTED',
            draftSubmissionId: 10,
          }),
        }),
      }),
    );
    expect(tx.perfEvaluationTask.updateMany).toHaveBeenCalledWith({
      where: { participantId: 7, completedAt: null },
      data: { completedAt: expect.any(Date) },
    });
    expect(tx.perfEvaluationSubmission).not.toHaveProperty('deleteMany');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        before: { status: 'PENDING_SELF_REVIEW' },
        after: { status: 'NO_RESULT' },
        reason: '员工长期未提交自评',
      }),
    );
  });

  it('已有有效 SELF 而只缺 MANAGER 时禁止用 NO_RESULT 绕过上级评估', async () => {
    tx.perfEvaluationSubmission.findMany.mockResolvedValue([
      { id: 10, stage: 'SELF', status: 'SUBMITTED' },
    ]);

    await expect(
      service.markNoResult('ou_hr', 1, 7, '上级尚未提交'),
    ).rejects.toThrow(ConflictException);
    expect(tx.perfParticipant.update).not.toHaveBeenCalled();
  });

  it('旧 SELF 提交先获行锁并生效后，NO_RESULT 收口也必须拒绝', async () => {
    tx.perfParticipant.findUnique.mockResolvedValue({
      ...participant,
      selfReview: { status: 'SUBMITTED' },
    });
    tx.perfEvaluationSubmission.findMany.mockResolvedValue([
      { id: 11, stage: 'MANAGER', status: 'SUBMITTED' },
    ]);

    await expect(
      service.markNoResult('ou_hr', 1, 7, '员工长期未提交自评'),
    ).rejects.toThrow(ConflictException);

    expect(tx.perfParticipant.update).not.toHaveBeenCalled();
  });

  it('范围 HR 不能处理授权组织外参与人', async () => {
    rbac.getOrgScope.mockResolvedValue(['od_sales']);

    await expect(
      service.markNoResult('ou_hr', 1, 7, '员工长期未提交自评'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('归档前可带原因撤销 NO_RESULT，恢复参评且保留已有有效提交', async () => {
    tx.perfParticipant.findUnique.mockResolvedValue({
      ...participant,
      status: 'NO_RESULT',
    });
    tx.perfParticipant.update.mockResolvedValue(participant);
    tx.perfEvaluationSubmission.findMany.mockResolvedValue([
      { id: 11, stage: 'MANAGER', status: 'SUBMITTED' },
    ]);

    const result = await service.revokeNoResult(
      'ou_admin',
      1,
      7,
      '员工已恢复评估',
    );

    expect(result).toMatchObject({ status: 'PENDING_SELF_REVIEW' });
    expect(tx.perfStageResult.deleteMany).toHaveBeenCalledWith({
      where: {
        participantId: 7,
        cycleConfigVersionId: 88,
        stage: 'SELF',
        status: 'NO_DATA',
      },
    });
    expect(tx.perfEvaluationTask.updateMany).toHaveBeenCalledWith({
      where: {
        participantId: 7,
        type: { in: ['SELF', 'PEER', 'AI'] },
      },
      data: { completedAt: null },
    });
    expect(tx.perfEvaluationSubmission).not.toHaveProperty('deleteMany');
  });

  it('撤销时即使已有部分 PEER 有效提交，仍按活跃待评指派重开 PEER 任务', async () => {
    tx.perfParticipant.findUnique.mockResolvedValue({
      ...participant,
      status: 'NO_RESULT',
    });
    tx.perfEvaluationSubmission.findMany.mockResolvedValue([
      { stage: 'PEER', status: 'SUBMITTED' },
      { stage: 'MANAGER', status: 'SUBMITTED' },
    ]);
    tx.perfReviewerAssignment.count.mockResolvedValue(1);

    await service.revokeNoResult('ou_admin', 1, 7, '恢复后继续评估');

    expect(tx.perfReviewerAssignment.count).toHaveBeenCalledWith({
      where: { participantId: 7, status: 'PENDING' },
    });
    expect(tx.perfEvaluationTask.updateMany).toHaveBeenCalledWith({
      where: {
        participantId: 7,
        type: { in: ['SELF', 'PEER', 'AI'] },
      },
      data: { completedAt: null },
    });
  });
});
