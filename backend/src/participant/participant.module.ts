import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { SharedModule } from '../shared/shared.module';
import { NotificationModule } from '../notification/notification.module';
import { ParticipantController } from './participant.controller';
import { ParticipantService } from './participant.service';
import { ParticipantNoResultService } from './participant-no-result.service';

/** 考核人员管理（研发文档 §8.1 Participant 域）；导出 service 供评审/校准/结果模块做状态流转 */
@Module({
  imports: [
    SharedModule,
    AuthModule,
    RbacModule,
    AuditModule,
    NotificationModule,
  ],
  controllers: [ParticipantController],
  providers: [ParticipantService, ParticipantNoResultService],
  exports: [ParticipantService, ParticipantNoResultService],
})
export class ParticipantModule {}
