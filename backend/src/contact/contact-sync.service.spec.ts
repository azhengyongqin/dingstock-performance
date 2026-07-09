import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../shared/database/prisma.service';

// 生成的 Prisma client 是 ESM 产物，单测中统一 mock，避免依赖真实数据库。
jest.mock('../generated/prisma/client', () => ({
  PrismaClient: class {
    $connect = jest.fn();
    $disconnect = jest.fn();
  },
}));
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation((options: unknown) => options),
}));
import { LarkService } from '../shared/lark/lark.service';
import { REDIS_CLIENT } from '../shared/redis/redis.constants';
import { ContactSyncService } from './contact-sync.service';

// 把数组包装成 SDK *WithIterator 返回的异步分页迭代器。
const asPageIterator = <T>(items: T[]) =>
  Promise.resolve(
    (async function* () {
      yield await Promise.resolve({ items });
    })(),
  );

// 读取写入 Redis 的最后一次同步状态（mock.calls 按 unknown 处理，集中收敛类型）。
const lastStatusWrite = (setMock: { mock: { calls: unknown[][] } }) => {
  const statusWrites = setMock.mock.calls.filter(
    (call) => call[0] === 'contact:sync:status',
  );
  return JSON.parse(statusWrites[statusWrites.length - 1][1] as string) as {
    status: string;
    departments?: number;
    users?: number;
    corehrEmployees?: number;
    corehrError?: string;
    error?: string;
  };
};

// 等待 triggerSync 内部 fire-and-forget 的同步任务跑完。
const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ContactSyncService', () => {
  const redisMock = {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn().mockResolvedValue(1),
  };
  const prismaMock = {
    larkDepartment: { upsert: jest.fn().mockResolvedValue({}) },
    larkUser: { upsert: jest.fn().mockResolvedValue({}) },
    larkCorehrEmployee: { upsert: jest.fn().mockResolvedValue({}) },
  };
  const childrenWithIteratorMock = jest.fn();
  const findByDepartmentWithIteratorMock = jest.fn();
  const corehrBatchGetMock = jest.fn();
  const larkServiceMock = {
    getClient: () => ({
      contact: {
        v3: {
          department: { childrenWithIterator: childrenWithIteratorMock },
          user: {
            findByDepartmentWithIterator: findByDepartmentWithIteratorMock,
          },
        },
      },
      corehr: {
        v2: { employee: { batchGet: corehrBatchGetMock } },
      },
    }),
  };

  let service: ContactSyncService;

  beforeEach(async () => {
    jest.clearAllMocks();
    redisMock.set.mockResolvedValue('OK');
    redisMock.del.mockResolvedValue(1);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ContactSyncService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: LarkService, useValue: larkServiceMock },
        { provide: REDIS_CLIENT, useValue: redisMock },
      ],
    }).compile();

    service = moduleRef.get(ContactSyncService);
  });

  it('全量同步部门与员工并按 open_id 去重入库', async () => {
    childrenWithIteratorMock.mockReturnValue(
      asPageIterator([
        {
          open_department_id: 'od-1',
          department_id: 'D001',
          name: '技术部',
          parent_department_id: '0',
          member_count: 2,
        },
      ]),
    );
    // 根部门与 od-1 各返回一次同一个用户，验证去重；od-1 再返回一个新用户。
    findByDepartmentWithIteratorMock
      .mockReturnValueOnce(
        asPageIterator([
          { open_id: 'ou-1', name: '张三', department_ids: ['od-1'] },
        ]),
      )
      .mockReturnValueOnce(
        asPageIterator([
          { open_id: 'ou-1', name: '张三', department_ids: ['od-1'] },
          { open_id: 'ou-2', name: '李四', department_ids: ['od-1'] },
        ]),
      );
    // CoreHR 只录入了 ou-1（ou-2 缺失，模拟机器人/未入职账号）
    corehrBatchGetMock.mockResolvedValue({
      code: 0,
      data: {
        items: [{ employment_id: 'ou-1', employee_number: 'D19001' }],
      },
    });

    const started = await service.triggerSync();
    expect(started.status).toBe('running');
    await flushAsync();

    // 部门 upsert：主键为 open_department_id，字段与 SDK 对齐
    expect(prismaMock.larkDepartment.upsert).toHaveBeenCalledTimes(1);
    const upsertArg = (
      prismaMock.larkDepartment.upsert.mock.calls as unknown[][]
    )[0][0] as {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
    };
    expect(upsertArg.where).toEqual({ open_department_id: 'od-1' });
    expect(upsertArg.create).toMatchObject({
      open_department_id: 'od-1',
      name: '技术部',
      parent_department_id: '0',
    });

    // 员工：根部门 + od-1 两轮拉取，ou-1 去重后共 2 人
    expect(findByDepartmentWithIteratorMock).toHaveBeenCalledTimes(2);
    expect(prismaMock.larkUser.upsert).toHaveBeenCalledTimes(2);

    // CoreHR 详情：按去重后的 open_id 批量拉取（open_id 即 employment_id），
    // ou-2 未录入 CoreHR（响应缺失）时只入库 ou-1。
    expect(corehrBatchGetMock).toHaveBeenCalledTimes(1);
    const batchGetArg = (
      corehrBatchGetMock.mock.calls as unknown[][]
    )[0][0] as {
      data: { employment_ids: string[]; fields: string[] };
      params: Record<string, string>;
    };
    expect(batchGetArg.data.employment_ids).toEqual(['ou-1', 'ou-2']);
    expect(batchGetArg.data.fields).toContain('employee_number');
    expect(batchGetArg.params).toMatchObject({
      user_id_type: 'open_id',
      department_id_type: 'open_department_id',
    });
    expect(prismaMock.larkCorehrEmployee.upsert).toHaveBeenCalledTimes(1);
    const corehrUpsertArg = (
      prismaMock.larkCorehrEmployee.upsert.mock.calls as unknown[][]
    )[0][0] as {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
    };
    expect(corehrUpsertArg.where).toEqual({ open_id: 'ou-1' });
    expect(corehrUpsertArg.create).toMatchObject({
      open_id: 'ou-1',
      employee_number: 'D19001',
    });

    // 最终状态写入 success，并释放锁
    const finalStatus = lastStatusWrite(redisMock.set);
    expect(finalStatus.status).toBe('success');
    expect(finalStatus.departments).toBe(1);
    expect(finalStatus.users).toBe(2);
    expect(finalStatus.corehrEmployees).toBe(1);
    expect(redisMock.del).toHaveBeenCalledWith('contact:sync:lock');
  });

  it('CoreHR 详情同步失败时降级：整体仍 success 并记录 corehrError', async () => {
    childrenWithIteratorMock.mockReturnValue(asPageIterator([]));
    findByDepartmentWithIteratorMock.mockReturnValue(
      asPageIterator([{ open_id: 'ou-1', name: '张三' }]),
    );
    // 未开通飞书人事 / 缺 corehr:employee:read 权限时 SDK 抛错
    corehrBatchGetMock.mockRejectedValue(new Error('no corehr permission'));

    await service.triggerSync();
    await flushAsync();

    const finalStatus = lastStatusWrite(redisMock.set);
    expect(finalStatus.status).toBe('success');
    expect(finalStatus.users).toBe(1);
    expect(finalStatus.corehrEmployees).toBeUndefined();
    expect(finalStatus.corehrError).toContain('no corehr permission');
    expect(prismaMock.larkCorehrEmployee.upsert).not.toHaveBeenCalled();
  });

  it('已有同步在执行时拒绝重复触发', async () => {
    // SET NX 未抢到锁
    redisMock.set.mockResolvedValueOnce(null);

    await expect(service.triggerSync()).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('同步失败时记录 failed 状态并释放锁', async () => {
    childrenWithIteratorMock.mockRejectedValue(new Error('lark api down'));

    await service.triggerSync();
    await flushAsync();

    const finalStatus = lastStatusWrite(redisMock.set);
    expect(finalStatus.status).toBe('failed');
    expect(finalStatus.error).toContain('lark api down');
    expect(redisMock.del).toHaveBeenCalledWith('contact:sync:lock');
  });

  it('未同步过时状态为 idle', async () => {
    redisMock.get.mockResolvedValue(null);
    await expect(service.getStatus()).resolves.toEqual({ status: 'idle' });
  });
});
