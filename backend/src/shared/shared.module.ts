import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { LarkModule } from './lark/lark.module';
import { RedisModule } from './redis/redis.module';

@Module({
  // ConfigModule 需在 imports 中声明才能被 re-export（其本身是 global，此处仅为导出合法性）。
  imports: [ConfigModule, DatabaseModule, LarkModule, RedisModule],
  exports: [
    // 统一从 SharedModule 暴露基础设施能力，业务模块不需要重复声明公共依赖。
    ConfigModule,
    DatabaseModule,
    LarkModule,
    RedisModule,
  ],
})
export class SharedModule {}
