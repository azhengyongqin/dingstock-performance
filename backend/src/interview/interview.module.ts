import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { SharedModule } from '../shared/shared.module';
import { INTERVIEW_CALENDAR_PORT } from './interview-calendar.port';
import { InterviewController } from './interview.controller';
import { InterviewService } from './interview.service';
import { LarkInterviewCalendarAdapter } from './lark-interview-calendar.adapter';

/** 绩效面谈：预约（飞书日程）+ 纪要；与申诉弱关联 */
@Module({
  imports: [SharedModule, AuthModule, RbacModule, AuditModule],
  controllers: [InterviewController],
  providers: [
    InterviewService,
    LarkInterviewCalendarAdapter,
    {
      provide: INTERVIEW_CALENDAR_PORT,
      useExisting: LarkInterviewCalendarAdapter,
    },
  ],
  exports: [InterviewService],
})
export class InterviewModule {}
