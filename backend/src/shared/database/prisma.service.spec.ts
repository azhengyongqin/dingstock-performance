import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';

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
    expect(getOrThrow).toHaveBeenCalledWith('database.url');

    await service.$disconnect();
  });
});
