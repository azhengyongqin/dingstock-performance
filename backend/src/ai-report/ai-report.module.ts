import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { SharedModule } from '../shared/shared.module';
import { AiReportController } from './ai-report.controller';
import { AiReportInputBuilder } from './ai-report-input.builder';
import { AiReportProcessor } from './ai-report.processor';
import { AiReportService } from './ai-report.service';
import { HttpAiReportGenerator } from './http-ai-report.generator';
import { AI_REPORT_GENERATOR } from './ai-report.types';

/** AI 独立异步参考域；不依赖 EvaluationModule，避免人工评估与异步任务循环依赖。 */
@Module({
  imports: [SharedModule, AuthModule, RbacModule],
  controllers: [AiReportController],
  providers: [
    AiReportInputBuilder,
    AiReportService,
    HttpAiReportGenerator,
    {
      provide: AI_REPORT_GENERATOR,
      useExisting: HttpAiReportGenerator,
    },
    AiReportProcessor,
  ],
  exports: [AiReportService],
})
export class AiReportModule {}
