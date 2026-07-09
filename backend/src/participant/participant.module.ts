import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { SharedModule } from '../shared/shared.module';
import { ParticipantController } from './participant.controller';
import { ParticipantService } from './participant.service';

/** 考核人员管理（研发文档 §8.1 Participant 域）；导出 service 供评审/校准/结果模块做状态流转 */
@Module({
  imports: [SharedModule, AuthModule, RbacModule, AuditModule],
  controllers: [ParticipantController],
  providers: [ParticipantService],
  exports: [ParticipantService],
})
export class ParticipantModule {}
