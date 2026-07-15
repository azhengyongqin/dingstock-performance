import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ParticipantModule } from '../participant/participant.module';
import { RbacModule } from '../rbac/rbac.module';
import { SharedModule } from '../shared/shared.module';
import { CalibrationController } from './calibration.controller';
import { CalibrationService } from './calibration.service';
import { ResultService } from './result.service';
import { RedLineFindingService } from './red-line-finding.service';
import { EvaluationModule } from '../evaluation/evaluation.module';
import { CalibrationDecisionService } from './calibration-decision.service';

/** 校准 + 最终结果 + 等级分布（研发文档 §8.1 Calibration/Result 域） */
@Module({
  imports: [
    SharedModule,
    AuthModule,
    RbacModule,
    AuditModule,
    ParticipantModule,
    EvaluationModule,
  ],
  controllers: [CalibrationController],
  providers: [
    CalibrationService,
    CalibrationDecisionService,
    ResultService,
    RedLineFindingService,
  ],
  exports: [
    CalibrationService,
    CalibrationDecisionService,
    ResultService,
    RedLineFindingService,
  ],
})
export class CalibrationModule {}
