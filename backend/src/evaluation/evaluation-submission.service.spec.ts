import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EvaluationSubmissionService } from './evaluation-submission.service';
import { Prisma } from '../generated/prisma/client';
import type { EvaluationItemAnswerDto } from './evaluation.dto';
import { ParticipantEvaluationLockService } from '../participant/participant-evaluation-lock.service';

// jest.mock 工厂会被提升到 import 之前执行，工厂体内不能引用外部变量（TDZ），
// 因此与真实 @prisma/client 运行时同形的错误类（code + meta.target）需在工厂内部自包含定义；
// 上面对 Prisma 的 import 在测试运行时会解析到这里 mock 出的对象，用于构造 P2002 冲突异常。
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
        this.name = 'PrismaClientKnownRequestError';
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
    PerfEvaluationTaskType: {
      SELF: 'SELF',
      PEER: 'PEER',
      MANAGER: 'MANAGER',
      AI: 'AI',
    },
    PerfParticipantStatus: {
      ACTIVE: 'ACTIVE',
      NO_RESULT: 'NO_RESULT',
    },
    PerfReviewStatus: { DRAFT: 'DRAFT', SUBMITTED: 'SUBMITTED' },
    PerfFormItemType: {
      RATING: 'RATING',
      SCORE: 'SCORE',
      SHORT_TEXT: 'SHORT_TEXT',
      LONG_TEXT: 'LONG_TEXT',
      MARKDOWN: 'MARKDOWN',
      SINGLE_SELECT: 'SINGLE_SELECT',
      MULTI_SELECT: 'MULTI_SELECT',
      ATTACHMENT: 'ATTACHMENT',
      LINK: 'LINK',
    },
    PerfRatingSymbol: { S: 'S', A: 'A', B: 'B', C: 'C' },
    PerfRole: { EMPLOYEE: 'EMPLOYEE', HR: 'HR', ADMIN: 'ADMIN' },
  }),
  { virtual: true },
);

/** 表单快照 content 夹具：SELF（RATING 必填 + MARKDOWN 必填 + SCORE/LONG_TEXT 选填）+ PROMOTION（员工/Leader 区段）+ PEER */
const snapshotContent = {
  schemaVersion: 1,
  subforms: [
    {
      key: 'subform:SELF',
      type: 'SELF',
      dimensions: [
        {
          key: 'dimension:SELF:EMPLOYEE:0',
          audience: 'EMPLOYEE',
          items: [
            {
              key: 'item:SELF:EMPLOYEE:0:0',
              type: 'RATING',
              title: '自评等级',
              required: true,
            },
          ],
        },
        {
          key: 'dimension:SELF:EMPLOYEE:1',
          audience: 'EMPLOYEE',
          items: [
            {
              key: 'item:SELF:EMPLOYEE:1:0',
              type: 'MARKDOWN',
              title: '自评总结',
              required: true,
            },
            {
              key: 'item:SELF:EMPLOYEE:1:1',
              type: 'SCORE',
              title: '目标完成度',
              required: false,
            },
            {
              key: 'item:SELF:EMPLOYEE:1:2',
              type: 'LONG_TEXT',
              title: '需要的支持',
              required: false,
            },
          ],
        },
      ],
    },
    {
      key: 'subform:PROMOTION',
      type: 'PROMOTION',
      dimensions: [
        {
          key: 'dimension:PROMOTION:EMPLOYEE:0',
          audience: 'EMPLOYEE',
          items: [
            {
              key: 'item:PROMOTION:EMPLOYEE:0:0',
              type: 'MARKDOWN',
              title: '突出工作产出结果',
              required: true,
            },
          ],
        },
        {
          key: 'dimension:PROMOTION:LEADER:0',
          audience: 'LEADER',
          items: [
            {
              key: 'item:PROMOTION:LEADER:0:0',
              type: 'SINGLE_SELECT',
              title: '晋升结论',
              required: true,
            },
          ],
        },
      ],
    },
    {
      key: 'subform:PEER',
      type: 'PEER',
      dimensions: [
        {
          key: 'dimension:PEER:REVIEWER:0',
          audience: 'REVIEWER',
          items: [
            {
              key: 'item:PEER:REVIEWER:0:0',
              type: 'RATING',
              title: '协作评级',
              required: true,
            },
          ],
        },
      ],
    },
  ],
};

const ratings = [
  { symbol: 'S', mappingScore: '95' },
  { symbol: 'A', mappingScore: '85' },
  { symbol: 'B', mappingScore: '70' },
  { symbol: 'C', mappingScore: '50' },
];

const baseParticipant = {
  id: 7,
  cycleId: 1,
  employeeOpenId: 'ou_me',
  status: 'ACTIVE',
  isPromotionEnabled: false,
  formSnapshotId: 88,
  formSnapshot: { id: 88, content: snapshotContent },
  cycle: {
    id: 1,
    status: 'ACTIVE',
    deletedAt: null,
    currentConfigVersion: { ratings },
  },
};

/** SELF 子表单全部必填项齐全的最小提交载荷 */
const completeSelfItems: EvaluationItemAnswerDto[] = [
  {
    subformKey: 'subform:SELF',
    dimensionKey: 'dimension:SELF:EMPLOYEE:0',
    itemKey: 'item:SELF:EMPLOYEE:0:0',
    rawLevel: 'A',
  },
  {
    subformKey: 'subform:SELF',
    dimensionKey: 'dimension:SELF:EMPLOYEE:1',
    itemKey: 'item:SELF:EMPLOYEE:1:0',
    value: '本半年完成了……',
  },
];

describe('EvaluationSubmissionService 员工自评', () => {
  const tx = {
    $queryRaw: jest.fn(),
    perfEvaluationSubmission: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    perfEvaluationItemResult: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    perfEvaluationTask: { update: jest.fn() },
  };
  const prisma = {
    perfParticipant: { findFirst: jest.fn() },
    perfEvaluationSubmission: { findFirst: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const audit = { record: jest.fn() };
  const taskAccess = { ensureWritable: jest.fn(), openIfDue: jest.fn() };
  const aiReport = { refreshForParticipant: jest.fn() };
  const participantEvaluationLock = new ParticipantEvaluationLockService();
  let service: EvaluationSubmissionService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.perfParticipant.findFirst.mockResolvedValue(baseParticipant);
    prisma.$transaction.mockImplementation(
      async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    );
    tx.$queryRaw.mockResolvedValue([{ id: 7, status: 'ACTIVE' }]);
    tx.perfEvaluationSubmission.findFirst.mockResolvedValue(null);
    tx.perfEvaluationSubmission.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 100, ...data }),
    );
    tx.perfEvaluationSubmission.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 100, ...data }),
    );
    tx.perfEvaluationSubmission.deleteMany.mockResolvedValue({ count: 0 });
    tx.perfEvaluationItemResult.deleteMany.mockResolvedValue({ count: 0 });
    tx.perfEvaluationItemResult.createMany.mockResolvedValue({ count: 0 });
    tx.perfEvaluationTask.update.mockResolvedValue({ id: 21 });
    taskAccess.ensureWritable.mockResolvedValue({
      id: 21,
      openedAt: new Date(),
    });
    service = new EvaluationSubmissionService(
      prisma as never,
      audit as never,
      taskAccess as never,
      aiReport as never,
      participantEvaluationLock,
    );
  });

  describe('草稿保存', () => {
    it('草稿允许不完整：只填一项也可保存，且不写计算分', async () => {
      await service.saveSelfDraft('ou_me', {
        cycleId: 1,
        items: [completeSelfItems[0]],
      });

      expect(tx.perfEvaluationSubmission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cycleId: 1,
            participantId: 7,
            stage: 'SELF',
            reviewerOpenId: 'ou_me',
            formSnapshotId: 88,
            status: 'DRAFT',
          }),
        }),
      );
      const rows = tx.perfEvaluationItemResult.createMany.mock.calls[0][0]
        .data as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        itemKey: 'item:SELF:EMPLOYEE:0:0',
        itemType: 'RATING',
        rawLevel: 'A',
        calculationScore: null,
      });
    });

    it('已有草稿时整体替换明细而不是叠加：先 deleteMany 再 createMany 且在同一事务内', async () => {
      tx.perfEvaluationSubmission.findFirst.mockResolvedValue({
        id: 66,
        status: 'DRAFT',
      });

      await service.saveSelfDraft('ou_me', {
        cycleId: 1,
        items: completeSelfItems,
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.perfEvaluationSubmission.create).not.toHaveBeenCalled();
      expect(tx.perfEvaluationItemResult.deleteMany).toHaveBeenCalledWith({
        where: { submissionId: 66 },
      });
      expect(tx.perfEvaluationItemResult.createMany).toHaveBeenCalled();
      const deleteOrder =
        tx.perfEvaluationItemResult.deleteMany.mock.invocationCallOrder[0];
      const createOrder =
        tx.perfEvaluationItemResult.createMany.mock.invocationCallOrder[0];
      expect(deleteOrder).toBeLessThan(createOrder);
    });

    it('提交后编辑进入草稿：不更新已生效 SUBMITTED 行', async () => {
      // 草稿写路径只查找/创建 DRAFT 行
      await service.saveSelfDraft('ou_me', {
        cycleId: 1,
        items: [completeSelfItems[0]],
      });

      expect(tx.perfEvaluationSubmission.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'DRAFT' }),
        }),
      );
      expect(tx.perfEvaluationSubmission.update).not.toHaveBeenCalled();
      expect(tx.perfEvaluationTask.update).not.toHaveBeenCalled();
    });

    it('并发双击/网络重试导致 DRAFT 部分唯一索引冲突（P2002）时返回业务可读中文冲突错误', async () => {
      tx.perfEvaluationSubmission.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: {
            target: 'perf_evaluation_submissions_active_draft_key',
          },
        }),
      );

      const error = await service
        .saveSelfDraft('ou_me', {
          cycleId: 1,
          items: [completeSelfItems[0]],
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as Error).message).toContain('保存冲突');
    });

    it('其他 P2002（非 DRAFT 部分唯一索引）不被吞掉，原样冒泡', async () => {
      tx.perfEvaluationSubmission.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: {
            target: 'perf_evaluation_submissions_id_form_snapshot_id_key',
          },
        }),
      );

      await expect(
        service.saveSelfDraft('ou_me', {
          cycleId: 1,
          items: [completeSelfItems[0]],
        }),
      ).rejects.toThrow('Unique constraint failed');
    });

    it('员工不在周期名单时拒绝且不触发任务开放', async () => {
      prisma.perfParticipant.findFirst.mockResolvedValue(null);

      await expect(
        service.saveSelfDraft('ou_intruder', { cycleId: 1, items: [] }),
      ).rejects.toThrow(NotFoundException);
      expect(taskAccess.ensureWritable).not.toHaveBeenCalled();
    });

    it('任务未开放时写入被统一门槛拒绝，不产生任何提交写入', async () => {
      taskAccess.ensureWritable.mockRejectedValue(
        new ConflictException('任务尚未到开始时间，暂不能保存或提交'),
      );

      await expect(
        service.saveSelfDraft('ou_me', { cycleId: 1, items: [] }),
      ).rejects.toThrow('任务尚未到开始时间');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('提交防伪造校验', () => {
    it('未知 itemKey 拒绝', async () => {
      await expect(
        service.submitSelf('ou_me', {
          cycleId: 1,
          items: [
            ...completeSelfItems,
            {
              subformKey: 'subform:SELF',
              dimensionKey: 'dimension:SELF:EMPLOYEE:1',
              itemKey: 'item:SELF:EMPLOYEE:9:9',
              value: '伪造',
            },
          ],
        }),
      ).rejects.toThrow('不存在');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('类型不匹配拒绝：RATING 项收到 rawScore', async () => {
      await expect(
        service.submitSelf('ou_me', {
          cycleId: 1,
          items: [
            {
              subformKey: 'subform:SELF',
              dimensionKey: 'dimension:SELF:EMPLOYEE:0',
              itemKey: 'item:SELF:EMPLOYEE:0:0',
              rawScore: 90,
            },
            completeSelfItems[1],
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('类型不匹配拒绝：非计分项收到 rawLevel', async () => {
      await expect(
        service.saveSelfDraft('ou_me', {
          cycleId: 1,
          items: [
            {
              subformKey: 'subform:SELF',
              dimensionKey: 'dimension:SELF:EMPLOYEE:1',
              itemKey: 'item:SELF:EMPLOYEE:1:0',
              rawLevel: 'A',
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('自评不允许提交 PEER 子表单评估项', async () => {
      await expect(
        service.saveSelfDraft('ou_me', {
          cycleId: 1,
          items: [
            {
              subformKey: 'subform:PEER',
              dimensionKey: 'dimension:PEER:REVIEWER:0',
              itemKey: 'item:PEER:REVIEWER:0:0',
              rawLevel: 'A',
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('未启用晋升评估时提交 PROMOTION 项被拒绝', async () => {
      await expect(
        service.submitSelf('ou_me', {
          cycleId: 1,
          items: [
            ...completeSelfItems,
            {
              subformKey: 'subform:PROMOTION',
              dimensionKey: 'dimension:PROMOTION:EMPLOYEE:0',
              itemKey: 'item:PROMOTION:EMPLOYEE:0:0',
              value: '产出',
            },
          ],
        }),
      ).rejects.toThrow('晋升');
    });

    it('启用晋升评估时也不允许填写 Leader 区段的晋升项', async () => {
      prisma.perfParticipant.findFirst.mockResolvedValue({
        ...baseParticipant,
        isPromotionEnabled: true,
      });

      await expect(
        service.saveSelfDraft('ou_me', {
          cycleId: 1,
          items: [
            {
              subformKey: 'subform:PROMOTION',
              dimensionKey: 'dimension:PROMOTION:LEADER:0',
              itemKey: 'item:PROMOTION:LEADER:0:0',
              value: 'PROMOTE',
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('同一评估项在载荷中重复出现时拒绝', async () => {
      await expect(
        service.saveSelfDraft('ou_me', {
          cycleId: 1,
          items: [completeSelfItems[0], completeSelfItems[0]],
        }),
      ).rejects.toThrow('重复');
    });
  });

  describe('提交完整性校验', () => {
    it('结构变更后的新快照新增必填项时，兼容预填仍必须补齐后才能重新提交', async () => {
      const changedSnapshot = structuredClone(snapshotContent);
      changedSnapshot.subforms[0].dimensions[1].items.push({
        key: 'item:SELF:EMPLOYEE:1:new-required',
        type: 'LONG_TEXT',
        title: '结构变更后新增的必填说明',
        required: true,
      });
      prisma.perfParticipant.findFirst.mockResolvedValue({
        ...baseParticipant,
        formSnapshotId: 89,
        formSnapshot: { id: 89, content: changedSnapshot },
      });

      await expect(
        service.submitSelf('ou_me', {
          cycleId: 1,
          items: completeSelfItems,
        }),
      ).rejects.toThrow('结构变更后新增的必填说明');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('缺 SELF 必填项时拒绝提交（自评定级由 RATING 必填项承载）', async () => {
      await expect(
        service.submitSelf('ou_me', {
          cycleId: 1,
          items: [completeSelfItems[1]],
        }),
      ).rejects.toThrow('自评等级');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('启用晋升评估时员工区段必填项一并校验', async () => {
      prisma.perfParticipant.findFirst.mockResolvedValue({
        ...baseParticipant,
        isPromotionEnabled: true,
      });

      await expect(
        service.submitSelf('ou_me', { cycleId: 1, items: completeSelfItems }),
      ).rejects.toThrow('突出工作产出结果');
    });

    it('启用晋升评估且晋升必填项齐全时提交通过', async () => {
      prisma.perfParticipant.findFirst.mockResolvedValue({
        ...baseParticipant,
        isPromotionEnabled: true,
      });

      await expect(
        service.submitSelf('ou_me', {
          cycleId: 1,
          items: [
            ...completeSelfItems,
            {
              subformKey: 'subform:PROMOTION',
              dimensionKey: 'dimension:PROMOTION:EMPLOYEE:0',
              itemKey: 'item:PROMOTION:EMPLOYEE:0:0',
              value: '突出产出……',
            },
          ],
        }),
      ).resolves.toMatchObject({ ok: true });
    });
  });

  describe('提交与计算分', () => {
    it('RATING 项按周期配置快照映射分写入计算分，SCORE 项计算分等于原始分', async () => {
      await service.submitSelf('ou_me', {
        cycleId: 1,
        items: [
          ...completeSelfItems,
          {
            subformKey: 'subform:SELF',
            dimensionKey: 'dimension:SELF:EMPLOYEE:1',
            itemKey: 'item:SELF:EMPLOYEE:1:1',
            rawScore: 88.5,
          },
        ],
      });

      const rows = tx.perfEvaluationItemResult.createMany.mock.calls[0][0]
        .data as Array<Record<string, unknown>>;
      const ratingRow = rows.find(
        (row) => row.itemKey === 'item:SELF:EMPLOYEE:0:0',
      );
      expect(ratingRow).toMatchObject({
        itemType: 'RATING',
        rawLevel: 'A',
        calculationScore: '85',
      });
      const scoreRow = rows.find(
        (row) => row.itemKey === 'item:SELF:EMPLOYEE:1:1',
      );
      expect(scoreRow).toMatchObject({
        itemType: 'SCORE',
        rawScore: 88.5,
        calculationScore: 88.5,
      });
      const textRow = rows.find(
        (row) => row.itemKey === 'item:SELF:EMPLOYEE:1:0',
      );
      expect(textRow).toMatchObject({
        itemType: 'MARKDOWN',
        value: '本半年完成了……',
        calculationScore: null,
      });
    });

    it('首次提交创建 SUBMITTED 行、完成任务但不改写参与者结果状态，且记录审计', async () => {
      await service.submitSelf('ou_me', {
        cycleId: 1,
        items: completeSelfItems,
      });

      expect(tx.perfEvaluationSubmission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'SUBMITTED',
            submittedByOpenId: 'ou_me',
            reviewerOpenId: 'ou_me',
          }),
        }),
      );
      expect(tx.perfEvaluationTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { participantId_type: { participantId: 7, type: 'SELF' } },
          data: expect.objectContaining({ completedAt: expect.any(Date) }),
        }),
      );
      expect(aiReport.refreshForParticipant).toHaveBeenCalledWith(7, tx);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          operatorOpenId: 'ou_me',
          action: 'evaluation.self.submit',
          targetType: 'perf_participant',
          targetId: '7',
        }),
      );
    });

    it('提交在事务内先锁定参与者行，NO_RESULT 抢先生效时不得再写入有效 SELF', async () => {
      tx.$queryRaw.mockResolvedValueOnce([{ id: 7, status: 'NO_RESULT' }]);

      await expect(
        service.submitSelf('ou_me', {
          cycleId: 1,
          items: completeSelfItems,
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'EVALUATION_PARTICIPANT_LOCKED',
        }),
      });

      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      const [queryParts] = tx.$queryRaw.mock.calls[0];
      expect(
        Array.from(queryParts as TemplateStringsArray).join('?'),
      ).toContain('FOR UPDATE');
      expect(tx.perfEvaluationSubmission.findFirst).not.toHaveBeenCalled();
      expect(tx.perfEvaluationSubmission.create).not.toHaveBeenCalled();
    });

    it('重新提交在同一事务内整体替换 SUBMITTED 明细并删除 DRAFT，不新增行也不回退参与者进度', async () => {
      prisma.perfParticipant.findFirst.mockResolvedValue({
        ...baseParticipant,
        status: 'ACTIVE',
      });
      tx.perfEvaluationSubmission.findFirst.mockResolvedValue({
        id: 100,
        status: 'SUBMITTED',
      });

      await service.submitSelf('ou_me', {
        cycleId: 1,
        items: completeSelfItems,
      });

      // 全部替换动作发生在同一个 $transaction 回调（tx 客户端）内
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.perfEvaluationSubmission.create).not.toHaveBeenCalled();
      expect(tx.perfEvaluationSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 100 },
          data: expect.objectContaining({
            submittedAt: expect.any(Date),
            submittedByOpenId: 'ou_me',
          }),
        }),
      );
      expect(tx.perfEvaluationItemResult.deleteMany).toHaveBeenCalledWith({
        where: { submissionId: 100 },
      });
      expect(tx.perfEvaluationItemResult.createMany).toHaveBeenCalled();
      expect(tx.perfEvaluationSubmission.deleteMany).toHaveBeenCalledWith({
        where: {
          participantId: 7,
          stage: 'SELF',
          reviewerOpenId: 'ou_me',
          status: 'DRAFT',
        },
      });
    });

    it('并发双击/网络重试导致 SUBMITTED 部分唯一索引冲突（P2002）时返回业务可读中文冲突错误', async () => {
      tx.perfEvaluationSubmission.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: {
            target: 'perf_evaluation_submissions_active_submitted_key',
          },
        }),
      );

      const error = await service
        .submitSelf('ou_me', {
          cycleId: 1,
          items: completeSelfItems,
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as Error).message).toContain('提交冲突');
    });

    it('周期评级配置缺失映射分时提交报错', async () => {
      prisma.perfParticipant.findFirst.mockResolvedValue({
        ...baseParticipant,
        cycle: { ...baseParticipant.cycle, currentConfigVersion: null },
      });

      await expect(
        service.submitSelf('ou_me', { cycleId: 1, items: completeSelfItems }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('自评上下文', () => {
    beforeEach(() => {
      taskAccess.openIfDue.mockResolvedValue({
        id: 21,
        openedAt: new Date('2026-07-15T02:00:00.000Z'),
      });
      prisma.perfEvaluationSubmission.findMany.mockResolvedValue([]);
    });

    it('任务未开放时只返回任务预告，不下发表单内容', async () => {
      taskAccess.openIfDue.mockResolvedValue({ id: 21, openedAt: null });

      const result = await service.getSelfContext('ou_me', 1);

      expect(result.form).toBeNull();
      expect(result.submitted).toBeNull();
      expect(result.draft).toBeNull();
    });

    it('未启用晋升评估时表单只含 SELF 子表单；启用时附带 PROMOTION 员工区段', async () => {
      const withoutPromotion = await service.getSelfContext('ou_me', 1);
      expect(
        withoutPromotion.form!.subforms.map(
          (subform: { key: string }) => subform.key,
        ),
      ).toEqual(['subform:SELF']);

      prisma.perfParticipant.findFirst.mockResolvedValue({
        ...baseParticipant,
        isPromotionEnabled: true,
      });
      const withPromotion = await service.getSelfContext('ou_me', 1);
      const promotionSubform = withPromotion.form!.subforms.find(
        (subform: { key: string }) => subform.key === 'subform:PROMOTION',
      ) as { dimensions: ReadonlyArray<{ audience: string }> };
      expect(promotionSubform).toBeDefined();
      expect(
        promotionSubform.dimensions.every(
          (dimension) => dimension.audience === 'EMPLOYEE',
        ),
      ).toBe(true);
    });

    it('状态标记：有 SUBMITTED 且有 DRAFT 时为待重新提交', async () => {
      prisma.perfEvaluationSubmission.findMany.mockResolvedValue([
        { id: 100, status: 'SUBMITTED', items: [] },
        { id: 101, status: 'DRAFT', items: [] },
      ]);

      const result = await service.getSelfContext('ou_me', 1);

      expect(result.state).toBe('PENDING_RESUBMIT');
      expect(result.submitted).toMatchObject({ id: 100 });
      expect(result.draft).toMatchObject({ id: 101 });
    });

    it('状态标记：无 SUBMITTED 为草稿、有 SUBMITTED 无 DRAFT 为已生效', async () => {
      prisma.perfEvaluationSubmission.findMany.mockResolvedValue([]);
      expect((await service.getSelfContext('ou_me', 1)).state).toBe('DRAFT');

      prisma.perfEvaluationSubmission.findMany.mockResolvedValue([
        { id: 100, status: 'SUBMITTED', items: [] },
      ]);
      expect((await service.getSelfContext('ou_me', 1)).state).toBe(
        'EFFECTIVE',
      );
    });
  });
});
