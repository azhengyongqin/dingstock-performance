import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../shared/database/prisma.service';
import { OkrReadService } from './okr-read.service';
import { OkrSyncService } from './okr-sync.service';

describe('OkrReadService', () => {
  const prismaMock = {
    perfParticipant: { findFirst: jest.fn() },
    larkOkrCycle: { findMany: jest.fn() },
    larkOkrIndicator: { findMany: jest.fn() },
    larkOkrProgress: { findMany: jest.fn() },
    larkOkrCategory: { findMany: jest.fn() },
  };
  const syncServiceMock = {
    getUserStatus: jest.fn(),
    triggerUserSync: jest.fn(),
  };

  let service: OkrReadService;

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.perfParticipant.findFirst.mockResolvedValue({
      id: 7,
      employeeOpenId: 'ou_employee',
    });
    prismaMock.larkOkrCycle.findMany.mockResolvedValue([
      {
        id: 'cycle-1',
        tenant_cycle_id: 'tenant-cycle-1',
        start_time: '1767225600000',
        end_time: '1782777600000',
        cycle_status: 1,
        score: 0.8,
        synced_at: new Date('2026-07-16T10:00:00.000Z'),
        objectives: [
          {
            id: 'objective-1',
            position: 1,
            content: { blocks: [] },
            notes: null,
            score: 0.7,
            weight: 100,
            deadline: null,
            category_id: 'category-1',
            key_results: [
              {
                id: 'kr-1',
                position: 1,
                content: { blocks: [] },
                score: 0.6,
                weight: 100,
                deadline: null,
              },
            ],
          },
        ],
      },
    ]);
    prismaMock.larkOkrIndicator.findMany.mockResolvedValue([
      {
        id: 'indicator-1',
        entity_id: 'objective-1',
        indicator_status: 1,
        start_value: 0,
        target_value: 100,
        current_value: 70,
        unit: { unit_type: 1, unit_value: '%' },
      },
    ]);
    prismaMock.larkOkrProgress.findMany.mockResolvedValue([
      {
        id: 'progress-new',
        entity_id: 'objective-1',
        content: { blocks: [] },
        progress_percent: 70,
        progress_status: 1,
        create_time: '2000',
        update_time: '2001',
      },
      {
        id: 'progress-old',
        entity_id: 'objective-1',
        content: { blocks: [] },
        progress_percent: 40,
        progress_status: 1,
        create_time: '1000',
        update_time: '1001',
      },
    ]);
    prismaMock.larkOkrCategory.findMany.mockResolvedValue([
      { id: 'category-1', name: { zh: '业务目标' }, color: 'blue' },
    ]);
    syncServiceMock.getUserStatus.mockResolvedValue({ status: 'running' });
    syncServiceMock.triggerUserSync.mockResolvedValue({ status: 'running' });

    const moduleRef = await Test.createTestingModule({
      providers: [
        OkrReadService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: OkrSyncService, useValue: syncServiceMock },
      ],
    }).compile();
    service = moduleRef.get(OkrReadService);
  });

  it('允许员工本人、有效评审员或当前 Leader 读取缓存，并只挂载每个实体最新进展', async () => {
    const result = await service.getParticipantOkr('ou_reviewer', 7);

    expect(prismaMock.perfParticipant.findFirst).toHaveBeenCalledWith({
      where: {
        id: 7,
        cycle: { deletedAt: null },
        OR: [
          { employeeOpenId: 'ou_reviewer' },
          { leaderOpenIdSnapshot: 'ou_reviewer' },
          {
            reviewerAssignments: {
              some: {
                reviewerOpenId: 'ou_reviewer',
                status: { not: 'REPLACED' },
              },
            },
          },
        ],
      },
      select: { id: true, employeeOpenId: true },
    });
    expect(result).toMatchObject({
      participantId: 7,
      employeeOpenId: 'ou_employee',
      lastSyncedAt: '2026-07-16T10:00:00.000Z',
      sync: { status: 'running' },
      cycles: [
        {
          id: 'cycle-1',
          objectives: [
            {
              id: 'objective-1',
              category: { id: 'category-1', name: { zh: '业务目标' } },
              latestProgress: { id: 'progress-new', progressPercent: 70 },
              indicator: { id: 'indicator-1', currentValue: 70 },
              keyResults: [{ id: 'kr-1' }],
            },
          ],
        },
      ],
    });
  });

  it('无对象级访问关系时拒绝读取，且不泄露参与者是否存在', async () => {
    prismaMock.perfParticipant.findFirst.mockResolvedValue(null);

    await expect(service.getParticipantOkr('ou_other', 7)).rejects.toThrow(
      ForbiddenException,
    );
    expect(prismaMock.larkOkrCycle.findMany).not.toHaveBeenCalled();
  });

  it('触发同步前复用同一对象级鉴权，并只把被评人的 open_id 交给同步服务', async () => {
    await expect(
      service.triggerParticipantSync('ou_leader', 7),
    ).resolves.toEqual({ status: 'running' });
    expect(syncServiceMock.triggerUserSync).toHaveBeenCalledWith('ou_employee');
  });
});
