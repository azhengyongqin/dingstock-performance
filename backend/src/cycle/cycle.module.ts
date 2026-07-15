import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { SharedModule } from '../shared/shared.module';
import { CycleController } from './cycle.controller';
import { CycleService } from './cycle.service';
import { CycleSetupService } from './cycle-setup.service';
import { CycleActivationService } from './cycle-activation.service';
import { EvaluationTaskAccessService } from './evaluation-task-access.service';
import { CycleProgressService } from './cycle-progress.service';
import { NotificationModule } from '../notification/notification.module';
import { ActiveCycleRollbackService } from './active-cycle-rollback.service';
import { CycleArchiveService } from './cycle-archive.service';

/** 周期 + 模板 + 评估规则 + 评估维度 + 时间窗口（研发文档 §8.1 Cycle/Dimension 域） */
@Module({
  imports: [
    SharedModule,
    AuthModule,
    RbacModule,
    AuditModule,
    NotificationModule,
  ],
  controllers: [CycleController],
  providers: [
    CycleService,
    CycleSetupService,
    CycleActivationService,
    EvaluationTaskAccessService,
    CycleProgressService,
    ActiveCycleRollbackService,
    CycleArchiveService,
  ],
  exports: [
    CycleService,
    CycleSetupService,
    CycleActivationService,
    EvaluationTaskAccessService,
    CycleProgressService,
  ],
})
export class CycleModule {}
