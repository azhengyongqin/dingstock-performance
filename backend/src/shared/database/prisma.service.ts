import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(configService: ConfigService) {
    const adapter = new PrismaPg({
      connectionString: configService.getOrThrow<string>('database.url'),
    });

    super({
      // Prisma 7 通过 driver adapter 建立直连数据库连接。
      adapter,
    });
  }

  async onModuleInit() {
    // 应用启动时主动建立连接，尽早暴露数据库配置或网络问题。
    await this.$connect();
  }

  async onModuleDestroy() {
    // Nest 关闭时释放 Prisma 连接池，避免测试或热重载进程挂起。
    await this.$disconnect();
  }
}
