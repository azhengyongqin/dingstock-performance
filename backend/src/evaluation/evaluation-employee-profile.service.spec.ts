import { EvaluationEmployeeProfileService } from './evaluation-employee-profile.service';

// 本单测只验证查询编排，直接隔离 DI 令牌，避免加载生成客户端污染其他虚拟 Prisma 测试。
jest.mock('../shared/database/prisma.service', () => ({
  PrismaService: class {},
}));

describe('EvaluationEmployeeProfileService', () => {
  const prisma = {
    larkUser: { findUnique: jest.fn(), findMany: jest.fn() },
    larkDepartment: { findMany: jest.fn() },
  };
  let service: EvaluationEmployeeProfileService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EvaluationEmployeeProfileService(prisma as never);
    prisma.larkUser.findUnique.mockResolvedValue({
      open_id: 'ou_employee',
      name: '员工甲',
      avatar: { avatar_72: 'avatar.png' },
      corehr: {
        department_id: 'od_dev',
        job: { name: [{ lang: 'zh-CN', value: '后端工程师' }] },
        job_level: { name: [{ lang: 'zh-CN', value: 'D5' }] },
        effective_date: '2022-05-06 00:00:00',
      },
    });
    prisma.larkDepartment.findMany.mockResolvedValue([
      {
        open_department_id: 'od_group',
        name: '集团',
        parent_department_id: '0',
      },
      {
        open_department_id: 'od_rd',
        name: '研发中心',
        parent_department_id: 'od_group',
      },
      {
        open_department_id: 'od_dev',
        name: '后端组',
        parent_department_id: 'od_rd',
      },
    ]);
    prisma.larkUser.findMany.mockResolvedValue([
      {
        open_id: 'ou_employee',
        name: '员工甲',
        avatar: { avatar_72: 'avatar.png' },
        corehr: {
          department_id: 'od_dev',
          job: { name: [{ lang: 'zh-CN', value: '后端工程师' }] },
        },
      },
      {
        open_id: 'ou_employee_2',
        name: '员工乙',
        avatar: null,
        corehr: null,
      },
    ]);
  });

  it('完整资料使用 CoreHR 字段并解析完整部门路径', async () => {
    await expect(service.getDetailed('ou_employee')).resolves.toEqual({
      open_id: 'ou_employee',
      name: '员工甲',
      avatar: { avatar_72: 'avatar.png' },
      departmentPath: '集团 / 研发中心 / 后端组',
      jobTitle: '后端工程师',
      jobLevel: 'D5',
      effectiveDate: '2022-05-06',
    });
  });

  it('360°资料从响应对象中彻底移除职级和入职日期', async () => {
    const profile = await service.getPeerSafe('ou_employee');
    expect(profile).toEqual({
      open_id: 'ou_employee',
      name: '员工甲',
      avatar: { avatar_72: 'avatar.png' },
      departmentPath: '集团 / 研发中心 / 后端组',
      jobTitle: '后端工程师',
    });
    expect(profile).not.toHaveProperty('jobLevel');
    expect(profile).not.toHaveProperty('effectiveDate');
  });

  it('批量加载 360°资料只执行一次用户查询', async () => {
    const profiles = await service.getPeerSafeMany([
      'ou_employee',
      'ou_employee_2',
      'ou_employee',
    ]);

    expect(prisma.larkUser.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { open_id: { in: ['ou_employee', 'ou_employee_2'] } },
      }),
    );
    expect(prisma.larkUser.findMany).toHaveBeenCalledTimes(1);
    expect(profiles).toEqual([
      expect.objectContaining({
        open_id: 'ou_employee',
        departmentPath: '集团 / 研发中心 / 后端组',
        jobTitle: '后端工程师',
      }),
      expect.objectContaining({
        open_id: 'ou_employee_2',
        departmentPath: null,
        jobTitle: null,
      }),
    ]);
  });

  it('短时间内复用部门映射，避免每次打开评估页都全表查询', async () => {
    await service.getDetailed('ou_employee');
    await service.getDetailed('ou_employee');
    expect(prisma.larkDepartment.findMany).toHaveBeenCalledTimes(1);
  });

  it('CoreHR 缺失时不使用通讯录字段兜底', async () => {
    prisma.larkUser.findUnique.mockResolvedValue({
      open_id: 'ou_employee',
      name: '员工甲',
      avatar: null,
      corehr: null,
    });
    await expect(service.getDetailed('ou_employee')).resolves.toMatchObject({
      departmentPath: null,
      jobTitle: null,
      jobLevel: null,
      effectiveDate: null,
    });
    expect(prisma.larkDepartment.findMany).not.toHaveBeenCalled();
  });
});
