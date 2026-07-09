import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { SharedModule } from '../shared/shared.module';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

/** 飞书消息推送 + 催办调度（研发文档 §8.5）；发送循环由 cron + Redis 锁驱动 */
@Module({
  imports: [SharedModule, AuthModule, RbacModule, AuditModule],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
