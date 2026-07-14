import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { SharedModule } from '../shared/shared.module';
import { ConfigTemplateController } from './config-template.controller';
import { ConfigTemplateService } from './config-template.service';

/** 版本化配置模板独立聚合；旧 PerfTemplate 继续服务现有周期创建路径。 */
@Module({
  imports: [SharedModule, AuthModule, RbacModule, AuditModule],
  controllers: [ConfigTemplateController],
  providers: [ConfigTemplateService],
})
export class ConfigTemplateModule {}
