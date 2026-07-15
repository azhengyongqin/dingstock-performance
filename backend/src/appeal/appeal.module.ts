import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CalibrationModule } from '../calibration/calibration.module';
import { RbacModule } from '../rbac/rbac.module';
import { SharedModule } from '../shared/shared.module';
import { AppealController } from './appeal.controller';
import { AppealService } from './appeal.service';

/** 申诉 + 面谈（研发文档 §8.1 Appeal/Interview 域） */
@Module({
  imports: [
    SharedModule,
    AuthModule,
    RbacModule,
    AuditModule,
    CalibrationModule,
  ],
  controllers: [AppealController],
  providers: [AppealService],
  exports: [AppealService],
})
export class AppealModule {}
