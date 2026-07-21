import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CalibrationModule } from '../calibration/calibration.module';
import { NotificationModule } from '../notification/notification.module';
import { RbacModule } from '../rbac/rbac.module';
import { SharedModule } from '../shared/shared.module';
import { AppealController } from './appeal.controller';
import { AppealService } from './appeal.service';

/** 申诉队列（发起 / 指派 / 结案）；面谈见 InterviewModule */
@Module({
  imports: [
    SharedModule,
    AuthModule,
    RbacModule,
    AuditModule,
    CalibrationModule,
    NotificationModule,
  ],
  controllers: [AppealController],
  providers: [AppealService],
  exports: [AppealService],
})
export class AppealModule {}
