import { LegacyPromotionArchiveService } from './legacy-promotion-archive.service';

describe('LegacyPromotionArchiveService', () => {
  const prisma = {
    perfLegacyPromotionArchive: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    larkUser: { findMany: jest.fn() },
  };

  const service = new LegacyPromotionArchiveService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('按受控分页返回周期、参与人、来源与旧答案的安全投影', async () => {
    prisma.perfLegacyPromotionArchive.findMany.mockResolvedValue([
      {
        id: 8,
        cycleId: 2,
        participantId: 3,
        sourceType: 'EVALUATION_ITEM_RESULT',
        sourceRecordId: 99,
        sourceCreatedAt: new Date('2025-12-01T00:00:00.000Z'),
        archivedAt: new Date('2026-07-20T00:00:00.000Z'),
        cycle: { id: 2, name: '2025 下半年绩效' },
        participant: { id: 3, employeeOpenId: 'ou_employee' },
        payload: {
          stage: 'SELF',
          status: 'SUBMITTED',
          reviewerOpenId: 'ou_private_reviewer',
          submittedAt: '2025-12-02T00:00:00.000Z',
          dimensionKey: 'promotion-reason',
          itemKey: 'promotion-statement',
          itemType: 'LONG_TEXT',
          rawLevel: null,
          rawScore: null,
          calculationScore: null,
          value: '我希望承担更大的职责',
          privateInternalNote: '不得泄漏',
        },
      },
    ]);
    prisma.perfLegacyPromotionArchive.count.mockResolvedValue(1);
    prisma.larkUser.findMany.mockResolvedValue([
      {
        open_id: 'ou_employee',
        name: '张三',
        avatar: {
          avatar_72: 'https://example.com/avatar.png',
          private_token: '不得泄漏',
        },
      },
    ]);

    await expect(
      service.list({ page: 2, pageSize: 20, cycleId: 2 }),
    ).resolves.toEqual({
      items: [
        {
          id: 8,
          cycle: { id: 2, name: '2025 下半年绩效' },
          participant: {
            id: 3,
            employee: {
              openId: 'ou_employee',
              name: '张三',
              avatarUrl: 'https://example.com/avatar.png',
            },
          },
          source: {
            type: 'EVALUATION_ITEM_RESULT',
            recordId: 99,
            createdAt: new Date('2025-12-01T00:00:00.000Z'),
          },
          payload: {
            kind: 'EVALUATION_ANSWER',
            stage: 'SELF',
            status: 'SUBMITTED',
            submittedAt: '2025-12-02T00:00:00.000Z',
            dimensionKey: 'promotion-reason',
            fieldKey: 'promotion-statement',
            fieldType: 'LONG_TEXT',
            rating: null,
            score: null,
            calculationScore: null,
            entries: [
              {
                kind: 'TEXT',
                label: '作答内容',
                content: '我希望承担更大的职责',
              },
            ],
          },
          archivedAt: new Date('2026-07-20T00:00:00.000Z'),
        },
      ],
      total: 1,
      page: 2,
      pageSize: 20,
    });

    expect(prisma.perfLegacyPromotionArchive.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 }),
    );
    const response = await service.list({ page: 2, pageSize: 20, cycleId: 2 });
    expect(JSON.stringify(response)).not.toContain('ou_private_reviewer');
    expect(JSON.stringify(response)).not.toContain('privateInternalNote');
    expect(JSON.stringify(response)).not.toContain('private_token');
  });

  it('只投影可见结果快照的白名单文本，忽略任意 JSON 与不可见内容', async () => {
    prisma.perfLegacyPromotionArchive.findMany.mockResolvedValue([
      {
        id: 9,
        cycleId: 2,
        participantId: 3,
        sourceType: 'RESULT_VERSION_SNAPSHOT',
        sourceRecordId: 101,
        sourceCreatedAt: null,
        archivedAt: new Date('2026-07-20T00:00:00.000Z'),
        cycle: { id: 2, name: '2025 下半年绩效' },
        participant: { id: 3, employeeOpenId: 'ou_employee' },
        payload: {
          version: 2,
          promotion: {
            visible: true,
            items: [
              { title: '晋升陈述', value: '已具备岗位能力', secret: '隐藏' },
              { title: '异常对象', value: { secret: '不得 stringify' } },
            ],
          },
          internalCalibration: '不得泄漏',
        },
      },
    ]);
    prisma.perfLegacyPromotionArchive.count.mockResolvedValue(1);
    prisma.larkUser.findMany.mockResolvedValue([]);

    const result = await service.list({ page: 1, pageSize: 100 });

    expect(result.items[0].payload).toEqual({
      kind: 'RESULT_SNAPSHOT',
      version: 2,
      entries: [{ kind: 'TEXT', label: '晋升陈述', content: '已具备岗位能力' }],
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('internalCalibration');
  });
});
