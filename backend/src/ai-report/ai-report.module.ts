import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { SharedModule } from '../shared/shared.module';
import { AiReportController } from './ai-report.controller';
import { AiReportService } from './ai-report.service';

/** AI 独立异步参考域；不依赖 EvaluationModule，避免人工评估与异步任务循环依赖。 */
@Module({
  imports: [SharedModule, AuthModule, RbacModule],
  controllers: [AiReportController],
  providers: [AiReportService],
  exports: [AiReportService],
})
export class AiReportModule {}
