import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../shared/database/prisma.service';

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
    compensationArchives?: number;
    compensationError?: string;
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
    larkCompensationArchive: { upsert: jest.fn().mockResolvedValue({}) },
  };
  const childrenWithIteratorMock = jest.fn();
  const findByDepartmentWithIteratorMock = jest.fn();
  const corehrBatchGetMock = jest.fn();
  const compensationQueryMock = jest.fn();
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
      compensation: {
        v1: { archive: { query: compensationQueryMock } },
      },
    }),
  };

  let service: ContactSyncService;

  beforeEach(async () => {
    jest.clearAllMocks();
    corehrBatchGetMock.mockReset();
    compensationQueryMock.mockReset();
    redisMock.set.mockResolvedValue('OK');
    redisMock.del.mockResolvedValue(1);
    compensationQueryMock.mockResolvedValue({
      code: 0,
      data: { items: [], has_more: false },
    });

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
    corehrBatchGetMock
      .mockResolvedValueOnce({
        code: 0,
        data: {
          items: [{ employment_id: 'ou-1', employee_number: 'D19001' }],
        },
      })
      .mockResolvedValueOnce({
        code: 0,
        data: {
          items: [
            {
              employment_id: 'ou-1',
              // SDK 会把本批未查询的顶层字段保留为 undefined；合并时不能覆盖前一批结果。
              employee_number: undefined,
              person_info: { national_id_number: '110101199001011234' },
            },
          ],
        },
      });
    compensationQueryMock
      .mockResolvedValueOnce({
        code: 0,
        data: {
          items: [
            {
              user_id: 'ou-1',
              id: 'archive-1',
              tid: 'archive-tid-1',
              plan_id: 'plan-1',
              plan_tid: 'plan-tid-1',
              currency_id: 'currency-cny',
              change_reason_id: 'reason-1',
              change_description: '年度调薪',
              effective_date: '2026-01-01',
              archive_items: [{ item_id: 'base-salary', item_result: '15000' }],
              archive_indicators: [
                { indicator_id: 'annual-cash', indicator_result: '180000' },
              ],
            },
          ],
          page_token: 'next-page',
          has_more: true,
        },
      })
      .mockResolvedValueOnce({
        code: 0,
        data: {
          items: [
            {
              user_id: 'ou-1',
              id: 'archive-1',
              tid: 'archive-tid-2',
              effective_date: '2026-07-01',
              archive_items: [],
              archive_indicators: [],
            },
          ],
          has_more: false,
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
    expect(corehrBatchGetMock).toHaveBeenCalledTimes(2);
    const batchGetArgs = (corehrBatchGetMock.mock.calls as unknown[][]).map(
      (call) => call[0],
    ) as Array<{
      data: { employment_ids: string[]; fields: string[] };
      params: Record<string, string>;
    }>;
    const batchGetArg = batchGetArgs[0];
    const requestedFields = batchGetArgs.flatMap((arg) => arg.data.fields);
    expect(batchGetArg.data.employment_ids).toEqual(['ou-1', 'ou-2']);
    expect(requestedFields).toContain('employee_number');
    expect(requestedFields).toEqual(
      expect.arrayContaining([
        'ats_application_id',
        'compensation_type',
        'custom_org_05',
        'direct_manager.person_info.preferred_name',
        'job.description',
        'job_family.parent_id',
        'job_level.description',
        'pay_group_id',
        'person_info.bank_account_list',
        'person_info.national_id_number',
        'position.descriptions',
        'work_shift',
      ]),
    );
    // 完整字段超过 100 个时拆成多次请求，每次仍满足接口上限且整体不重复。
    expect(batchGetArgs.every((arg) => arg.data.fields.length <= 100)).toBe(
      true,
    );
    expect(new Set(requestedFields).size).toBe(requestedFields.length);
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
      person_info: { national_id_number: '110101199001011234' },
    });

    // 薪资档案：按 open_id 查询并跟随 page_token 翻页，以 tid 保存每个历史版本。
    expect(compensationQueryMock).toHaveBeenCalledTimes(2);
    expect(compensationQueryMock).toHaveBeenNthCalledWith(1, {
      data: { user_id_list: ['ou-1', 'ou-2'] },
      params: { page_size: 500, user_id_type: 'open_id' },
    });
    expect(compensationQueryMock).toHaveBeenNthCalledWith(2, {
      data: { user_id_list: ['ou-1', 'ou-2'] },
      params: {
        page_size: 500,
        page_token: 'next-page',
        user_id_type: 'open_id',
      },
    });
    expect(prismaMock.larkCompensationArchive.upsert).toHaveBeenCalledTimes(2);
    const compensationUpsertArg = (
      prismaMock.larkCompensationArchive.upsert.mock.calls as unknown[][]
    )[0][0] as {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
    };
    expect(compensationUpsertArg.where).toEqual({ tid: 'archive-tid-1' });
    expect(compensationUpsertArg.create).toMatchObject({
      tid: 'archive-tid-1',
      id: 'archive-1',
      open_id: 'ou-1',
      change_description: '年度调薪',
      archive_items: [{ item_id: 'base-salary', item_result: '15000' }],
    });

    // 最终状态写入 success，并释放锁
    const finalStatus = lastStatusWrite(redisMock.set);
    expect(finalStatus.status).toBe('success');
    expect(finalStatus.departments).toBe(1);
    expect(finalStatus.users).toBe(2);
    expect(finalStatus.corehrEmployees).toBe(1);
    expect(finalStatus.compensationArchives).toBe(2);
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

  it('CoreHR 字段批次含租户无效字段时拆分重试并保留其它字段', async () => {
    childrenWithIteratorMock.mockReturnValue(asPageIterator([]));
    findByDepartmentWithIteratorMock.mockReturnValue(
      asPageIterator([{ open_id: 'ou-1', name: '张三' }]),
    );
    corehrBatchGetMock.mockImplementation(
      (payload: { data: { fields: string[] } }) => {
        const fields = payload.data.fields;
        if (fields.some((field) => field.startsWith('custom_org_'))) {
          return Promise.resolve({
            code: 470,
            msg: 'Field metadata not found: employment.custom_org__c',
          });
        }

        return Promise.resolve({
          code: 0,
          data: {
            items: [
              {
                employment_id: 'ou-1',
                ...(fields.includes('employee_number')
                  ? { employee_number: 'D19001' }
                  : {}),
                ...(fields.some((field) => field.startsWith('person_info.'))
                  ? {
                      person_info: {
                        national_id_number: '110101199001011234',
                      },
                    }
                  : {}),
              },
            ],
          },
        });
      },
    );

    await service.triggerSync();
    await flushAsync();

    const fieldRequests = (
      corehrBatchGetMock.mock.calls as Array<[{ data: { fields: string[] } }]>
    ).map(([payload]) => payload.data.fields);
    expect(fieldRequests).toEqual(
      expect.arrayContaining([
        ['custom_org_01'],
        ['custom_org_02'],
        ['custom_org_03'],
        ['custom_org_04'],
        ['custom_org_05'],
      ]),
    );
    const corehrUpsertArg = (
      prismaMock.larkCorehrEmployee.upsert.mock.calls as unknown[][]
    )[0][0] as { create: Record<string, unknown> };
    expect(corehrUpsertArg.create).toMatchObject({
      open_id: 'ou-1',
      employee_number: 'D19001',
      person_info: { national_id_number: '110101199001011234' },
    });
    const finalStatus = lastStatusWrite(redisMock.set);
    expect(finalStatus.status).toBe('success');
    expect(finalStatus.corehrEmployees).toBe(1);
    expect(finalStatus.corehrError).toBeUndefined();
  });

  it('已有同步在执行时拒绝重复触发', async () => {
    // SET NX 未抢到锁
    redisMock.set.mockResolvedValueOnce(null);

    await expect(service.triggerSync()).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('薪资档案同步失败时降级：整体仍 success 并记录 compensationError', async () => {
    childrenWithIteratorMock.mockReturnValue(asPageIterator([]));
    findByDepartmentWithIteratorMock.mockReturnValue(
      asPageIterator([{ open_id: 'ou-1', name: '张三' }]),
    );
    compensationQueryMock.mockResolvedValue({
      code: 99991672,
      msg: 'no compensation archive permission',
    });

    await service.triggerSync();
    await flushAsync();

    const finalStatus = lastStatusWrite(redisMock.set);
    expect(finalStatus.status).toBe('success');
    expect(finalStatus.compensationArchives).toBeUndefined();
    expect(finalStatus.compensationError).toContain(
      'no compensation archive permission',
    );
    expect(prismaMock.larkCompensationArchive.upsert).not.toHaveBeenCalled();
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
