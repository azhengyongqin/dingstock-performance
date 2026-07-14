import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import { PrismaService } from '../shared/database/prisma.service';
import { ReviewerService } from './reviewer.service';

// 生成的 Prisma client 是 ESM 产物，单测中统一 mock，避免依赖真实数据库。
jest.mock(
  '../generated/prisma/client',
  () => ({
    PrismaClient: class {
      $connect = jest.fn();
      $disconnect = jest.fn();
    },
  }),
  { virtual: true },
);
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfAssignmentStatus: {
      PENDING: 'PENDING',
      SUBMITTED: 'SUBMITTED',
      REPLACED: 'REPLACED',
    },
    PerfReviewerRelation: {
      LEADER: 'LEADER',
      PEER: 'PEER',
      CROSS_DEPT: 'CROSS_DEPT',
      ORG_OWNER: 'ORG_OWNER',
      PROJECT_OWNER: 'PROJECT_OWNER',
    },
    PerfReviewerSource: {
      RECOMMENDED: 'RECOMMENDED',
      LEADER_ASSIGNED: 'LEADER_ASSIGNED',
      HR_ASSIGNED: 'HR_ASSIGNED',
    },
    PerfRole: {
      HR: 'HR',
      ADMIN: 'ADMIN',
      REVIEWER: 'REVIEWER',
    },
    PerfNotificationChannel: {
      BOT_DM: 'BOT_DM',
    },
  }),
  { virtual: true },
);
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation((options: unknown) => options),
}));
jest.mock('../audit/audit.service', () => ({
  AuditService: class {},
}));

describe('ReviewerService', () => {
  const txMock = {
    perfReviewerAssignment: {
      update: jest.fn(),
      createMany: jest.fn(),
    },
    perfNotification: {
      createMany: jest.fn(),
    },
  };

  const prismaMock = {
    $transaction: jest.fn((callback: (tx: typeof txMock) => unknown) =>
      Promise.resolve(callback(txMock)),
    ),
    perfParticipant: { findUnique: jest.fn(), findMany: jest.fn() },
    perfReviewerAssignment: { findMany: jest.fn(), createMany: jest.fn() },
    larkDepartment: { findUnique: jest.fn() },
    larkUser: { findMany: jest.fn() },
  };
  const auditMock = { record: jest.fn() };
  const rbacMock = { hasAnyRole: jest.fn().mockResolvedValue(false) };

  let service: ReviewerService;

  const participant = {
    id: 7,
    cycleId: 100,
    employeeOpenId: 'ou_emp',
    leaderOpenIdSnapshot: 'ou_leader',
    departmentIdSnapshot: null,
    cycle: { id: 100, deletedAt: null },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(
      (callback: (tx: typeof txMock) => unknown) =>
        Promise.resolve(callback(txMock)),
    );
    rbacMock.hasAnyRole.mockResolvedValue(false);
    prismaMock.perfParticipant.findUnique.mockResolvedValue(participant);
    // listWithRecommendations 的兜底空数据
    prismaMock.perfReviewerAssignment.findMany.mockResolvedValue([]);
    prismaMock.larkUser.findMany.mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReviewerService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditService, useValue: auditMock },
        { provide: RbacService, useValue: rbacMock },
      ],
    }).compile();

    service = moduleRef.get(ReviewerService);
  });

  describe('listWithRecommendations（考核 Leader 快照不进候选）', () => {
    it('推荐候选不含考核 Leader 快照', async () => {
      const result = await service.listWithRecommendations(7);

      expect(
        result.recommendations.map((r: { openId: string }) => r.openId),
      ).not.toContain('ou_leader');
    });

    it('历史评审关系来源中的考核 Leader 快照同样被剔除', async () => {
      // findMany 第一次返回当前指派，第二次返回历史评审关系
      prismaMock.perfReviewerAssignment.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { reviewerOpenId: 'ou_leader', relation: 'PEER' },
        ]);

      const result = await service.listWithRecommendations(7);

      expect(
        result.recommendations.map((r: { openId: string }) => r.openId),
      ).not.toContain('ou_leader');
    });
  });

  describe('batchAdd（批量补充跳过考核 Leader 快照）', () => {
    it('批量名单中该参与者的考核 Leader 被自动跳过，其余正常补充', async () => {
      prismaMock.perfParticipant.findMany.mockResolvedValueOnce([participant]);
      prismaMock.perfReviewerAssignment.findMany.mockResolvedValueOnce([]);

      const result = await service.batchAdd(
        'ou_hr',
        100,
        [7],
        [
          { reviewerOpenId: 'ou_leader', relation: 'LEADER' },
          { reviewerOpenId: 'ou_other', relation: 'PEER' },
        ],
      );

      expect(result.added).toBe(1);
      expect(prismaMock.perfReviewerAssignment.createMany).toHaveBeenCalledWith(
        {
          data: [expect.objectContaining({ reviewerOpenId: 'ou_other' })],
        },
      );
    });
  });

  it('移除已提交（SUBMITTED）的评审员时整单拒绝', async () => {
    // 当前名单：ou_x 已提交
    prismaMock.perfReviewerAssignment.findMany.mockResolvedValueOnce([
      {
        id: 1,
        reviewerOpenId: 'ou_x',
        relation: 'PEER',
        status: 'SUBMITTED',
      },
    ]);

    // 提交的名单里 ou_x 缺席 → 视为试图移除已提交者，整单拒绝
    await expect(service.upsertReviewers('ou_leader', 7, [])).rejects.toThrow(
      ConflictException,
    );

    // 整单拒绝：不应产生任何写入
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('页面加载后他人新增的指派（id 不在 knownAssignmentIds）缺席时不视为删除', async () => {
    // 当前名单：id=2 是 HR 在本页面加载后批量补充的，操作者提交时并不知道它
    prismaMock.perfReviewerAssignment.findMany.mockResolvedValueOnce([
      {
        id: 2,
        reviewerOpenId: 'ou_hr_added',
        relation: 'CROSS_DEPT',
        status: 'PENDING',
      },
    ]);

    await service.upsertReviewers(
      'ou_leader',
      7,
      [],
      [] /* 加载时无任何指派 */,
    );

    // 不应把他人新增的指派置 REPLACED
    expect(txMock.perfReviewerAssignment.update).not.toHaveBeenCalled();
  });

  it('名单中包含考核 Leader 快照时整单拒绝', async () => {
    await expect(
      service.upsertReviewers('ou_leader', 7, [
        { reviewerOpenId: 'ou_leader', relation: 'LEADER' },
      ]),
    ).rejects.toThrow(BadRequestException);

    // 整单拒绝：不应产生任何写入
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('存量的考核 Leader 指派保留在名单中时不拒绝（只挡增量）', async () => {
    // 存量：Leader 早前已被指派且已提交（不可移除），本次保存原样保留
    prismaMock.perfReviewerAssignment.findMany.mockResolvedValueOnce([
      {
        id: 5,
        reviewerOpenId: 'ou_leader',
        relation: 'LEADER',
        status: 'SUBMITTED',
      },
    ]);

    await expect(
      service.upsertReviewers('ou_leader', 7, [
        { reviewerOpenId: 'ou_leader', relation: 'LEADER' },
      ]),
    ).resolves.toBeDefined();
  });

  it('加载时已见过的未提交指派缺席时正常置 REPLACED', async () => {
    prismaMock.perfReviewerAssignment.findMany.mockResolvedValueOnce([
      {
        id: 3,
        reviewerOpenId: 'ou_old',
        relation: 'PEER',
        status: 'PENDING',
      },
    ]);

    await service.upsertReviewers('ou_leader', 7, [], [3]);

    expect(txMock.perfReviewerAssignment.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { status: 'REPLACED' },
    });
  });
});
