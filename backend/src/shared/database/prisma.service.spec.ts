import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';

jest.mock(
  '../../generated/prisma/client',
  () => ({
    PrismaClient: class {
      constructor(public readonly options: unknown) {}

      $connect = jest.fn();
      $disconnect = jest.fn();
    },
  }),
  { virtual: true },
);

jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation((options: unknown) => options),
}));

describe('PrismaService', () => {
  it('should create prisma client with configured database url', async () => {
    const getOrThrow = jest
      .fn()
      .mockReturnValue('postgres://user:pass@localhost:5432/app');
    const configService = {
      getOrThrow,
    } as unknown as ConfigService;

    const service = new PrismaService(configService);

    // 只验证服务可创建，不连接真实数据库，避免单测依赖本地 PostgreSQL。
    expect(service).toBeInstanceOf(PrismaService);
    expect(getOrThrow).toHaveBeenCalledWith('database.url');

    await service.$disconnect();
  });
});
