import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { SharedModule } from '../shared/shared.module';
import { FormTemplateController } from './form-template.controller';
import { FormTemplateService } from './form-template.service';

/** 版本化评估表单模板独立领域，不与旧配置模板复用持久化模型。 */
@Module({
  imports: [SharedModule, AuthModule, RbacModule, AuditModule],
  controllers: [FormTemplateController],
  providers: [FormTemplateService],
})
export class FormTemplateModule {}
