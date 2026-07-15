import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CycleModule } from '../cycle/cycle.module';
import { ParticipantModule } from '../participant/participant.module';
import { RbacModule } from '../rbac/rbac.module';
import { SharedModule } from '../shared/shared.module';
import { EvaluationController } from './evaluation.controller';
import { EvaluationSubmissionService } from './evaluation-submission.service';
import { PeerEvaluationSubmissionService } from './peer-evaluation-submission.service';

/**
 * 统一评估提交域（ADR-0009）：SELF/PEER/MANAGER 人工答卷统一落
 * PerfEvaluationSubmission。当前开放员工自评与 360°评估；写入门槛复用
 * CycleModule 的 EvaluationTaskAccessService，参与者推进复用 ParticipantModule。
 */
@Module({
  imports: [
    SharedModule,
    AuthModule,
    RbacModule,
    AuditModule,
    ParticipantModule,
    CycleModule,
  ],
  controllers: [EvaluationController],
  providers: [EvaluationSubmissionService, PeerEvaluationSubmissionService],
  exports: [EvaluationSubmissionService, PeerEvaluationSubmissionService],
})
export class EvaluationModule {}
