import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
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
    PerfEvaluationTaskType: { PEER: 'PEER' },
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
      updateMany: jest.fn(),
      createMany: jest.fn(),
      create: jest.fn(),
    },
    perfEvaluationTask: { updateMany: jest.fn() },
    perfNotification: {
      createMany: jest.fn(),
      create: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  };

  const prismaMock = {
    $transaction: jest.fn((callback: (tx: typeof txMock) => unknown) =>
      Promise.resolve(callback(txMock)),
    ),
    perfParticipant: { findUnique: jest.fn(), findMany: jest.fn() },
    perfReviewerAssignment: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      createMany: jest.fn(),
    },
    larkDepartment: { findUnique: jest.fn() },
    larkUser: { findMany: jest.fn() },
  };
  const auditMock = { record: jest.fn() };
  const rbacMock = {
    hasAnyRole: jest.fn().mockResolvedValue(false),
    getOrgScope: jest.fn().mockResolvedValue([]),
  };

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
    rbacMock.getOrgScope.mockResolvedValue([]);
    prismaMock.perfParticipant.findUnique.mockResolvedValue(participant);
    // listWithRecommendations 的兜底空数据
    prismaMock.perfReviewerAssignment.findMany.mockResolvedValue([]);
    prismaMock.perfReviewerAssignment.createMany.mockResolvedValue({
      count: 1,
    });
    txMock.perfReviewerAssignment.updateMany.mockResolvedValue({ count: 1 });
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
      const result = await service.listWithRecommendations('ou_leader', 7);

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

      const result = await service.listWithRecommendations('ou_leader', 7);

      expect(
        result.recommendations.map((r: { openId: string }) => r.openId),
      ).not.toContain('ou_leader');
    });
  });

  it('非 Leader 且无 HR/Admin 授权时不能读取指派名单', async () => {
    await expect(
      service.listWithRecommendations('ou_intruder', 7),
    ).rejects.toThrow(ForbiddenException);
    expect(prismaMock.perfReviewerAssignment.findMany).not.toHaveBeenCalled();
  });

  it('受限 HR 不能管理授权组织范围外的参与者', async () => {
    prismaMock.perfParticipant.findUnique.mockResolvedValue({
      ...participant,
      departmentIdSnapshot: 'od_target',
    });
    rbacMock.hasAnyRole.mockResolvedValue(true);
    rbacMock.getOrgScope.mockResolvedValue(['od_other']);

    await expect(service.listWithRecommendations('ou_hr', 7)).rejects.toThrow(
      ForbiddenException,
    );
  });

  describe('batchAdd（批量补充跳过考核 Leader 快照）', () => {
    it('批量名单包含考核 Leader 时整单拒绝，不能静默形成非法关系', async () => {
      rbacMock.hasAnyRole.mockResolvedValue(true);
      rbacMock.getOrgScope.mockResolvedValue(null);
      prismaMock.perfParticipant.findMany.mockResolvedValueOnce([participant]);

      await expect(
        service.batchAdd(
          'ou_hr',
          100,
          [7],
          [{ reviewerOpenId: 'ou_leader', relation: 'PEER' }],
        ),
      ).rejects.toThrow(BadRequestException);

      expect(
        prismaMock.perfReviewerAssignment.createMany,
      ).not.toHaveBeenCalled();
    });

    it('授权范围内 HR 可批量补充四类计算关系', async () => {
      rbacMock.hasAnyRole.mockResolvedValue(true);
      rbacMock.getOrgScope.mockResolvedValue(null);
      prismaMock.perfParticipant.findMany.mockResolvedValueOnce([participant]);
      prismaMock.perfReviewerAssignment.findMany.mockResolvedValueOnce([]);

      const result = await service.batchAdd(
        'ou_hr',
        100,
        [7],
        [{ reviewerOpenId: 'ou_other', relation: 'PEER' }],
      );

      expect(result.added).toBe(1);
      expect(prismaMock.perfReviewerAssignment.createMany).toHaveBeenCalledWith(
        {
          data: [expect.objectContaining({ reviewerOpenId: 'ou_other' })],
          skipDuplicates: true,
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

  it('四类计算关系之外的 LEADER 关系即使评审员不是考核 Leader 也拒绝', async () => {
    await expect(
      service.upsertReviewers('ou_leader', 7, [
        { reviewerOpenId: 'ou_other', relation: 'LEADER' },
      ]),
    ).rejects.toThrow(BadRequestException);
  });

  it('显式替换已提交评审员时原记录置 REPLACED、新建指派并在同一事务写审计', async () => {
    prismaMock.perfReviewerAssignment.findMany.mockResolvedValueOnce([]);
    prismaMock.perfReviewerAssignment.findUnique.mockResolvedValue({
      id: 5,
      participantId: 7,
      reviewerOpenId: 'ou_old',
      relation: 'PEER',
      source: 'LEADER_ASSIGNED',
      status: 'SUBMITTED',
    });
    txMock.perfReviewerAssignment.create.mockResolvedValue({
      id: 6,
      participantId: 7,
      reviewerOpenId: 'ou_new',
      relation: 'PROJECT_OWNER',
      status: 'PENDING',
    });

    await service.replaceReviewer('ou_leader', 7, 5, {
      reviewerOpenId: 'ou_new',
      relation: 'PROJECT_OWNER',
      reason: '项目职责已调整',
    });

    expect(txMock.perfReviewerAssignment.updateMany).toHaveBeenCalledWith({
      where: { id: 5, participantId: 7, status: { not: 'REPLACED' } },
      data: { status: 'REPLACED' },
    });
    expect(txMock.perfReviewerAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ reviewerOpenId: 'ou_new' }),
    });
    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'reviewer.replace',
        reason: '项目职责已调整',
      }),
    });
  });

  it('存量的考核 Leader 指派也不能通过覆盖保存继续伪装为合法关系', async () => {
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
    ).rejects.toThrow(BadRequestException);
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

    expect(txMock.perfReviewerAssignment.updateMany).toHaveBeenCalledWith({
      where: { id: 3, status: 'PENDING' },
      data: { status: 'REPLACED' },
    });
  });

  it('覆盖保存与评审提交并发时，状态已变化的关系不能被直接移除', async () => {
    prismaMock.perfReviewerAssignment.findMany.mockResolvedValueOnce([
      {
        id: 3,
        reviewerOpenId: 'ou_old',
        relation: 'PEER',
        status: 'PENDING',
      },
    ]);
    txMock.perfReviewerAssignment.updateMany.mockResolvedValueOnce({
      count: 0,
    });

    await expect(
      service.upsertReviewers('ou_leader', 7, [], [3]),
    ).rejects.toThrow(ConflictException);

    expect(txMock.perfReviewerAssignment.createMany).not.toHaveBeenCalled();
    expect(auditMock.record).not.toHaveBeenCalled();
  });
});
