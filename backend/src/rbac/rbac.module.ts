import { Module, forwardRef } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { SharedModule } from '../shared/shared.module';
import { RbacController } from './rbac.controller';
import { RbacService } from './rbac.service';
import { RolesGuard } from './roles.guard';

/**
 * RBAC 模块：导出 RbacService（角色解析/组织范围）与 RolesGuard（配合 @Roles 使用）。
 * 业务模块 imports: [RbacModule] 后即可在 controller 上挂 @UseGuards(JwtAuthGuard, RolesGuard)。
 */
@Module({
  imports: [SharedModule, AuthModule, forwardRef(() => AuditModule)],
  controllers: [RbacController],
  providers: [RbacService, RolesGuard],
  exports: [RbacService, RolesGuard],
})
export class RbacModule {}
