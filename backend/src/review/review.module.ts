import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ParticipantModule } from '../participant/participant.module';
import { RbacModule } from '../rbac/rbac.module';
import { SharedModule } from '../shared/shared.module';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';
import { ReviewerService } from './reviewer.service';
import { CycleModule } from '../cycle/cycle.module';
import { EvaluationModule } from '../evaluation/evaluation.module';
import { AiReportModule } from '../ai-report/ai-report.module';

/** 评审域：评审员指派/推荐、自评、360°、上级评估（研发文档 §8.1 Task/SelfReview/Review 域） */
@Module({
  imports: [
    SharedModule,
    AuthModule,
    RbacModule,
    AuditModule,
    ParticipantModule,
    CycleModule,
    EvaluationModule,
    AiReportModule,
  ],
  controllers: [ReviewController],
  providers: [ReviewerService, ReviewService],
  exports: [ReviewService],
})
export class ReviewModule {}
