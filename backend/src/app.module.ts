import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppealModule } from './appeal/appeal.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CalibrationModule } from './calibration/calibration.module';
import configuration from './config/configuration';
import { validationSchema } from './config/validation.schema';
import { ContactModule } from './contact/contact.module';
import { ConfigTemplateModule } from './config-template/config-template.module';
import { CycleModule } from './cycle/cycle.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { FormTemplateModule } from './form-template/form-template.module';
import { NotificationModule } from './notification/notification.module';
import { ParticipantModule } from './participant/participant.module';
import { RbacModule } from './rbac/rbac.module';
import { ReviewModule } from './review/review.module';
import { SharedModule } from './shared/shared.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
    }),
    // 通知发送/催办等定时任务调度
    ScheduleModule.forRoot(),
    SharedModule,
    AuthModule,
    ContactModule,
    RbacModule,
    AuditModule,
    CycleModule,
    ParticipantModule,
    ReviewModule,
    CalibrationModule,
    AppealModule,
    NotificationModule,
    DashboardModule,
    FormTemplateModule,
    ConfigTemplateModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
