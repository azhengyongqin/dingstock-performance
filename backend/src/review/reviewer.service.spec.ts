import { ConflictException } from '@nestjs/common';
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

describe('ReviewerService.upsertReviewers（覆盖式指派护栏）', () => {
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
    perfParticipant: { findUnique: jest.fn() },
    perfReviewerAssignment: { findMany: jest.fn() },
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
    await expect(
      service.upsertReviewers('ou_leader', 7, []),
    ).rejects.toThrow(ConflictException);

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

    await service.upsertReviewers('ou_leader', 7, [], [] /* 加载时无任何指派 */);

    // 不应把他人新增的指派置 REPLACED
    expect(txMock.perfReviewerAssignment.update).not.toHaveBeenCalled();
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
