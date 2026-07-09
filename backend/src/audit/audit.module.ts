import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { SharedModule } from '../shared/shared.module';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * 操作日志模块：AuditService 供各业务模块记录敏感操作，
 * controller 只读查询（HR/ADMIN）。与 RbacModule 互相引用（守卫 ↔ 审计），用 forwardRef 解环。
 */
@Module({
  imports: [SharedModule, AuthModule, forwardRef(() => RbacModule)],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
