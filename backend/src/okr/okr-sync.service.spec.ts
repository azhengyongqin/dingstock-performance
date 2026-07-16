import { ConflictException, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../shared/database/prisma.service';
import { LarkService } from '../shared/lark/lark.service';
import { REDIS_CLIENT } from '../shared/redis/redis.constants';
import { OkrSyncService } from './okr-sync.service';

const asPageIterator = <T>(items: T[]) =>
  Promise.resolve(
    (async function* () {
      yield await Promise.resolve({ items });
    })(),
  );

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

const badRequestError = (code = 1001004, msg = 'okr data not found') =>
  Object.assign(new Error('Request failed with status code 400'), {
    config: {
      method: 'get',
      url: '/open-apis/okr/v2/objectives/objective-1/indicator',
      params: {
        user_id_type: 'open_id',
        department_id_type: 'open_department_id',
      },
    },
    response: {
      status: 400,
      data: {
        code,
        msg,
        log_id: 'test-log-id',
        troubleshooter: 'https://open.feishu.cn/search?log_id=test-log-id',
      },
    },
  });

const lastStatusWrite = (setMock: { mock: { calls: unknown[][] } }) => {
  const writes = setMock.mock.calls.filter(
    (call) => call[0] === 'okr:sync:status',
  );
  return JSON.parse(writes[writes.length - 1][1] as string) as {
    status: string;
    users?: number;
    failedUsers?: number;
    categories?: number;
    cycles?: number;
    objectives?: number;
    keyResults?: number;
    indicators?: number;
    progresses?: number;
    alignments?: number;
    userErrors?: Array<{ openId: string; error: string }>;
  };
};

describe('OkrSyncService', () => {
  const redisMock = {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
  };
  const prismaMock = {
    larkUser: { findMany: jest.fn() },
    larkOkrCategory: { upsert: jest.fn(), deleteMany: jest.fn() },
    larkOkrCycle: { upsert: jest.fn(), deleteMany: jest.fn() },
    larkOkrObjective: { upsert: jest.fn(), deleteMany: jest.fn() },
    larkOkrKeyResult: { upsert: jest.fn(), deleteMany: jest.fn() },
    larkOkrIndicator: { upsert: jest.fn(), deleteMany: jest.fn() },
    larkOkrProgress: { upsert: jest.fn(), deleteMany: jest.fn() },
    larkOkrAlignment: { upsert: jest.fn(), deleteMany: jest.fn() },
    $transaction: jest
      .fn()
      .mockImplementation((operations: Array<Promise<unknown>>) =>
        Promise.all(operations),
      ),
  };

  const categoryListMock = jest.fn();
  const cyclePageListMock = jest.fn();
  const objectiveListMock = jest.fn();
  const keyResultListMock = jest.fn();
  const objectiveIndicatorMock = jest.fn();
  const keyResultIndicatorMock = jest.fn();
  const objectiveProgressMock = jest.fn();
  const keyResultProgressMock = jest.fn();
  const objectiveAlignmentMock = jest.fn();

  const larkServiceMock = {
    getClient: () => ({
      okr: {
        v2: {
          okrCategory: { listWithIterator: categoryListMock },
          okrCycle: { list: cyclePageListMock },
          okrCycleObjective: { listWithIterator: objectiveListMock },
          okrObjectiveKeyResult: { listWithIterator: keyResultListMock },
          okrObjectiveIndicator: { list: objectiveIndicatorMock },
          okrKeyResultIndicator: { list: keyResultIndicatorMock },
          okrObjectiveProgress: { listWithIterator: objectiveProgressMock },
          okrKeyResultProgress: { listWithIterator: keyResultProgressMock },
          okrObjectiveAlignment: { listWithIterator: objectiveAlignmentMock },
        },
      },
    }),
  };

  let service: OkrSyncService;

  beforeEach(async () => {
    jest.clearAllMocks();
    redisMock.set.mockResolvedValue('OK');
    redisMock.get.mockResolvedValue(null);
    redisMock.del.mockResolvedValue(1);
    prismaMock.larkUser.findMany.mockResolvedValue([{ open_id: 'ou-1' }]);
    for (const delegate of Object.values(prismaMock).slice(1, -1)) {
      delegate.upsert.mockResolvedValue({});
      delegate.deleteMany.mockResolvedValue({ count: 0 });
    }

    categoryListMock.mockReturnValue(
      asPageIterator([
        {
          id: 'cat-1',
          create_time: '1000',
          update_time: '1001',
          category_type: 'person',
          enabled: true,
          color: 'blue',
          name: { zh: '业务目标' },
        },
      ]),
    );
    cyclePageListMock.mockResolvedValue({
      code: 0,
      msg: 'success',
      data: {
        has_more: false,
        items: [
          {
            id: 'cycle-1',
            create_time: '1000',
            update_time: '1001',
            tenant_cycle_id: 'tenant-cycle-1',
            owner: { owner_type: 'user', user_id: 'ou-1' },
            start_time: '1000',
            end_time: '2000',
            cycle_status: 1,
            score: 0.8,
          },
        ],
      },
    });
    objectiveListMock.mockReturnValue(
      asPageIterator([
        {
          id: 'objective-1',
          create_time: '1000',
          update_time: '1001',
          owner: { owner_type: 'user', user_id: 'ou-1' },
          cycle_id: 'cycle-1',
          position: 1,
          content: { blocks: [] },
          notes: { blocks: [] },
          weight: 100,
          category_id: 'cat-1',
        },
      ]),
    );
    keyResultListMock.mockReturnValue(
      asPageIterator([
        {
          id: 'kr-1',
          create_time: '1000',
          update_time: '1001',
          owner: { owner_type: 'user', user_id: 'ou-1' },
          objective_id: 'objective-1',
          position: 1,
          content: { blocks: [] },
          weight: 100,
        },
      ]),
    );
    objectiveIndicatorMock.mockResolvedValue({
      data: {
        indicator: {
          id: 'indicator-o-1',
          create_time: '1000',
          update_time: '1001',
          owner: { owner_type: 'user', user_id: 'ou-1' },
          entity_type: 1,
          entity_id: 'objective-1',
          indicator_status: 1,
          status_calculate_type: 1,
          start_value: 0,
          target_value: 100,
          current_value: 50,
          unit: { unit_type: 1, unit_value: '%' },
        },
      },
    });
    keyResultIndicatorMock.mockResolvedValue({
      data: {
        indicator: {
          id: 'indicator-kr-1',
          create_time: '1000',
          update_time: '1001',
          owner: { owner_type: 'user', user_id: 'ou-1' },
          entity_type: 2,
          entity_id: 'kr-1',
          indicator_status: 1,
          status_calculate_type: 1,
        },
      },
    });
    objectiveProgressMock.mockReturnValue(
      asPageIterator([
        {
          id: 'progress-o-1',
          create_time: '1000',
          update_time: '1001',
          owner: { owner_type: 'user', user_id: 'ou-1' },
          entity_type: 1,
          entity_id: 'objective-1',
          content: { blocks: [] },
          progress_rate: { progress_percent: 50, progress_status: 1 },
        },
      ]),
    );
    keyResultProgressMock.mockReturnValue(
      asPageIterator([
        {
          id: 'progress-kr-1',
          create_time: '1000',
          update_time: '1001',
          owner: { owner_type: 'user', user_id: 'ou-1' },
          entity_type: 2,
          entity_id: 'kr-1',
          progress_rate: { progress_percent: 40, progress_status: 1 },
        },
      ]),
    );
    objectiveAlignmentMock.mockReturnValue(
      asPageIterator([
        {
          id: 'alignment-1',
          create_time: '1000',
          update_time: '1001',
          from_owner: { owner_type: 'user', user_id: 'ou-1' },
          to_owner: { owner_type: 'user', user_id: 'ou-2' },
          from_entity_type: 1,
          from_entity_id: 'objective-1',
          to_entity_type: 1,
          to_entity_id: 'objective-2',
        },
      ]),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        OkrSyncService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: LarkService, useValue: larkServiceMock },
        { provide: REDIS_CLIENT, useValue: redisMock },
      ],
    }).compile();
    service = moduleRef.get(OkrSyncService);
  });

  it('按 SDK okr.v2 层级同步员工的完整 OKR 数据结构', async () => {
    await expect(service.triggerSync()).resolves.toMatchObject({
      status: 'running',
    });
    await flushAsync();

    expect(cyclePageListMock).toHaveBeenCalledWith({
      params: {
        user_id: 'ou-1',
        user_id_type: 'open_id',
        page_size: 100,
      },
    });
    expect(prismaMock.larkOkrCycle.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cycle-1' },
        create: expect.objectContaining({
          owner_open_id: 'ou-1',
          tenant_cycle_id: 'tenant-cycle-1',
        }),
      }),
    );
    expect(prismaMock.larkOkrObjective.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.larkOkrKeyResult.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.larkOkrIndicator.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.larkOkrProgress.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.larkOkrAlignment.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.larkOkrCategory.deleteMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);

    const status = lastStatusWrite(redisMock.set);
    expect(status).toMatchObject({
      status: 'success',
      users: 1,
      failedUsers: 0,
      categories: 1,
      cycles: 1,
      objectives: 1,
      keyResults: 1,
      indicators: 2,
      progresses: 2,
      alignments: 1,
    });
    expect(redisMock.del).toHaveBeenCalledWith('okr:sync:lock');
  });

  it('按接口 has_more 和 page_token 拉取员工的全部 OKR 周期', async () => {
    cyclePageListMock
      .mockResolvedValueOnce({
        code: 0,
        msg: 'success',
        data: {
          has_more: true,
          page_token: 'next-page',
          items: [
            {
              id: 'cycle-1',
              create_time: '1000',
              update_time: '1001',
              tenant_cycle_id: 'tenant-cycle-1',
              owner: { owner_type: 'user', user_id: 'ou-1' },
              start_time: '1000',
              end_time: '2000',
              cycle_status: 1,
              score: 0.8,
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        code: 0,
        msg: 'success',
        data: {
          has_more: false,
          items: [
            {
              id: 'cycle-2',
              create_time: '2000',
              update_time: '2001',
              tenant_cycle_id: 'tenant-cycle-2',
              owner: { owner_type: 'user', user_id: 'ou-1' },
              start_time: '2000',
              end_time: '3000',
              cycle_status: 1,
              score: 0.6,
            },
          ],
        },
      });

    await service.triggerSync();
    await flushAsync();

    expect(cyclePageListMock).toHaveBeenNthCalledWith(1, {
      params: {
        user_id: 'ou-1',
        user_id_type: 'open_id',
        page_size: 100,
      },
    });
    expect(cyclePageListMock).toHaveBeenNthCalledWith(2, {
      params: {
        user_id: 'ou-1',
        user_id_type: 'open_id',
        page_size: 100,
        page_token: 'next-page',
      },
    });
    expect(prismaMock.larkOkrCycle.upsert).toHaveBeenCalledTimes(2);
    expect(lastStatusWrite(redisMock.set)).toMatchObject({
      status: 'success',
      cycles: 2,
    });
  });

  it('后续周期页返回错误时标记员工失败且不清理旧快照', async () => {
    cyclePageListMock
      .mockResolvedValueOnce({
        code: 0,
        msg: 'success',
        data: {
          has_more: true,
          page_token: 'next-page',
          items: [
            {
              id: 'cycle-1',
              create_time: '1000',
              update_time: '1001',
              tenant_cycle_id: 'tenant-cycle-1',
              owner: { owner_type: 'user', user_id: 'ou-1' },
              start_time: '1000',
              end_time: '2000',
              cycle_status: 1,
              score: 0.8,
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        code: 1001002,
        msg: 'No permission to access this OKR data',
      });

    await service.triggerSync();
    await flushAsync();

    expect(lastStatusWrite(redisMock.set)).toMatchObject({
      status: 'failed',
      failedUsers: 1,
      userErrors: [
        {
          openId: 'ou-1',
          error:
            '获取员工 OKR 周期失败（code=1001002）：No permission to access this OKR data',
        },
      ],
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('单条 OKR 子资源返回 400 时跳过并继续同步后续目标', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    objectiveListMock.mockReturnValue(
      asPageIterator([
        {
          id: 'objective-1',
          create_time: '1000',
          update_time: '1001',
          owner: { owner_type: 'user', user_id: 'ou-1' },
          cycle_id: 'cycle-1',
          position: 1,
        },
        {
          id: 'objective-2',
          create_time: '1000',
          update_time: '1001',
          owner: { owner_type: 'user', user_id: 'ou-1' },
          cycle_id: 'cycle-1',
          position: 2,
        },
      ]),
    );
    objectiveIndicatorMock.mockRejectedValueOnce(badRequestError());

    await service.triggerSync();
    await flushAsync();

    expect(prismaMock.larkOkrObjective.upsert).toHaveBeenCalledTimes(2);
    expect(objectiveIndicatorMock).toHaveBeenCalledTimes(2);
    expect(objectiveProgressMock).toHaveBeenCalledTimes(2);
    expect(lastStatusWrite(redisMock.set)).toMatchObject({
      status: 'success',
      objectives: 2,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '"url":"/open-apis/okr/v2/objectives/objective-1/indicator"',
      ),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"user_id_type":"open_id"'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"code":1001004'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"log_id":"test-log-id"'),
    );
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('单条 OKR 子资源返回非 400 时仍将员工同步标记为失败', async () => {
    objectiveIndicatorMock.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 500'), {
        response: {
          status: 500,
          data: { code: 1009999, msg: 'Internal server error' },
        },
      }),
    );

    await service.triggerSync();
    await flushAsync();

    expect(lastStatusWrite(redisMock.set)).toMatchObject({
      status: 'failed',
      failedUsers: 1,
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('全部员工同步失败时记录 failed 并保留错误定位信息', async () => {
    cyclePageListMock.mockRejectedValueOnce(new Error('no permission'));

    await service.triggerSync();
    await flushAsync();

    const status = lastStatusWrite(redisMock.set);
    expect(status).toMatchObject({
      status: 'failed',
      users: 1,
      failedUsers: 1,
      userErrors: [{ openId: 'ou-1', error: 'no permission' }],
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('SDK 可选字段变为缺省时显式清空数据库旧值', async () => {
    objectiveListMock.mockReturnValue(
      asPageIterator([
        {
          id: 'objective-1',
          create_time: '1000',
          update_time: '1002',
          owner: { owner_type: 'user', user_id: 'ou-1' },
          cycle_id: 'cycle-1',
          position: 1,
        },
      ]),
    );

    await service.triggerSync();
    await flushAsync();

    expect(prismaMock.larkOkrObjective.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          content: Prisma.DbNull,
          score: null,
          notes: Prisma.DbNull,
          weight: null,
          deadline: null,
          category_id: null,
        }),
      }),
    );
  });

  it('单个员工失败不阻断其他员工并记录 partial_success', async () => {
    prismaMock.larkUser.findMany.mockResolvedValue([
      { open_id: 'ou-1' },
      { open_id: 'ou-2' },
    ]);
    cyclePageListMock.mockRejectedValueOnce(new Error('no permission'));

    await service.triggerSync();
    await flushAsync();

    expect(lastStatusWrite(redisMock.set)).toMatchObject({
      status: 'partial_success',
      users: 2,
      failedUsers: 1,
      userErrors: [{ openId: 'ou-1', error: 'no permission' }],
    });
    expect(prismaMock.larkOkrCycle.upsert).toHaveBeenCalledTimes(1);
  });

  it('已有 OKR 同步在执行时拒绝重复触发', async () => {
    redisMock.set.mockResolvedValueOnce(null);
    await expect(service.triggerSync()).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('单人同步幂等触发，并在成功后写入独立状态和清理该员工陈旧数据', async () => {
    await expect(service.triggerUserSync('ou-1')).resolves.toMatchObject({
      status: 'running',
      users: 1,
    });
    await flushAsync();

    const userWrites = redisMock.set.mock.calls.filter(
      (call) => call[0] === 'okr:sync:user:status:ou-1',
    );
    const status = JSON.parse(userWrites.at(-1)?.[1] as string) as {
      status: string;
      processedUsers: number;
      cycles: number;
    };
    expect(status).toMatchObject({
      status: 'success',
      processedUsers: 1,
      cycles: 1,
    });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(redisMock.del).toHaveBeenCalledWith('okr:sync:user:lock:ou-1');
  });

  it('同一员工已有同步任务时返回现有状态，不重复访问飞书', async () => {
    redisMock.set.mockResolvedValueOnce(null);
    redisMock.get.mockResolvedValueOnce(
      JSON.stringify({ status: 'running', startedAt: '2026-07-16T10:00:00Z' }),
    );

    await expect(service.triggerUserSync('ou-1')).resolves.toEqual({
      status: 'running',
      startedAt: '2026-07-16T10:00:00Z',
    });
    expect(cyclePageListMock).not.toHaveBeenCalled();
  });

  it('未同步过时状态为 idle', async () => {
    await expect(service.getStatus()).resolves.toEqual({ status: 'idle' });
  });
});
