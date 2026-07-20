import { EvaluationSubmissionService } from './evaluation-submission.service';
import { ParticipantEvaluationLockService } from '../participant/participant-evaluation-lock.service';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';

jest.mock(
  '../generated/prisma/client',
  () => {
    class PrismaClientKnownRequestError extends Error {
      code: string;
      meta?: { target?: string | string[] };
      constructor(
        message: string,
        options: { code: string; meta?: { target?: string | string[] } },
      ) {
        super(message);
        this.code = options.code;
        this.meta = options.meta;
      }
    }
    return {
      PrismaClient: class {},
      Prisma: { PrismaClientKnownRequestError },
    };
  },
  { virtual: true },
);
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfEvaluationTaskType: { SELF: 'SELF' },
    PerfParticipantStatus: { ACTIVE: 'ACTIVE', NO_RESULT: 'NO_RESULT' },
    PerfReviewStatus: { DRAFT: 'DRAFT', SUBMITTED: 'SUBMITTED' },
    PerfRatingSymbol: { S: 'S', A: 'A', B: 'B', C: 'C' },
    PerfRole: { EMPLOYEE: 'EMPLOYEE', HR: 'HR', ADMIN: 'ADMIN' },
    PerfFormItemType: {
      SHORT_TEXT: 'SHORT_TEXT',
      LONG_TEXT: 'LONG_TEXT',
      MARKDOWN: 'MARKDOWN',
      SINGLE_SELECT: 'SINGLE_SELECT',
      MULTI_SELECT: 'MULTI_SELECT',
      ATTACHMENT: 'ATTACHMENT',
      LINK: 'LINK',
    },
  }),
  { virtual: true },
);

const snapshotContent = {
  schemaVersion: 2,
  subforms: [
    {
      key: 'subform:self',
      type: 'SELF',
      dimensions: [
        {
          key: 'dimension:result',
          type: 'SCORING',
          audience: 'EMPLOYEE',
          name: '自评结论',
          scoringMethod: 'RATING',
          weight: '60',
          isCore: true,
          fields: [
            {
              key: 'field:summary',
              type: 'MARKDOWN',
              title: '自评总结',
              requiredRule: 'CONDITIONAL',
              requiredLevels: ['S', 'C'],
            },
          ],
        },
        {
          key: 'dimension:delivery',
          type: 'SCORING',
          audience: 'EMPLOYEE',
          name: '目标达成',
          scoringMethod: 'SCORE',
          weight: '40',
          isCore: false,
          fields: [],
        },
      ],
    },
  ],
};

describe('员工自评维度回答链路', () => {
  it('上下文只下发 SELF 子表单，并返回维度/字段作答及待重新提交状态', async () => {
    const content = {
      ...snapshotContent,
      subforms: [
        ...snapshotContent.subforms,
        {
          key: 'subform:promotion',
          type: 'PROMOTION',
          dimensions: [],
        },
      ],
    };
    const participant = {
      id: 7,
      cycleId: 1,
      employeeOpenId: 'ou_employee',
      formSnapshotId: 88,
      formSnapshot: { id: 88, content },
      cycle: { id: 1, currentConfigVersion: { id: 9, ratings: [] } },
    };
    const submissions = [
      { id: 1, status: 'SUBMITTED', dimensionAnswers: [] },
      { id: 2, status: 'DRAFT', dimensionAnswers: [] },
    ];
    const prisma = {
      perfParticipant: { findFirst: jest.fn().mockResolvedValue(participant) },
      perfEvaluationSubmission: {
        findMany: jest.fn().mockResolvedValue(submissions),
      },
    };
    const service = new EvaluationSubmissionService(
      prisma as never,
      { record: jest.fn() } as never,
      {
        openIfDue: jest
          .fn()
          .mockResolvedValue({ id: 21, openedAt: new Date() }),
      } as never,
      { refreshForParticipant: jest.fn() } as never,
      new ParticipantEvaluationLockService(),
      {
        getDetailed: jest.fn().mockResolvedValue({ open_id: 'ou_employee' }),
      } as never,
    );

    const result = await service.getSelfContext('ou_employee', 1);

    expect(result.state).toBe('PENDING_RESUBMIT');
    expect(result.form?.subforms.map((subform) => subform.type)).toEqual([
      'SELF',
    ]);
    expect(prisma.perfEvaluationSubmission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          dimensionAnswers: expect.objectContaining({
            include: { fields: true },
          }),
        }),
      }),
    );
  });

  it('拒绝伪造或重复的稳定维度 key', async () => {
    const prisma = {
      perfParticipant: {
        findFirst: jest.fn().mockResolvedValue({
          id: 7,
          cycleId: 1,
          employeeOpenId: 'ou_employee',
          formSnapshotId: 88,
          formSnapshot: { id: 88, content: snapshotContent },
          cycle: {
            currentConfigVersion: { id: 9, ratings: [] },
          },
        }),
      },
      $transaction: jest.fn(),
    };
    const service = new EvaluationSubmissionService(
      prisma as never,
      { record: jest.fn() } as never,
      { ensureWritable: jest.fn() } as never,
      { refreshForParticipant: jest.fn() } as never,
      new ParticipantEvaluationLockService(),
      { getDetailed: jest.fn() } as never,
    );

    await expect(
      service.saveSelfDraft('ou_employee', {
        cycleId: 1,
        dimensions: [
          {
            subformKey: 'subform:self',
            dimensionKey: 'dimension:forged',
            fields: [],
          },
        ],
      }),
    ).rejects.toThrow('不存在');
    await expect(
      service.saveSelfDraft('ou_employee', {
        cycleId: 1,
        dimensions: [
          {
            subformKey: 'subform:self',
            dimensionKey: 'dimension:result',
            fields: [],
          },
          {
            subformKey: 'subform:self',
            dimensionKey: 'dimension:result',
            fields: [],
          },
        ],
      }),
    ).rejects.toThrow('重复提交');
  });

  it('只把目标部分唯一索引 P2002 转换为中文并发冲突', () => {
    const service = new EvaluationSubmissionService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new ParticipantEvaluationLockService(),
      {} as never,
    );
    const error = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: 'perf_evaluation_submissions_active_draft_key' },
      },
    );

    expect(() =>
      service.mapDuplicateSubmissionError(
        error,
        'active_draft_key',
        '保存冲突：已有并发保存草稿，请重试',
      ),
    ).toThrow(ConflictException);
    expect(() =>
      service.mapDuplicateSubmissionError(
        error,
        'active_submitted_key',
        '提交冲突',
      ),
    ).toThrow(error);
  });

  it('拒绝与快照字段类型不匹配的受控 JSON 载荷', async () => {
    const prisma = {
      perfParticipant: {
        findFirst: jest.fn().mockResolvedValue({
          id: 7,
          cycleId: 1,
          employeeOpenId: 'ou_employee',
          isPromotionEnabled: false,
          formSnapshotId: 88,
          formSnapshot: { id: 88, content: snapshotContent },
          cycle: {
            id: 1,
            status: 'ACTIVE',
            deletedAt: null,
            currentConfigVersion: { ratings: [] },
          },
        }),
      },
      $transaction: jest.fn(),
    };
    const service = new EvaluationSubmissionService(
      prisma as never,
      { record: jest.fn() } as never,
      { ensureWritable: jest.fn() } as never,
      { refreshForParticipant: jest.fn() } as never,
      new ParticipantEvaluationLockService(),
      { getDetailed: jest.fn() } as never,
    );

    await expect(
      service.saveSelfDraft('ou_employee', {
        cycleId: 1,
        dimensions: [
          {
            subformKey: 'subform:self',
            dimensionKey: 'dimension:result',
            fields: [{ fieldKey: 'field:summary', value: ['伪造数组'] }],
          },
        ],
      }),
    ).rejects.toThrow('载荷与字段类型不匹配');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('正式提交不能用 null 绕过计分维度必填', async () => {
    const prisma = {
      perfParticipant: {
        findFirst: jest.fn().mockResolvedValue({
          id: 7,
          cycleId: 1,
          employeeOpenId: 'ou_employee',
          formSnapshotId: 88,
          formSnapshot: { id: 88, content: snapshotContent },
          cycle: {
            currentConfigVersion: {
              id: 9,
              ratings: [
                {
                  symbol: 'S',
                  minScore: '90',
                  maxScore: '100',
                  mappingScore: '95',
                },
                {
                  symbol: 'A',
                  minScore: '80',
                  maxScore: '90',
                  mappingScore: '85',
                },
                {
                  symbol: 'B',
                  minScore: '60',
                  maxScore: '80',
                  mappingScore: '70',
                },
                {
                  symbol: 'C',
                  minScore: '0',
                  maxScore: '60',
                  mappingScore: '50',
                },
              ],
            },
          },
        }),
      },
      $transaction: jest.fn(),
    };
    const service = new EvaluationSubmissionService(
      prisma as never,
      { record: jest.fn() } as never,
      { ensureWritable: jest.fn() } as never,
      { refreshForParticipant: jest.fn() } as never,
      new ParticipantEvaluationLockService(),
      { getDetailed: jest.fn() } as never,
    );

    await expect(
      service.submitSelf('ou_employee', {
        cycleId: 1,
        dimensions: [
          {
            subformKey: 'subform:self',
            dimensionKey: 'dimension:result',
            rawLevel: null,
            fields: [],
          },
          {
            subformKey: 'subform:self',
            dimensionKey: 'dimension:delivery',
            rawScore: 90,
            fields: [],
          },
        ],
      } as never),
    ).rejects.toThrow('计分维度「自评结论」尚未填写');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('草稿允许缺少计分输入，并按维度回答包含字段回答保存', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7, status: 'ACTIVE' }]),
      perfEvaluationSubmission: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 101 }),
      },
      perfEvaluationDimensionAnswer: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 201 }),
      },
    };
    const prisma = {
      perfParticipant: {
        findFirst: jest.fn().mockResolvedValue({
          id: 7,
          cycleId: 1,
          employeeOpenId: 'ou_employee',
          isPromotionEnabled: false,
          formSnapshotId: 88,
          formSnapshot: { id: 88, content: snapshotContent },
          cycle: {
            id: 1,
            status: 'ACTIVE',
            deletedAt: null,
            currentConfigVersion: {
              ratings: [
                {
                  symbol: 'S',
                  minScore: '90',
                  maxScore: '100',
                  mappingScore: '95',
                },
                {
                  symbol: 'A',
                  minScore: '80',
                  maxScore: '90',
                  mappingScore: '85',
                },
                {
                  symbol: 'B',
                  minScore: '60',
                  maxScore: '80',
                  mappingScore: '70',
                },
                {
                  symbol: 'C',
                  minScore: '0',
                  maxScore: '60',
                  mappingScore: '50',
                },
              ],
            },
          },
        }),
      },
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const service = new EvaluationSubmissionService(
      prisma as never,
      { record: jest.fn() } as never,
      {
        ensureWritable: jest.fn().mockResolvedValue({ openedAt: new Date() }),
      } as never,
      { refreshForParticipant: jest.fn() } as never,
      new ParticipantEvaluationLockService(),
      { getDetailed: jest.fn() } as never,
    );

    await service.saveSelfDraft('ou_employee', {
      cycleId: 1,
      dimensions: [
        {
          subformKey: 'subform:self',
          dimensionKey: 'dimension:result',
          fields: [{ fieldKey: 'field:summary', value: '先写一点总结' }],
        },
      ],
    });

    expect(tx.perfEvaluationDimensionAnswer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        submissionId: 101,
        dimensionKey: 'dimension:result',
        rawLevel: null,
        rawScore: null,
        calculationScore: null,
        fields: {
          create: [
            expect.objectContaining({
              fieldKey: 'field:summary',
              fieldType: 'MARKDOWN',
              value: '先写一点总结',
            }),
          ],
        },
      }),
    });
  });

  it('正式提交按维度最终等级校验条件必填字段', async () => {
    const prisma = {
      perfParticipant: {
        findFirst: jest.fn().mockResolvedValue({
          id: 7,
          cycleId: 1,
          employeeOpenId: 'ou_employee',
          isPromotionEnabled: false,
          formSnapshotId: 88,
          formSnapshot: { id: 88, content: snapshotContent },
          cycle: {
            id: 1,
            status: 'ACTIVE',
            deletedAt: null,
            currentConfigVersion: {
              ratings: [
                {
                  symbol: 'S',
                  minScore: '90',
                  maxScore: '100',
                  mappingScore: '95',
                },
                {
                  symbol: 'A',
                  minScore: '80',
                  maxScore: '90',
                  mappingScore: '85',
                },
                {
                  symbol: 'B',
                  minScore: '60',
                  maxScore: '80',
                  mappingScore: '70',
                },
                {
                  symbol: 'C',
                  minScore: '0',
                  maxScore: '60',
                  mappingScore: '50',
                },
              ],
            },
          },
        }),
      },
      $transaction: jest.fn(),
    };
    const service = new EvaluationSubmissionService(
      prisma as never,
      { record: jest.fn() } as never,
      { ensureWritable: jest.fn() } as never,
      { refreshForParticipant: jest.fn() } as never,
      new ParticipantEvaluationLockService(),
      { getDetailed: jest.fn() } as never,
    );

    await expect(
      service.submitSelf('ou_employee', {
        cycleId: 1,
        dimensions: [
          {
            subformKey: 'subform:self',
            dimensionKey: 'dimension:result',
            rawLevel: 'S',
            fields: [],
          },
          {
            subformKey: 'subform:self',
            dimensionKey: 'dimension:delivery',
            rawScore: 85,
            fields: [],
          },
        ],
      } as never),
    ).rejects.toThrow('自评总结');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('混合评级/分数维度统一加权，并应用核心维度 B 最高 B 约束', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7, status: 'ACTIVE' }]),
      perfEvaluationSubmission: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 101 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      perfEvaluationDimensionAnswer: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 201 }),
      },
      perfEvaluationTask: { update: jest.fn().mockResolvedValue({ id: 21 }) },
      perfStageResult: {
        upsert: jest.fn().mockResolvedValue({ id: 301 }),
      },
      perfStageDimensionResult: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const participant = {
      id: 7,
      cycleId: 1,
      employeeOpenId: 'ou_employee',
      isPromotionEnabled: false,
      formSnapshotId: 88,
      formSnapshot: { id: 88, content: snapshotContent },
      cycle: {
        id: 1,
        status: 'ACTIVE',
        deletedAt: null,
        currentConfigVersionId: 9,
        currentConfigVersion: {
          id: 9,
          ratings: [
            {
              symbol: 'S',
              minScore: '90',
              maxScore: '100',
              mappingScore: '95',
            },
            { symbol: 'A', minScore: '80', maxScore: '90', mappingScore: '85' },
            { symbol: 'B', minScore: '60', maxScore: '80', mappingScore: '70' },
            { symbol: 'C', minScore: '0', maxScore: '60', mappingScore: '50' },
          ],
        },
      },
    };
    const prisma = {
      perfParticipant: { findFirst: jest.fn().mockResolvedValue(participant) },
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const aiReport = {
      refreshForParticipant: jest.fn().mockResolvedValue(undefined),
    };
    const service = new EvaluationSubmissionService(
      prisma as never,
      audit as never,
      {
        ensureWritable: jest.fn().mockResolvedValue({ openedAt: new Date() }),
      } as never,
      aiReport as never,
      new ParticipantEvaluationLockService(),
      { getDetailed: jest.fn() } as never,
    );

    await expect(
      service.submitSelf('ou_employee', {
        cycleId: 1,
        dimensions: [
          {
            subformKey: 'subform:self',
            dimensionKey: 'dimension:result',
            rawLevel: 'B',
            fields: [{ fieldKey: 'field:summary', value: '显著超出目标' }],
          },
          {
            subformKey: 'subform:self',
            dimensionKey: 'dimension:delivery',
            rawScore: 100,
            fields: [],
          },
        ],
      } as never),
    ).resolves.toEqual({ ok: true });

    expect(tx.perfEvaluationDimensionAnswer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        submissionId: 101,
        dimensionKey: 'dimension:result',
        rawLevel: 'B',
        calculationScore: '70',
        derivedLevel: 'B',
      }),
    });
    expect(tx.perfStageResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          participantId: 7,
          stage: 'SELF',
          compositeScore: '82.00',
          stageLevel: 'B',
        }),
      }),
    );
    expect(tx.perfStageDimensionResult.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          stageResultId: 301,
          dimensionKey: 'dimension:result',
          score: '70',
          level: 'B',
        }),
        expect.objectContaining({
          stageResultId: 301,
          dimensionKey: 'dimension:delivery',
          score: '100',
          level: 'S',
        }),
      ],
    });
  });
});
