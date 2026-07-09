import { Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // lazyConnect 避免 provider 创建阶段阻塞，首次使用 Redis 时再建立连接。
        return new Redis(configService.getOrThrow<string>('redis.uri'), {
          lazyConnect: true,
          maxRetriesPerRequest: 3,
        });
      },
    },
    {
      provide: 'REDIS_SHUTDOWN_HOOK',
      inject: [REDIS_CLIENT],
      useFactory: (client: Redis): OnApplicationShutdown => ({
        onApplicationShutdown() {
          // 应用退出时主动关闭连接，避免测试或热重载进程挂起。
          client.disconnect();
        },
      }),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
