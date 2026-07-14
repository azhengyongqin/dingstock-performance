import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { SharedModule } from '../shared/shared.module';
import { CycleController } from './cycle.controller';
import { CycleService } from './cycle.service';
import { CycleSetupService } from './cycle-setup.service';
import { TemplateController } from './template.controller';
import { TemplateService } from './template.service';

/** 周期 + 模板 + 评估规则 + 评估维度 + 时间窗口（研发文档 §8.1 Cycle/Dimension 域） */
@Module({
  imports: [SharedModule, AuthModule, RbacModule, AuditModule],
  controllers: [CycleController, TemplateController],
  providers: [CycleService, CycleSetupService, TemplateService],
  exports: [CycleService, CycleSetupService],
})
export class CycleModule {}
