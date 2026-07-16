import { ConfigService } from '@nestjs/config';
import { PerfRole } from '../generated/prisma/enums';
import { PrismaService } from '../shared/database/prisma.service';
import { RbacService } from './rbac.service';

describe('RbacService', () => {
  const prisma = {
    roleGrant: {
      findMany: jest.fn(),
    },
    larkUser: {
      findUnique: jest.fn(),
    },
  };
  const configService = {
    get: jest.fn(),
  };

  let service: RbacService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.roleGrant.findMany.mockResolvedValue([]);
    prisma.larkUser.findUnique.mockResolvedValue(null);
    service = new RbacService(
      prisma as unknown as PrismaService,
      configService as unknown as ConfigService,
    );
  });

  it('空库中命中配置的默认管理员 open_id 时授予 ADMIN', async () => {
    configService.get.mockReturnValue('ou_default_admin');

    await expect(service.getExplicitRoles('ou_default_admin')).resolves.toEqual(
      [PerfRole.ADMIN],
    );
  });

  it('未命中默认管理员配置时不额外授予 ADMIN', async () => {
    configService.get.mockReturnValue('ou_default_admin');

    await expect(service.getExplicitRoles('ou_employee')).resolves.toEqual([]);
  });
});
