import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ParticipantModule } from '../participant/participant.module';
import { RbacModule } from '../rbac/rbac.module';
import { SharedModule } from '../shared/shared.module';
import { CalibrationController } from './calibration.controller';
import { CalibrationService } from './calibration.service';
import { ResultService } from './result.service';

/** 校准 + 最终结果 + 等级分布（研发文档 §8.1 Calibration/Result 域） */
@Module({
  imports: [
    SharedModule,
    AuthModule,
    RbacModule,
    AuditModule,
    ParticipantModule,
  ],
  controllers: [CalibrationController],
  providers: [CalibrationService, ResultService],
  exports: [CalibrationService, ResultService],
})
export class CalibrationModule {}
