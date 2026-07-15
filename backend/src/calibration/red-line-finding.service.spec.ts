import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { RedLineFindingService } from './red-line-finding.service';

jest.mock('../shared/database/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('../audit/audit.service', () => ({ AuditService: class {} }));
jest.mock('../rbac/rbac.service', () => ({ RbacService: class {} }));
jest.mock('../evaluation/manager-stage-result.service', () => ({
  ManagerStageResultService: class {},
}));
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfCycleStatus: { ACTIVE: 'ACTIVE' },
    PerfRedLineAction: { CONFIRM: 'CONFIRM', REVOKE: 'REVOKE' },
    PerfRole: { HR: 'HR', ADMIN: 'ADMIN' },
  }),
  { virtual: true },
);

describe('RedLineFindingService 红线确认与撤销', () => {
  const participant = {
    id: 7,
    cycleId: 1,
    departmentIdSnapshot: 'od_product',
    cycle: { status: 'ACTIVE', deletedAt: null },
  };
  const confirmed = {
    id: 501,
    participantId: 7,
    action: 'CONFIRM',
    findingType: 'SERIOUS_VIOLATION',
    facts: '经调查确认发生重大违规',
    evidence: [{ fileToken: 'boxcn-evidence' }],
    reason: '依据员工手册红线条款',
    revokeOfId: null,
    operatorOpenId: 'ou_hr',
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
    perfParticipant: { findUnique: jest.fn() },
    perfRedLineFinding: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const rbac = { hasAnyRole: jest.fn(), getOrgScope: jest.fn() };
  const audit = { record: jest.fn() };
  const managerStageResult = { recalculate: jest.fn() };
  let service: RedLineFindingService;

  beforeEach(() => {
    jest.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([{ id: 7 }]);
    tx.perfParticipant.findUnique.mockResolvedValue(participant);
    tx.perfRedLineFinding.create.mockResolvedValue(confirmed);
    tx.perfRedLineFinding.findUnique.mockResolvedValue({
      ...confirmed,
      revokedBy: [],
    });
    rbac.hasAnyRole.mockResolvedValue(true);
    rbac.getOrgScope.mockResolvedValue(['od_product']);
    managerStageResult.recalculate.mockResolvedValue({
      stageLevel: 'C',
      constraintReasons: [{ type: 'CONFIRMED_RED_LINE' }],
    });
    service = new RedLineFindingService(
      prisma as never,
      rbac as never,
      audit as never,
      managerStageResult as never,
    );
  });

  it('范围 HR 可基于类型、事实、证据和原因确认红线，并在同一事务重算 MANAGER 为 C', async () => {
    const result = await service.confirm('ou_hr', 7, {
      findingType: 'SERIOUS_VIOLATION',
      facts: '经调查确认发生重大违规',
      evidence: [{ fileToken: 'boxcn-evidence' }],
      reason: '依据员工手册红线条款',
    });

    expect(result).toMatchObject({ id: 501, action: 'CONFIRM' });
    expect(tx.perfRedLineFinding.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        participantId: 7,
        action: 'CONFIRM',
        findingType: 'SERIOUS_VIOLATION',
        facts: '经调查确认发生重大违规',
        evidence: [{ fileToken: 'boxcn-evidence' }],
        reason: '依据员工手册红线条款',
        operatorOpenId: 'ou_hr',
      }),
    });
    expect(managerStageResult.recalculate).toHaveBeenCalledWith(7, tx);
    expect(tx).not.toHaveProperty('perfResult');
  });

  it('证据必须是非空数组或非空对象，不能把原始值交给数据库后才失败', async () => {
    await expect(
      service.confirm('ou_hr', 7, {
        findingType: 'SERIOUS_VIOLATION',
        facts: '经调查确认发生重大违规',
        evidence: '只有一段无结构文本',
        reason: '依据员工手册红线条款',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.perfRedLineFinding.create).not.toHaveBeenCalled();
  });

  it('Leader 即使负责该员工也不能确认红线，范围 HR 不能处理授权组织外员工', async () => {
    rbac.hasAnyRole.mockResolvedValueOnce(false);
    await expect(
      service.confirm('ou_leader', 7, {
        findingType: 'SERIOUS_VIOLATION',
        facts: '疑似违规',
        evidence: [{ fileToken: 'boxcn-evidence' }],
        reason: 'Leader 上报',
      }),
    ).rejects.toThrow(ForbiddenException);

    rbac.getOrgScope.mockResolvedValueOnce(['od_sales']);
    await expect(
      service.confirm('ou_hr', 7, {
        findingType: 'SERIOUS_VIOLATION',
        facts: '疑似违规',
        evidence: [{ fileToken: 'boxcn-evidence' }],
        reason: '越权确认',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(tx.perfRedLineFinding.create).not.toHaveBeenCalled();
  });

  it('撤销以新事件引用原确认，保留原记录且不允许重复撤销', async () => {
    tx.perfRedLineFinding.create.mockResolvedValueOnce({
      ...confirmed,
      id: 502,
      action: 'REVOKE',
      reason: '复核证据后撤销',
      revokeOfId: 501,
      operatorOpenId: 'ou_admin',
    });

    const result = await service.revoke('ou_admin', 7, 501, '复核证据后撤销');

    expect(result).toMatchObject({ action: 'REVOKE', revokeOfId: 501 });
    expect(tx.perfRedLineFinding).not.toHaveProperty('update');
    expect(tx.perfRedLineFinding.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'REVOKE',
        revokeOfId: 501,
        findingType: confirmed.findingType,
        facts: confirmed.facts,
        evidence: confirmed.evidence,
        reason: '复核证据后撤销',
        operatorOpenId: 'ou_admin',
      }),
    });
    expect(tx).not.toHaveProperty('perfResult');

    tx.perfRedLineFinding.findUnique.mockResolvedValueOnce({
      ...confirmed,
      revokedBy: [{ id: 502 }],
    });
    await expect(
      service.revoke('ou_admin', 7, 501, '重复撤销'),
    ).rejects.toThrow(ConflictException);
  });
});
